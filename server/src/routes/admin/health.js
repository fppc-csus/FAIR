import express from "express";
import { prisma } from "../../lib/prisma.js";
import { executeSourceSync } from "../../services/sourceSync.js";

const router = express.Router();

const STALE_AFTER_MS = 30 * 60 * 1000;
const RUN_LIMIT = 50;

function isStaleRunningRun(run, now = Date.now()) {
  return (
    run.status === "running" &&
    now - new Date(run.startedAt).getTime() > STALE_AFTER_MS
  );
}

function safeErrorSummary(errors) {
  return safeErrorDetails(errors)[0]?.message ?? null;
}

function safeErrorDetails(errors) {
  if (!errors) return [];
  const entries = Array.isArray(errors) ? errors : [errors];
  return entries.slice(0, 20).map((entry) => {
    if (typeof entry === "string") return { message: entry.slice(0, 500) };
    if (!entry || typeof entry !== "object") {
      return { message: "The run failed. Check the server logs for more information." };
    }

    let url = null;
    if (typeof entry.pdfUrl === "string") {
      try {
        const parsed = new URL(entry.pdfUrl);
        if (["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password) {
          parsed.search = "";
          parsed.hash = "";
          url = parsed.href.slice(0, 500);
        }
      } catch {
        url = null;
      }
    }

    return {
      ...(url ? { url } : {}),
      message: typeof entry.message === "string"
        ? entry.message.slice(0, 500)
        : "The run failed. Check the server logs for more information.",
    };
  });
}

function safeDetectionErrors(errors) {
  if (!Array.isArray(errors)) return [];
  return errors.slice(0, 20).map((entry) => ({
    agendaItemCount: Array.isArray(entry?.agendaItemIds) ? entry.agendaItemIds.length : 0,
    message: typeof entry?.message === "string"
      ? entry.message.slice(0, 500)
      : "Conflict detection failed. Check the server logs for more information.",
  }));
}

function displayStatus(run, now = Date.now()) {
  return isStaleRunningRun(run, now) ? "stale" : run.status;
}
router.get("/", async (_req, res) => {
  try {
    const now = Date.now();

    const [runs, lastLegistar, lastApify, counts] = await Promise.all([
      prisma.syncLog.findMany({
        orderBy: { startedAt: "desc" },
        take: RUN_LIMIT,
        include: {
          dataSource: {
            select: {
              cityName: true,
              sourceType: true,
            },
          },
        },
      }),

      prisma.syncLog.findFirst({
        where: {
          sourceType: "legistar",
          status: "success",
        },
        orderBy: { completedAt: "desc" },
        include: {
          dataSource: {
            select: { cityName: true },
          },
        },
      }),

      prisma.syncLog.findFirst({
        where: {
          sourceType: "apify",
          status: "success",
        },
        orderBy: { completedAt: "desc" },
        include: {
          dataSource: {
            select: { cityName: true },
          },
        },
      }),

      Promise.all([
        prisma.jurisdiction.count(),
        prisma.politician.count(),
        prisma.meeting.count(),
        prisma.agendaItem.count(),
        prisma.form700Filing.count(),
        prisma.conflict.count(),
        prisma.dataSource.count(),
        prisma.syncLog.count(),
      ]),
    ]);

    const syncRuns = runs.map((run) => ({
      id: run.id,
      source: run.dataSource?.cityName ?? run.sourceType ?? "Unknown",
      sourceType: run.sourceType,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      status: displayStatus(run, now),
      itemsFound: run.itemsFound,
      documentsFound: run.documentsFound,
      pdfsFetched: run.pdfsFetched,
      documentsSkipped: run.documentsSkipped,
      itemsInserted: run.itemsInserted,
      itemsSkipped: run.itemsSkipped,
      conflictsDetected: run.conflictsDetected,
      error: safeErrorSummary(run.errors),
      sourceLimitations: safeErrorDetails(run.errors),
      detectionErrors: safeDetectionErrors(run.detectionErrors),
      retryEligible:
        run.status === "failed" || isStaleRunningRun(run, now),
    }));

    const detectionRuns = runs
      .filter((run) => run.sourceType === "legistar" && run.itemsInserted > 0)
      .map((run) => ({
        id: `${run.id}-detection`,
        source: run.dataSource?.cityName ?? "Unknown",
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        status: displayStatus(run, now),
        candidates: run.itemsInserted,
        conflictsDetected: run.conflictsDetected,
        error: safeErrorSummary(run.errors),
      }));

    const runningJobs = syncRuns.filter(
      (run) => run.status === "running" || run.status === "stale",
    );

    return res.json({
      runs: syncRuns,
      detectionRuns,
      lastSuccessful: {
        legistar: lastLegistar
          ? {
              source: lastLegistar.dataSource?.cityName ?? "Unknown",
              completedAt: lastLegistar.completedAt,
            }
          : null,
        apify: lastApify
          ? {
              source: lastApify.dataSource?.cityName ?? "Unknown",
              completedAt: lastApify.completedAt,
            }
          : null,
      },
      runningJobs,
      rowCounts: {
        jurisdictions: counts[0],
        politicians: counts[1],
        meetings: counts[2],
        agendaItems: counts[3],
        form700Filings: counts[4],
        conflicts: counts[5],
        dataSources: counts[6],
        syncLogs: counts[7],
      },
    });
  } catch (error) {
    console.error("[admin/health] failed to load health data", error);
    return res.status(500).json({
      error: "Unable to load operational health data.",
    });
  }
});

router.post("/runs/:id/retry", async (req, res) => {
  try {
    const run = await prisma.syncLog.findUnique({
      where: { id: req.params.id },
      include: {
        dataSource: true,
      },
    });

    if (!run || !run.dataSource) {
      return res.status(404).json({ error: "Sync run not found." });
    }

    const stale = isStaleRunningRun(run);

    if (run.status !== "failed" && !stale) {
      return res.status(409).json({
        error: "Only failed or stale runs can be retried.",
      });
    }

    const newRun = await prisma.$transaction(async (transaction) => {
      if (stale) {
        await transaction.syncLog.update({
          where: { id: run.id },
          data: {
            status: "failed",
            completedAt: new Date(),
            errors: {
              message: "Run marked stale before retry.",
            },
          },
        });
      }

      return transaction.syncLog.create({
        data: {
          dataSourceId: run.dataSource.id,
          sourceType: run.dataSource.sourceType.toLowerCase(),
          status: "running",
        },
      });
    });

    void executeSourceSync(run.dataSource, newRun.id).catch((error) => {
      console.error("[admin/health] retry failed", error);
    });

    return res.status(202).json({
      id: newRun.id,
      status: "running",
      retriedRunId: run.id,
    });
  } catch (error) {
    console.error("[admin/health] failed to retry run", error);
    return res.status(500).json({
      error: "Unable to retry the sync run.",
    });
  }
});
export default router;