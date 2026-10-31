import { detectConflictsForAgendaItems } from "./detectConflicts.js";
import { prisma as defaultPrisma } from "../lib/prisma.js";

const activeRuns = new Set();
const RUN_LOCK_STALE_MS = 10 * 60 * 1000;

function calendarYearRange(year) {
  return {
    gte: new Date(Date.UTC(year, 0, 1)),
    lt: new Date(Date.UTC(year + 1, 0, 1)),
  };
}

async function loadRunTargets(client, run) {
  if (run.filingId) {
    const filing = await client.form700Filing.findUnique({
      where: { id: run.filingId },
      select: {
        politicianId: true,
        politician: {
          select: {
            id: true,
            jurisdictionId: true,
            jurisdiction: { select: { name: true } },
          },
        },
      },
    });
    if (!filing?.politician) {
      throw new Error("Filing or associated politician no longer exists.");
    }
    if (
      run.jurisdictionId &&
      filing.politician.jurisdictionId !== run.jurisdictionId
    ) {
      throw new Error("The filer is no longer assigned to this detection run's jurisdiction.");
    }
    return [filing.politician];
  }

  const jurisdiction = await client.jurisdiction.findUnique({
    where: { id: run.jurisdictionId },
    select: { id: true, name: true },
  });
  if (!jurisdiction) {
    throw new Error("Detection run jurisdiction no longer exists.");
  }

  const filings = await client.form700Filing.findMany({
    where: {
      filingYear: run.filingYear,
      ...(run.politicianId ? { politicianId: run.politicianId } : {}),
      politician: { jurisdictionId: jurisdiction.id },
    },
    select: { politicianId: true },
    distinct: ["politicianId"],
  });

  if (run.politicianId && filings.length === 0) {
    throw new Error("The selected politician has no filing for this year and jurisdiction.");
  }

  return filings.map((filing) => ({
    id: filing.politicianId,
    jurisdictionId: jurisdiction.id,
    jurisdiction,
  }));
}

async function loadAgendaItems(client, year, politician) {
  if (!politician.jurisdictionId || !politician.jurisdiction?.name) {
    throw new Error(`Politician ${politician.id} has no assigned jurisdiction.`);
  }

  const dateRange = calendarYearRange(year);
  return client.agendaItem.findMany({
    where: {
      OR: [
        {
          meeting: {
            is: {
              jurisdictionId: politician.jurisdictionId,
              meetingDate: dateRange,
            },
          },
        },
        {
          meetingDate: dateRange,
          meeting: { is: { jurisdictionId: politician.jurisdictionId } },
        },
        {
          meetingDate: dateRange,
          cityName: { equals: politician.jurisdiction.name, mode: "insensitive" },
        },
      ],
    },
    select: { id: true },
  });
}

async function updateRunStats(client, runId, overrides = {}) {
  const items = await client.detectionRunItem.findMany({
    where: { detectionRunId: runId },
    select: {
      agendaItemId: true,
      status: true,
      candidateCount: true,
      insertedCount: true,
      duplicateCount: true,
    },
  });
  const failedItems = items.filter((item) => item.status === "failed");
  const agendaItemStatuses = new Map();
  for (const item of items) {
    const statuses = agendaItemStatuses.get(item.agendaItemId) ?? [];
    statuses.push(item.status);
    agendaItemStatuses.set(item.agendaItemId, statuses);
  }
  const runStats = {
    totalItems: agendaItemStatuses.size,
    processedItems: [...agendaItemStatuses.values()].filter((statuses) =>
      statuses.every((status) => status === "completed"),
    ).length,
    candidateCount: items.reduce((total, item) => total + item.candidateCount, 0),
    insertedCount: items.reduce((total, item) => total + item.insertedCount, 0),
    duplicateCount: items.reduce((total, item) => total + item.duplicateCount, 0),
    failureCount: failedItems.length,
    ...overrides,
  };
  await client.detectionRun.update({
    where: { id: runId },
    data: runStats,
  });
  return runStats;
}

async function markRunFailed(client, runId, error) {
  const message = error?.message ?? String(error);
  await updateRunStats(client, runId, {
    status: "failed",
    error: message,
    failureCount: 1,
    completedAt: new Date(),
    lockAt: null,
  });
}

