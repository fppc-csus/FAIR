import { describe, it, expect } from "vitest";
import { persistConflicts } from "../../src/detection/persistConflicts.js";
import { collapseCandidates, detectConflictsForAgendaItems } from "../../src/detection/detectConflicts.js";

function identity(row) {
  return `${row.politicianId}|${row.agendaItemId}|${row.conflictType}|${row.sourceKey}`;
}

function createMemoryPrisma(seed = {}) {
  const conflicts = [];

  const prisma = {
    jurisdiction: { findMany: async () => [{ id: "sac", name: "Sacramento" }] },
    $transaction: async (fn) => fn(prisma),
    _conflicts: conflicts,
    agendaItem: {
      findMany: async ({ where } = {}) => {
        const ids = where?.id?.in || [];
        return (seed.agendaItems || []).filter((item) => ids.includes(item.id));
      },
    },
    scheduleBRealEstate: {
      findMany: async ({ where }) => (seed.scheduleB || []).filter((row) => where.filing.politician.OR[0].jurisdictionId.in.includes(row.politicianJurisdictionId)),
    },
    scheduleCdeIncome: {
      findMany: async ({ where }) => (seed.scheduleCde || []).filter((row) => where.filing.politician.OR[0].jurisdictionId.in.includes(row.politicianJurisdictionId)),
    },
    scheduleA2BusinessPosition: {
      findMany: async ({ where }) => (seed.scheduleA2 || []).filter((row) => where.filing.politician.OR[0].jurisdictionId.in.includes(row.politicianJurisdictionId)),
    },
    conflict: {
      findMany: async () => conflicts,
      update: async ({ where, data }) => Object.assign(conflicts.find((row) => row.id === where.id), data),
      createMany: async ({ data, skipDuplicates }) => {
        let count = 0;
        for (const row of data) {
          if (skipDuplicates && conflicts.some((existing) => identity(existing) === identity(row))) {
            continue;
          }
          conflicts.push({ ...row, id: `conflict-${conflicts.length}` });
          count += 1;
        }
        return { count };
      },
    },
  };
  return prisma;
}

const candidate = {
  politician_id: "pol-1",
  agenda_item_id: "item-1",
  conflict_type: "INCOME",
  severity: "MEDIUM",
  rule_reference: "Cal. Gov. Code §87100, §87103(c)",
  entity_name: "Acme Builders",
  source_key: "INCOME:acme builders",
};

describe("persistConflicts", () => {
  it("inserts no new rows on a duplicate persist of the same match", async () => {
    const prisma = createMemoryPrisma();

    const first = await persistConflicts([candidate], { prisma });
    expect(first.inserted).toBe(1);
    expect(first.skipped).toBe(0);

    const second = await persistConflicts([candidate], { prisma });
    expect(second.inserted).toBe(0);
    expect(second.skipped).toBe(1);
    expect(prisma._conflicts).toHaveLength(1);
  });

  it("allows two different holdings on the same item", async () => {
    const prisma = createMemoryPrisma();
    const other = {
      ...candidate,
      entity_name: "Northstar Paving",
      source_key: "INCOME:northstar paving",
    };

    const result = await persistConflicts([candidate, other], { prisma });
    expect(result.inserted).toBe(2);
    expect(prisma._conflicts).toHaveLength(2);
  });
});

