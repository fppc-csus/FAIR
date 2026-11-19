import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/auth.js", () => ({
  requireAdmin: vi.fn((_req, _res, next) => next()),
}));

vi.mock("../../src/lib/prisma.js", () => ({
  prisma: {
    jurisdiction: { count: vi.fn() },
    politician: { count: vi.fn() },
    meeting: { count: vi.fn() },
    agendaItem: { count: vi.fn() },
    form700Filing: { count: vi.fn() },
    conflict: { count: vi.fn() },
    dataSource: { count: vi.fn() },
    syncLog: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("../../src/services/sourceSync.js", () => ({
  executeSourceSync: vi.fn(),
}));

import { requireAdmin } from "../../src/lib/auth.js";
import { prisma } from "../../src/lib/prisma.js";
import { executeSourceSync } from "../../src/services/sourceSync.js";
import healthRouter from "../../src/routes/admin/health.js";

const app = express();
app.use(express.json());
app.use("/api/admin/health", requireAdmin, healthRouter);

const successfulLegistarRun = {
  id: "run-legistar",
  sourceType: "legistar",
  status: "success",
  startedAt: new Date("2026-11-08T02:00:00.000Z"),
  completedAt: new Date("2026-11-08T02:05:00.000Z"),
  itemsFound: 10,
  itemsInserted: 4,
  itemsSkipped: 6,
  conflictsDetected: 2,
  documentsFound: 0,
  pdfsFetched: 0,
  documentsSkipped: 0,
  detectionErrors: [],
  errors: null,
  dataSource: { cityName: "Sacramento", sourceType: "legistar" },
};

const failedApifyRun = {
  id: "run-apify",
  sourceType: "apify",
  status: "failed",
  startedAt: new Date("2026-11-07T03:00:00.000Z"),
  completedAt: new Date("2026-11-07T03:10:00.000Z"),
  itemsFound: 5,
  itemsInserted: 0,
  itemsSkipped: 5,
  conflictsDetected: 0,
  documentsFound: 5,
  pdfsFetched: 4,
  documentsSkipped: 1,
  detectionErrors: [{
    agendaItemIds: ["agenda-1", "agenda-2"],
    message: "Conflict detector unavailable",
  }],
  errors: [{
    pdfUrl: "https://city.test/agenda.pdf?access_token=secret#page=1",
    message: "PDF contained no parseable agenda text",
  }],
  dataSource: {
   id: "source-apify",
   cityName: "Elk Grove",
   sourceType: "apify",
},
};

beforeEach(() => {
  vi.clearAllMocks();

  requireAdmin.mockImplementation((_req, _res, next) => next());

  prisma.syncLog.findMany.mockResolvedValue([
    successfulLegistarRun,
    failedApifyRun,
  ]);

  prisma.syncLog.findFirst
    .mockResolvedValueOnce(successfulLegistarRun)
    .mockResolvedValueOnce(null);

  prisma.syncLog.findUnique.mockResolvedValue(failedApifyRun);
  prisma.syncLog.update.mockResolvedValue(failedApifyRun);
  prisma.syncLog.create.mockResolvedValue({
    id: "retry-run",
    status: "running",
  });

  prisma.jurisdiction.count.mockResolvedValue(1);
  prisma.politician.count.mockResolvedValue(2);
  prisma.meeting.count.mockResolvedValue(3);
  prisma.agendaItem.count.mockResolvedValue(4);
  prisma.form700Filing.count.mockResolvedValue(5);
  prisma.conflict.count.mockResolvedValue(6);
  prisma.dataSource.count.mockResolvedValue(7);
  prisma.syncLog.count.mockResolvedValue(8);

  prisma.$transaction.mockImplementation(async (callback) => callback(prisma));
  executeSourceSync.mockResolvedValue(undefined);
});

describe("admin health API", () => {
  it("returns sync status, detection summaries, last successful runs, and row counts", async () => {
    const response = await request(app).get("/api/admin/health");

    expect(response.status).toBe(200);
    expect(response.body.runs).toHaveLength(2);
    expect(response.body.runs[0]).toMatchObject({
      id: "run-legistar",
      source: "Sacramento",
      status: "success",
      itemsFound: 10,
      itemsInserted: 4,
      conflictsDetected: 2,
    });
    expect(response.body.detectionRuns).toHaveLength(1);
    expect(response.body.lastSuccessful.legistar.source).toBe("Sacramento");
    expect(response.body.lastSuccessful.apify).toBeNull();
    expect(response.body.rowCounts).toEqual({
      jurisdictions: 1,
      politicians: 2,
      meetings: 3,
      agendaItems: 4,
      form700Filings: 5,
      conflicts: 6,
      dataSources: 7,
      syncLogs: 8,
    });
  });

  it("returns safe error summaries and marks failed runs retryable", async () => {
    const response = await request(app).get("/api/admin/health");

    const failedRun = response.body.runs.find((run) => run.id === "run-apify");

    expect(failedRun).toMatchObject({
      status: "failed",
      error: "PDF contained no parseable agenda text",
      documentsFound: 5,
      pdfsFetched: 4,
      documentsSkipped: 1,
      sourceLimitations: [{
        url: "https://city.test/agenda.pdf",
        message: "PDF contained no parseable agenda text",
      }],
      detectionErrors: [{
        agendaItemCount: 2,
        message: "Conflict detector unavailable",
      }],
      retryEligible: true,
    });
    expect(JSON.stringify(failedRun)).not.toContain("access_token");
  });

  it("retries an eligible failed run through the shared source pipeline", async () => {
    const response = await request(app).post(
      "/api/admin/health/runs/run-apify/retry",
    );

    expect(response.status).toBe(202);
    expect(response.body).toEqual({
      id: "retry-run",
      status: "running",
      retriedRunId: "run-apify",
    });
    expect(prisma.syncLog.create).toHaveBeenCalledWith({
      data: {
        dataSourceId: expect.any(String),
        sourceType: "apify",
        status: "running",
      },
    });
    expect(executeSourceSync).toHaveBeenCalledWith(
      failedApifyRun.dataSource,
      "retry-run",
    );
  });

  it("rejects retrying a successful run", async () => {
    prisma.syncLog.findUnique.mockResolvedValue(successfulLegistarRun);

    const response = await request(app).post(
      "/api/admin/health/runs/run-legistar/retry",
    );

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: "Only failed or stale runs can be retried.",
    });
    expect(executeSourceSync).not.toHaveBeenCalled();
  });

  it("requires admin authentication", async () => {
    requireAdmin.mockImplementation((_req, res) =>
      res.status(401).json({ error: "unauthorized" }),
    );

    const response = await request(app).get("/api/admin/health");

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "unauthorized" });
    expect(prisma.syncLog.findMany).not.toHaveBeenCalled();
  });
});