import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("../../src/lib/prisma.js", () => {
  const prisma = {
    agendaItem: {
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

describe("GET /api/agenda/:id", () => {
  it("returns an agenda item with its linked conflicts", async () => {
    prisma.agendaItem.findUnique.mockResolvedValue({
      id: "agenda-1",
      title: "Development Project",
      description: "Project description",
      itemText: "Full agenda item text",
      itemNumber: "10",
      meetingDate: "2026-09-10T00:00:00.000Z",
      cityName: "Sacramento",
      sourceType: "legistar",
      bodyName: "City Council",
      conflicts: [
        {
          id: "conflict-1",
          conflictType: "REAL_ESTATE",
          severity: "HIGH",
          entityName: "123 Main Street",
          ruleReference: "Rule 1",
          detectedAt: "2026-09-01T00:00:00.000Z",
          politician: {
            id: "politician-1",
            fullName: "Jane Smith",
            district: "District 1",
          },
        },
      ],
    });

    const res = await request(app).get("/api/agenda/agenda-1");

    expect(res.status).toBe(200);
    expect(prisma.agendaItem.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'agenda-1', isDemo: false },
    }));
    expect(res.body.data.title).toBe("Development Project");
    expect(res.body.data.itemText).toBe("Full agenda item text");
    expect(res.body.data.meetingDate).toBe(
      "2026-09-10T00:00:00.000Z",
    );
    expect(res.body.data.cityName).toBe("Sacramento");
    expect(res.body.data.sourceType).toBe("legistar");
    expect(res.body.data.conflicts).toHaveLength(1);
    expect(res.body.data.conflicts[0].politician.id).toBe(
      "politician-1",
    );
  });
  it("returns 404 when the agenda item does not exist", async () => {
  prisma.agendaItem.findUnique.mockResolvedValue(null);

  const res = await request(app).get("/api/agenda/missing-agenda");

  expect(res.status).toBe(404);
  expect(res.body).toEqual({
    error: "Agenda item not found",
  });
});

describe("GET /api/agenda", () => {
  it("bounds an explicitly limited public list request", async () => {
    prisma.agendaItem.findMany.mockResolvedValue([]);

    const res = await request(app).get("/api/agenda?limit=25");

    expect(res.status).toBe(200);
    expect(prisma.agendaItem.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 25 }));
  });
});
});