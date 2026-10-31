import { describe, expect, it, vi } from "vitest";
import { createMockPrisma } from "../fixtures/mockDb.js";

import {
  matchingRealEstateAgendaItem,
  matchingIncomeAgendaItem,
  matchingGiftAgendaItem,
  matchingTravelAgendaItem,
  matchingBusinessPositionAgendaItem,
  nonMatchingAgendaItem,
} from "../fixtures/agendaItems.js";

import {
  scheduleBFixtures,
  scheduleCdeFixtures,
  scheduleA2Fixtures,
} from "../fixtures/schedules.js";

vi.mock("../../src/detection/matchEntity.js", () => ({
  getAgendaText: (item = {}) =>
    [item.item_text, item.itemText, item.description, item.title]
      .filter((value) => value != null && String(value).trim() !== "")
      .join("\n"),

  pickField: (row, ...keys) => {
    if (!row) return undefined;
    for (const key of keys) {
      if (row[key] != null && row[key] !== "") {
        return row[key];
      }
    }
    return undefined;
  },

  normalizeEntityName: (value) =>
    String(value || "").toLowerCase().trim(),

  matchNamedEntity: vi.fn(),
}));

import { detectConflictsForAgendaItems } from "../../src/detection/detectConflicts.js";

describe("detectConflictsForAgendaItems", () => {
  it("detects and persists conflicts using mock database data", async () => {
    const mockPrisma = createMockPrisma({
      agendaItems: [matchingRealEstateAgendaItem],
      scheduleB: scheduleBFixtures,
      scheduleCde: [],
      scheduleA2: [],
    });

    const result = await detectConflictsForAgendaItems([100], {
      prisma: mockPrisma, eligibilityPolicy: { period: "YEAR_OFFSETS", offsets: [1] },
    });

    expect(result.totalCandidates).toBe(1);
    expect(result.inserted).toBe(1);
    expect(mockPrisma.__insertedConflicts).toHaveLength(1);

    expect(mockPrisma.__insertedConflicts[0]).toMatchObject({
      disclosureId: "disclosure-b", filingId: "filing-1",
      politicianId: 1,
      agendaItemId: 100,
      conflictType: "REAL_ESTATE",
    });
  });

  it("does not insert duplicate conflicts on a second run", async () => {
  const mockPrisma = createMockPrisma({
    agendaItems: [
      {
        id: 100,
        cityName: "Sacramento", meetingDate: "2026-03-01",
        item_text:
          "Approve zoning changes for property located at 123 Main Street.",
      },
    ],

    scheduleB: [
      {
        id: "disclosure-b", filingId: "filing-1",
        politicianId: 1,
        filingYear: 2025, politicianJurisdictionId: "sac",
        propertyDescription: "123 Main Street",
        city: "Sacramento",
        county: "Sacramento",
      },
    ],

    scheduleCde: [],
    scheduleA2: [],
  });

  const firstRun = await detectConflictsForAgendaItems([100], {
    prisma: mockPrisma, eligibilityPolicy: { period: "YEAR_OFFSETS", offsets: [1] },
  });

  const secondRun = await detectConflictsForAgendaItems([100], {
    prisma: mockPrisma, eligibilityPolicy: { period: "YEAR_OFFSETS", offsets: [1] },
  });

  expect(firstRun.inserted).toBe(1);

  expect(secondRun.inserted).toBe(0);
  expect(secondRun.skipped).toBe(1);

  expect(mockPrisma.__insertedConflicts).toHaveLength(1);
});

it("does not change review status or notes when a conflict is redetected", async () => {
  const reviewedConflict = {
    politicianId: 1,
    agendaItemId: 100,
    conflictType: "REAL_ESTATE",
    sourceKey: "REAL_ESTATE:123 main st",
    reviewStatus: "confirmed_conflict",
    reviewNote: "Reviewed and confirmed.",
    reviewedAt: new Date("2026-01-15T12:00:00.000Z"),
  };
  const mockPrisma = createMockPrisma({
    agendaItems: [
      {
        id: 100,
        item_text: "Approve zoning changes for property located at 123 Main Street.",
      },
    ],
    scheduleB: [
      {
        politicianId: 1,
        propertyDescription: "123 Main Street",
        city: "Sacramento",
        county: "Sacramento",
      },
    ],
    initialConflicts: [reviewedConflict],
  });

  const result = await detectConflictsForAgendaItems([100], { prisma: mockPrisma });

  expect(result.inserted).toBe(0);
  expect(result.duplicates).toBe(1);
  expect(mockPrisma.__insertedConflicts).toEqual([reviewedConflict]);
});

it("does not persist conflicts when agenda items have no matching entities", async () => {
  const mockPrisma = createMockPrisma({
    agendaItems: [nonMatchingAgendaItem],
    scheduleB: scheduleBFixtures,
    scheduleCde: [],
    scheduleA2: [],
  });

  const result = await detectConflictsForAgendaItems([300], {
    prisma: mockPrisma, eligibilityPolicy: { period: "YEAR_OFFSETS", offsets: [1] },
  });

  expect(result.totalCandidates).toBe(0);
  expect(result.inserted).toBe(0);
  expect(mockPrisma.__insertedConflicts).toHaveLength(0);
});

it("detects conflicts across all supported schedule types", async () => {
  const mockPrisma = createMockPrisma({
    agendaItems: [
      matchingRealEstateAgendaItem,
      matchingIncomeAgendaItem,
      matchingGiftAgendaItem,
      matchingTravelAgendaItem,
      matchingBusinessPositionAgendaItem,
    ],
    scheduleB: scheduleBFixtures,
    scheduleCde: scheduleCdeFixtures,
    scheduleA2: scheduleA2Fixtures,
  });

  const matchNamedEntity = vi.fn(async (entityName, agendaText) => ({
    matched: agendaText.includes(entityName),
    score: agendaText.includes(entityName) ? 0.95 : 0.2,
  }));

  const result = await detectConflictsForAgendaItems(
    [100, 200, 201, 202, 203],
    {
      prisma: mockPrisma,
      eligibilityPolicy: { period: "YEAR_OFFSETS", offsets: [1] },
      matchNamedEntity,
    },
  );

  expect(result.totalCandidates).toBeGreaterThanOrEqual(5);
  expect(result.inserted).toBeGreaterThanOrEqual(5);

  const conflictTypes = mockPrisma.__insertedConflicts.map(
    (row) => row.conflictType,
  );

  expect(conflictTypes).toContain("REAL_ESTATE");
  expect(conflictTypes).toContain("INCOME");
  expect(conflictTypes).toContain("GIFT");
  expect(conflictTypes).toContain("TRAVEL");
  expect(conflictTypes).toContain("BUSINESS_POSITION");
});

}); 