describe("detectConflictsForAgendaItems", () => {
  it("runs detectors and does not insert duplicates on a second run", async () => {
    const prisma = createMemoryPrisma({
      agendaItems: [
        {
          id: "item-1",
          cityName: "Sacramento", meetingDate: "2026-03-01",
          title: "Award sidewalk contract to Acme Builders",
          description: "Construction services.",
        },
      ],
      scheduleB: [],
      scheduleCde: [
        {
          id: "disclosure-c", filingId: "filing-1",
          politicianId: "pol-1",
          filingYear: 2025, politicianJurisdictionId: "sac",
          sourceName: "Acme Builders",
          amount: "$2,500",
          scheduleType: "C",
        },
      ],
      scheduleA2: [],
    });

    const first = await detectConflictsForAgendaItems(["item-1"], { prisma, eligibilityPolicy: { period: "YEAR_OFFSETS", offsets: [1] } });
    expect(first.inserted).toBe(1);
    expect(first.totalCandidates).toBe(1);

    const second = await detectConflictsForAgendaItems(["item-1"], { prisma, eligibilityPolicy: { period: "YEAR_OFFSETS", offsets: [1] } });
    expect(second.inserted).toBe(0);
    expect(prisma._conflicts).toHaveLength(1);
  });

    it("loads stored Schedule A-2 rows into business-position detection", async () => {
    const prisma = createMemoryPrisma({
      agendaItems: [
        {
          id: "item-a2",
          cityName: "Sacramento", meetingDate: "2026-03-01",
          title: "Design review for Riverbank Development LLC",
          description: "Business position conflict test.",
        },
      ],
      scheduleA2: [
        {
          id: "disclosure-a2", filingId: "filing-1",
          politicianId: "pol-1",
          filingYear: 2025, politicianJurisdictionId: "sac",
          entityName: "Riverbank Development LLC",
          businessPosition: "Managing Member",
        },
      ],
    });

    const result = await detectConflictsForAgendaItems(["item-a2"], { prisma, eligibilityPolicy: { period: "YEAR_OFFSETS", offsets: [1] } });

    expect(result.inserted).toBe(1);
    expect(result.totalCandidates).toBe(1);
    expect(prisma._conflicts[0]).toMatchObject({
      conflictType: "BUSINESS_POSITION",
      entityName: "Riverbank Development LLC",
    });
  });

  it("reports one conflict when the same source appears on two lines of one statement", async () => {
    // Filer's salary and spouse's income from the same employer.
    const line = { filingId: "filing-1", politicianId: "pol-1", filingYear: 2025, politicianJurisdictionId: "sac",
      sourceName: "Sonoma Ecology Center", amount: "$10,001 - $100,000", scheduleType: "C" };
    const prisma = createMemoryPrisma({
      agendaItems: [{ id: "item-dup", cityName: "Sacramento", meetingDate: "2026-03-01", title: "Grant to Sonoma Ecology Center" }],
      scheduleCde: [{ ...line, id: "disclosure-b" }, { ...line, id: "disclosure-a" }],
    });

    const result = await detectConflictsForAgendaItems(["item-dup"], { prisma, eligibilityPolicy: { period: "YEAR_OFFSETS", offsets: [1] } });

    expect(result.totalCandidates).toBe(2);
    expect(result.inserted).toBe(1);
    expect(prisma._conflicts).toHaveLength(1);
    expect(prisma._conflicts[0]).toMatchObject({ disclosureId: "disclosure-a", entityName: "Sonoma Ecology Center" });
  });

  it("returns zeros for an empty id list", async () => {
    const result = await detectConflictsForAgendaItems([]);
    expect(result).toEqual({ inserted: 0, skipped: 0, totalCandidates: 0 });
  });
});

describe("collapseCandidates", () => {
  const base = { politician_id: "p", agenda_item_id: "i", conflict_type: "INCOME", entity_name: "Acme Builders, Inc." };

  it("keeps the most severe candidate, then the lowest disclosure id", () => {
    const kept = collapseCandidates([
      { ...base, severity: "MEDIUM", disclosureId: "a", source_key: "INCOME:acme:disclosure:a" },
      { ...base, entity_name: "ACME BUILDERS INC", severity: "HIGH", disclosureId: "c", source_key: "INCOME:acme:disclosure:c" },
      { ...base, severity: "HIGH", disclosureId: "b", source_key: "INCOME:acme:disclosure:b" },
    ]);
    expect(kept).toHaveLength(1);
    expect(kept[0].disclosureId).toBe("b");
  });

  it("keeps different entities, types, officials and items apart", () => {
    const kept = collapseCandidates([
      { ...base, severity: "LOW", disclosureId: "a" },
      { ...base, entity_name: "Other Co", severity: "LOW", disclosureId: "a" },
      { ...base, conflict_type: "GIFT", severity: "LOW", disclosureId: "a" },
      { ...base, politician_id: "q", severity: "LOW", disclosureId: "a" },
      { ...base, agenda_item_id: "j", severity: "LOW", disclosureId: "a" },
    ]);
    expect(kept).toHaveLength(5);
  });
});
