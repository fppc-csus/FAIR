import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const prisma = vi.hoisted(() => ({
  politician: { findMany: vi.fn() }, agendaItem: { findMany: vi.fn() },
}));
vi.mock("../../src/lib/prisma.js", () => ({ prisma }));
import router from "../../src/routes/admin/politicians.js";

const app = express();
// The production mount adds requireAdmin; these tests exercise the route body.
app.use("/api/admin/politicians", router);
beforeEach(() => vi.clearAllMocks());

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
    expect(prisma.politician.findMany.mock.calls[0][0].where).toEqual({ filings: { some: {} }, OR: [{ jurisdictionId: null }, { needsReview: true }] });
    expect(prisma.agendaItem.findMany.mock.calls[0][0].where.meetingId).toBeNull();
  });
});