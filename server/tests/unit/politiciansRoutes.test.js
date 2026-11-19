import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// Data routes require an investigator session; auth itself is covered in
// auth.test.js and investigatorAccess.test.js.
vi.mock("../../src/lib/auth.js", () => ({
  requireAdmin: vi.fn((_req, _res, next) => next()),
  requireAuthenticated: vi.fn((_req, _res, next) => next()),
  requireOwner: vi.fn((_req, _res, next) => next()),
}));

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
        officeTitle: "Supervisor",
        needsReview: true,
        jurisdiction: { name: "County of Sonoma" },
        filings: [{ filingYear: 2019 }, { filingYear: 2019 }],
        _count: {
          conflicts: 2,
          scheduleAInvestments: 3,
          scheduleCdeIncome: 1,
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
          officeTitle: "Supervisor",
          district: "District 1",
          jurisdiction: "County of Sonoma",
          identityVerified: false,
          filingYears: [2019],
          disclosureCount: 4,
          conflictCount: 2,
        },
        {
          id: "politician-2",
          fullName: "John Doe",
          officeTitle: null,
          district: null,
          jurisdiction: null,
          identityVerified: null,
          filingYears: [],
          disclosureCount: 0,
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

const POLITICIAN_ID = "2375dc6a-e271-4d7a-a9e1-41a157276190";
const dossierRow = {
  id: POLITICIAN_ID,
  slug: "lynda-hopkins",
  fullName: "Lynda Hopkins",
  officeTitle: "Supervisor",
  district: null,
  needsReview: true,
  jurisdiction: { id: "county", name: "County of Sonoma", type: "county" },
  filings: [{
    id: "filing-1",
    filingYear: 2019,
    filedAt: "2020-03-01T00:00:00.000Z",
    importMetadata: { selection: "latest_per_schedule" },
    scheduleAInvestments: [],
    scheduleA2Positions: [{ id: "a2", entityName: "Foggy River Farm", details: [{ label: "GENERAL DESCRIPTION OF BUSINESS ACTIVITY", value: "Farm" }] }],
    scheduleBRealEstate: [],
    scheduleCdeIncome: [
      { id: "c", scheduleType: "C", sourceName: "LandPaths", amount: "$10,001 - $100,000", details: [{ label: "YOUR BUSINESS POSITION", value: "Spouse" }] },
      { id: "d", scheduleType: "D", sourceName: "Farm Bureau", amount: "125" },
    ],
  }],
  conflicts: [{
    id: "conflict-1", conflictType: "INCOME", severity: "HIGH", entityName: "LandPaths", reviewStatus: "pending",
    agendaItemId: "agenda-1", agendaItem: { id: "agenda-1", title: "Tourism Impact Fund Awards", meetingDate: "2019-12-17T08:00:00.000Z" },
  }],
  votes: [],
};

describe("GET /api/politicians/:slugOrId (investigator dossier)", () => {
  it("returns every schedule, row details, conflicts and identity status", async () => {
    prisma.politician.findUnique.mockResolvedValue(dossierRow);
    prisma.politicianReviewEvent = { findMany: vi.fn().mockResolvedValue([{ id: "event", action: "approved" }]) };

    const res = await request(app).get(`/api/politicians/id/${POLITICIAN_ID}`);

    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data).toMatchObject({ fullName: "Lynda Hopkins", identityVerified: false, city: "County of Sonoma" });
    expect(data.filings[0].income).toEqual([expect.objectContaining({ sourceName: "LandPaths", details: [{ label: "YOUR BUSINESS POSITION", value: "Spouse" }] })]);
    expect(data.filings[0].gifts).toHaveLength(1);
    expect(data.filings[0].businessPositions[0].entityName).toBe("Foggy River Farm");
    expect(data.filings[0]).not.toHaveProperty("scheduleCdeIncome");
    expect(data.summary).toMatchObject({ disclosures: { income: 1, gifts: 1, businessPositions: 1 }, conflicts: { total: 1, pending: 1, high: 1 } });
    expect(data.reviewEvents).toHaveLength(1);
    const select = prisma.politician.findUnique.mock.calls[0][0].select;
    expect(select.conflicts.where).toEqual({ OR: [{ eligibilityStatus: null }, { eligibilityStatus: "active" }] });
    expect(select.filings.select.scheduleCdeIncome.select.details).toBe(true);
  });

  it("serves the same dossier by slug", async () => {
    prisma.politician.findUnique.mockResolvedValue(dossierRow);
    const res = await request(app).get("/api/politicians/lynda-hopkins");
    expect(res.status).toBe(200);
    expect(prisma.politician.findUnique.mock.calls[0][0].where).toEqual({ slug: "lynda-hopkins", isDemo: false });
    expect(res.body.data.slug).toBe("lynda-hopkins");
  });

  it("returns 404 when the politician does not exist", async () => {
    prisma.politician.findUnique.mockResolvedValue(null);
    const res = await request(app).get("/api/politicians/id/missing-politician");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Politician not found" });
  });
});
