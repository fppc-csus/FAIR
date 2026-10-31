import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

vi.mock("../../src/lib/auth.js", () => ({
  requireAdmin: vi.fn((_req, _res, next) => next()),
}));

vi.mock("../../src/lib/prisma.js", () => ({
  prisma: { detectionRun: { findMany: vi.fn(), findUnique: vi.fn() } },
}));

vi.mock("../../src/detection/detectionRuns.js", () => ({
  createManualDetectionRun: vi.fn(),
  queueDetectionRun: vi.fn(),
  isDetectionRunActive: vi.fn(() => false),
}));

vi.mock("../../src/jobs/scheduleCronJobs.js", () => ({ scheduleCronJobs: vi.fn() }));

import { app } from "../../src/app.js";
import { requireAdmin } from "../../src/lib/auth.js";
import { prisma } from "../../src/lib/prisma.js";
import {
  createManualDetectionRun,
  isDetectionRunActive,
  queueDetectionRun,
} from "../../src/detection/detectionRuns.js";

const ENDPOINT = "/api/admin/detection-runs";
const RUN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const JURISDICTION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockImplementation((_req, _res, next) => next());
  createManualDetectionRun.mockResolvedValue({ id: RUN_ID });
  prisma.detectionRun.findMany.mockResolvedValue([]);
  prisma.detectionRun.findUnique.mockResolvedValue({
    id: RUN_ID,
    status: "failed",
    lockAt: null,
    failureCount: 1,
    items: [{ agendaItemId: "agenda-item", error: "temporary detector failure" }],
  });
  isDetectionRunActive.mockReturnValue(false);
});

describe("admin detection run API", () => {
  it("requires an authenticated admin", async () => {
    requireAdmin.mockImplementation((_req, res) => res.status(401).json({ error: "unauthorized" }));

    const response = await request(app).get(ENDPOINT);

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "unauthorized" });
  });

  it("starts a bounded jurisdiction/year backfill, exposes status, and queues retry", async () => {
    const started = await request(app).post(ENDPOINT).send({
      jurisdiction_id: JURISDICTION_ID,
      filing_year: 2025,
    });

    expect(started.status).toBe(202);
    expect(started.body).toEqual({ detection_run_id: RUN_ID, status: "queued" });
    expect(createManualDetectionRun).toHaveBeenCalledWith({
      jurisdictionId: JURISDICTION_ID,
      filingYear: 2025,
      politicianId: null,
      triggeredBy: null,
    });
    expect(queueDetectionRun).toHaveBeenCalledWith(RUN_ID);

    const inspected = await request(app).get(`${ENDPOINT}/${RUN_ID}`);
    expect(inspected.status).toBe(200);
    expect(inspected.body.data).toMatchObject({
      id: RUN_ID,
      status: "failed",
      failureCount: 1,
      items: [{ agendaItemId: "agenda-item", error: "temporary detector failure" }],
    });

    queueDetectionRun.mockClear();
    const retried = await request(app).post(`${ENDPOINT}/${RUN_ID}/retry`);
    expect(retried.status).toBe(202);
    expect(retried.body).toEqual({ detection_run_id: RUN_ID, status: "queued" });
    expect(queueDetectionRun).toHaveBeenCalledWith(RUN_ID);
  });

  it("rejects unbounded or malformed backfill requests", async () => {
    const response = await request(app).post(ENDPOINT).send({ filing_year: 2025 });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/jurisdiction_id/);
    expect(createManualDetectionRun).not.toHaveBeenCalled();
  });
});