export async function runDetectionRun(runId, deps = {}) {
  const client = deps.prisma ?? defaultPrisma;
  if (activeRuns.has(runId)) return { alreadyRunning: true };

  const now = new Date();
  const claimed = await client.detectionRun.updateMany({
    where: {
      id: runId,
      OR: [
        { status: { in: ["queued", "failed"] } },
        { status: "running", lockAt: null },
        {
          status: "running",
          lockAt: { lt: new Date(now.getTime() - RUN_LOCK_STALE_MS) },
        },
      ],
    },
    data: {
      status: "running",
      startedAt: now,
      completedAt: null,
      lockAt: now,
      error: null,
    },
  });
  if (claimed.count !== 1) return { alreadyRunning: true };

  activeRuns.add(runId);
  try {
    const run = await client.detectionRun.findUnique({ where: { id: runId } });
    if (!run) throw new Error("Detection run not found.");

    const targets = await loadRunTargets(client, run);
    for (const politician of targets) {
      if (run.jurisdictionId && politician.jurisdictionId !== run.jurisdictionId) {
        throw new Error("A target politician is outside this detection run's jurisdiction.");
      }
      if (!run.jurisdictionId) {
        run.jurisdictionId = politician.jurisdictionId;
        await client.detectionRun.update({
          where: { id: runId },
          data: { jurisdictionId: politician.jurisdictionId },
        });
      }
      const agendaItems = await loadAgendaItems(client, run.filingYear, politician);
      if (agendaItems.length > 0) {
        await client.detectionRunItem.createMany({
          data: agendaItems.map(({ id: agendaItemId }) => ({
            detectionRunId: runId,
            agendaItemId,
            politicianId: politician.id,
          })),
          skipDuplicates: true,
        });
      }
    }

    const pendingItems = await client.detectionRunItem.findMany({
      where: { detectionRunId: runId, status: { not: "completed" } },
      orderBy: [{ agendaItemId: "asc" }, { politicianId: "asc" }],
    });

    for (const item of pendingItems) {
      const itemStartedAt = new Date();
      await client.detectionRun.update({
        where: { id: runId },
        data: { lockAt: itemStartedAt },
      });
      await client.detectionRunItem.update({
        where: { id: item.id },
        data: {
          status: "processing",
          attempts: { increment: 1 },
          error: null,
          startedAt: itemStartedAt,
        },
      });

      try {
        const result = await (deps.detectConflictsForAgendaItems ?? detectConflictsForAgendaItems)(
          [item.agendaItemId],
          { prisma: client, politicianIds: [item.politicianId] },
        );
        await client.detectionRunItem.update({
          where: { id: item.id },
          data: {
            status: "completed",
            candidateCount: result.totalCandidates ?? 0,
            insertedCount: result.inserted ?? 0,
            duplicateCount: result.duplicates ?? result.skipped ?? 0,
            error: null,
            completedAt: new Date(),
          },
        });
      } catch (error) {
        await client.detectionRunItem.update({
          where: { id: item.id },
          data: {
            status: "failed",
            error: error?.message ?? String(error),
            completedAt: new Date(),
          },
        });
      }
    }

    const stats = await updateRunStats(client, runId);
    const completed = stats.failureCount === 0;
    const finalRun = await client.detectionRun.update({
      where: { id: runId },
      data: {
        status: completed ? "completed" : "failed",
        error: completed ? null : "One or more agenda items failed detection.",
        completedAt: new Date(),
        lockAt: null,
      },
    });
    return { run: finalRun, ...stats };
  } catch (error) {
    await markRunFailed(client, runId, error);
    return { runId, status: "failed", error: error?.message ?? String(error) };
  } finally {
    activeRuns.delete(runId);
  }
}

export function queueDetectionRun(runId) {
  void runDetectionRun(runId).catch((error) => {
    console.error(`[detection] run ${runId} failed unexpectedly:`, error);
  });
}

export function isDetectionRunActive(runId) {
  return activeRuns.has(runId);
}

export async function createManualDetectionRun({
  jurisdictionId,
  filingYear,
  politicianId = null,
  triggeredBy = null,
}) {
  return defaultPrisma.detectionRun.create({
    data: {
      jurisdictionId,
      filingYear,
      politicianId,
      trigger: "admin_backfill",
      triggeredBy,
      status: "queued",
    },
    select: { id: true },
  });
}

export { calendarYearRange };
