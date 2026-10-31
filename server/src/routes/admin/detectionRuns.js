import express from "express";
import { prisma } from "../../lib/prisma.js";
import {
  createManualDetectionRun,
  isDetectionRunActive,
  queueDetectionRun,
} from "../../detection/detectionRuns.js";

const router = express.Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RUN_LOCK_STALE_MS = 10 * 60 * 1000;

function parseFilingYear(value) {
  const year = Number(value);
  return Number.isInteger(year) && year >= 1900 && year <= 2100 ? year : null;
}

router.post("/", async (req, res, next) => {
  try {
    const jurisdictionId = req.body?.jurisdiction_id;
    const politicianId = req.body?.politician_id ?? null;
    const filingYear = parseFilingYear(req.body?.filing_year);
    if (!UUID_RE.test(jurisdictionId ?? "")) {
      return res.status(400).json({ error: "jurisdiction_id must be a UUID." });
    }
    if (!filingYear) {
      return res.status(400).json({ error: "filing_year must be a year from 1900 through 2100." });
    }
    if (politicianId !== null && !UUID_RE.test(politicianId)) {
      return res.status(400).json({ error: "politician_id must be a UUID." });
    }

    const run = await createManualDetectionRun({
      jurisdictionId,
      filingYear,
      politicianId,
      triggeredBy: req.user?.id ?? null,
    });
    queueDetectionRun(run.id);
    return res.status(202).json({ detection_run_id: run.id, status: "queued" });
  } catch (error) {
    return next(error);
  }
});

router.get("/", async (_req, res, next) => {
  try {
    const runs = await prisma.detectionRun.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        status: true,
        trigger: true,
        filingYear: true,
        jurisdictionId: true,
        politicianId: true,
        totalItems: true,
        processedItems: true,
        candidateCount: true,
        insertedCount: true,
        duplicateCount: true,
        failureCount: true,
        error: true,
        createdAt: true,
        completedAt: true,
      },
    });
    return res.json({ data: runs });
  } catch (error) {
    return next(error);
  }
});

router.get("/:runId", async (req, res, next) => {
  try {
    if (!UUID_RE.test(req.params.runId)) {
      return res.status(400).json({ error: "Detection run id must be a UUID." });
    }
    const run = await prisma.detectionRun.findUnique({
      where: { id: req.params.runId },
      include: {
        items: {
          where: { status: "failed" },
          orderBy: { updatedAt: "desc" },
          select: {
            agendaItemId: true,
            politicianId: true,
            attempts: true,
            candidateCount: true,
            insertedCount: true,
            duplicateCount: true,
            error: true,
            updatedAt: true,
          },
        },
      },
    });
    if (!run) return res.status(404).json({ error: "Detection run not found." });
    return res.json({ data: run });
  } catch (error) {
    return next(error);
  }
});

router.post("/:runId/retry", async (req, res, next) => {
  try {
    if (!UUID_RE.test(req.params.runId)) {
      return res.status(400).json({ error: "Detection run id must be a UUID." });
    }
    const existing = await prisma.detectionRun.findUnique({
      where: { id: req.params.runId },
      select: { id: true, status: true, lockAt: true },
    });
    if (!existing) return res.status(404).json({ error: "Detection run not found." });
    const lockIsFresh =
      existing.lockAt &&
      existing.lockAt.valueOf() >= Date.now() - RUN_LOCK_STALE_MS;
    if (
      existing.status === "completed" ||
      isDetectionRunActive(existing.id) ||
      (existing.status === "running" && lockIsFresh)
    ) {
      return res.status(409).json({ error: "Detection run is active or already complete." });
    }
    queueDetectionRun(existing.id);
    return res.status(202).json({ detection_run_id: existing.id, status: "queued" });
  } catch (error) {
    return next(error);
  }
});

export default router;
