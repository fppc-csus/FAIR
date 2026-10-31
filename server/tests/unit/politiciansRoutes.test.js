import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("../../src/lib/prisma.js", () => {
  const prisma = {
    politician: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
  };

  return { prisma, default: prisma };
});

// Prevent tests from touching the cron scheduler.
vi.mock("../../src/jobs/scheduleCronJobs.js", () => ({
  scheduleCronJobs: vi.fn(),
}));

import { app } from "../../src/app.js";
import { prisma } from "../../src/lib/prisma.js";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/politicians", () => {
  it("returns politicians with their conflict counts", async () => {
    prisma.politician.findMany.mockResolvedValue([
      {
        id: "politician-1",
        fullName: "Jane Smith",
        district: "District 1",
        _count: {
          conflicts: 2,
        },
      },
      {
        id: "politician-2",
        fullName: "John Doe",
        district: null,
        _count: {
          conflicts: 0,
        },
      },
    ]);

    const res = await request(app).get("/api/politicians");

    expect(res.status).toBe(200);
    expect(prisma.politician.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { isDemo: false },
    }));

    expect(res.body).toEqual({
      data: [
        {
          id: "politician-1",
          fullName: "Jane Smith",
          district: "District 1",
          conflictCount: 2,
        },
        {
          id: "politician-2",
          fullName: "John Doe",
          district: null,
          conflictCount: 0,
        },
      ],
    });
  });

  it("caps explicitly requested list sizes", async () => {
    prisma.politician.findMany.mockResolvedValue([]);

    const res = await request(app).get("/api/politicians?limit=5000");

    expect(res.status).toBe(200);
    expect(prisma.politician.findMany.mock.calls[0][0].select._count.select.conflicts).toEqual({
      where: { OR: [{ eligibilityStatus: null }, { eligibilityStatus: "active" }] },
    });
    expect(prisma.politician.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 500 }));
  });
});

describe("GET /api/politicians/id/:id", () => {
  it("returns a politician with filings and conflicts", async () => {
    prisma.politician.findUnique.mockResolvedValue({
      id: "politician-1",
      fullName: "Jane Smith",
      district: "District 1",
      filings: [
        {
          id: "filing-1",
          filingYear: 2025,
          filedAt: "2025-04-01T00:00:00.000Z",
          filerName: "Jane Smith",
        },
      ],
      conflicts: [
        {
          id: "conflict-1",
          conflictType: "REAL_ESTATE",
          severity: "HIGH",
          entityName: "123 Main Street",
          ruleReference: "Rule 1",
          detectedAt: "2026-09-01T00:00:00.000Z",
          agendaItemId: "agenda-1",
          agendaItem: {
            id: "agenda-1",
            title: "Development Project",
            meetingDate: "2026-09-10T00:00:00.000Z",
          },
        },
      ],
    });

    const res = await request(app).get(
      "/api/politicians/id/politician-1",
    );

    expect(res.status).toBe(200);
    expect(res.body.data.fullName).toBe("Jane Smith");
    expect(res.body.data.filings).toHaveLength(1);
    expect(res.body.data.conflicts).toHaveLength(1);
    expect(res.body.data.conflicts[0].agendaItem.id).toBe("agenda-1");
    expect(prisma.politician.findUnique.mock.calls[0][0].select.conflicts.where).toEqual({
      OR: [{ eligibilityStatus: null }, { eligibilityStatus: "active" }],
    });
  });
  it("returns 404 when the politician does not exist", async () => {
  prisma.politician.findUnique.mockResolvedValue(null);

  const res = await request(app).get(
    "/api/politicians/id/missing-politician",
  );

  expect(res.status).toBe(404);
  expect(res.body).toEqual({
    error: "Politician not found",
  });
});
});

