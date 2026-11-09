import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const prisma = vi.hoisted(() => ({
  politician: { findMany: vi.fn() }, agendaItem: { findMany: vi.fn() },
  jurisdiction: { findMany: vi.fn() }, form700Filing: { findMany: vi.fn() },
}));
vi.mock("../../src/lib/prisma.js", () => ({ prisma }));
import router from "../../src/routes/admin/politicians.js";

const app = express();
// The production mount adds requireAdmin; these tests exercise the route body.
app.use("/api/admin/politicians", router);
beforeEach(() => { vi.clearAllMocks(); prisma.jurisdiction.findMany.mockResolvedValue([]); prisma.form700Filing.findMany.mockResolvedValue([]); });

describe("eligibility review view", () => {
  it("returns unresolved filing politicians and agenda items without changing either", async () => {
    prisma.politician.findMany.mockResolvedValue([{ id: "p", fullName: "Pat", needsReview: false }]);
    prisma.agendaItem.findMany.mockResolvedValue([{ id: "a", cityId: null, cityName: null, meetingDate: null }]);
    const response = await request(app).get("/api/admin/politicians/eligibility-review");
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      politicians: [{ id: "p", reason: "UNRESOLVED_POLITICIAN_JURISDICTION" }],
      agendaItems: [{ id: "a", reason: "MISSING_MEETING_DATE" }],
    });
    expect(prisma.politician.findMany.mock.calls[0][0].where).toEqual({ filings: { some: {} } });
    expect(prisma.agendaItem.findMany.mock.calls[0][0].select.meeting).toBeDefined();
  });

  it("includes reviewable source details and effective dates without exposing confirmed records", async () => {
    prisma.politician.findMany.mockResolvedValue([{ id: "p", fullName: "Pat", slug: "pat", jurisdictionId: "city", jurisdiction: { name: "Oakland" }, needsReview: false }]);
    prisma.form700Filing.findMany.mockResolvedValue([{ id: "f", filerName: "Pat", originalFilename: "pat.xlsx", filingYear: 2024 }]);
    prisma.jurisdiction.findMany.mockResolvedValue([{ id: "city", name: "Oakland", type: "city" }]);
    prisma.agendaItem.findMany.mockResolvedValue([{ id: "a", title: "Permit", sourceUrl: "https://example.org/agenda.pdf", meetingDate: null, meeting: { meetingDate: new Date("2024-02-01T00:00:00.000Z") } }]);
    const response = await request(app).get("/api/admin/politicians/eligibility-review");
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      jurisdictions: [{ name: "Oakland" }],
      politicians: [{ slug: "pat", jurisdiction: { name: "Oakland" }, reason: "UNVERIFIED_POLITICIAN_JURISDICTION" }],
      filings: [{ originalFilename: "pat.xlsx", reason: "UNVERIFIED_FILING_YEAR" }],
      agendaItems: [{ sourceUrl: "https://example.org/agenda.pdf", effectiveMeetingDate: "2024-02-01T00:00:00.000Z" }],
    });
  });
});