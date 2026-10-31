import { vi } from "vitest";

export function createMockPrisma({
  agendaItems = [],
  scheduleB = [],
  scheduleCde = [],
  scheduleA2 = [],
  initialConflicts = [],
} = {}) {
  const insertedConflicts = [...initialConflicts];

  const filterRows = (rows, { where }) => rows.filter((row) =>
    where.filing.politician.OR[0].jurisdictionId.in.includes(row.filing?.politician?.jurisdictionId ?? row.politicianJurisdictionId)
    || (row.filing?.politician?.jurisdictionId ?? row.politicianJurisdictionId) == null,
  );

  const client = {
    jurisdiction: { findMany: vi.fn().mockResolvedValue([{ id: "sac", name: "Sacramento" }]) },
    $transaction: async (fn) => fn(client),
    agendaItem: {
      findMany: vi.fn().mockResolvedValue(agendaItems),
    },

    scheduleBRealEstate: {
      findMany: vi.fn((query) => filterRows(scheduleB, query)),
    },

    scheduleCdeIncome: {
      findMany: vi.fn((query) => filterRows(scheduleCde, query)),
    },

    scheduleA2BusinessPosition: {
      findMany: vi.fn((query) => filterRows(scheduleA2, query)),
    },

    conflict: {
      findMany: vi.fn(async () => insertedConflicts),
      update: vi.fn(async ({ where, data }) => Object.assign(insertedConflicts.find((row) => row.id === where.id), data)),
      createMany: vi.fn(async ({ data, skipDuplicates }) => {
        let inserted = 0;

        for (const row of data) {
          const duplicate = insertedConflicts.some(
            (existing) =>
              existing.politicianId === row.politicianId &&
              existing.agendaItemId === row.agendaItemId &&
              existing.conflictType === row.conflictType &&
              existing.sourceKey === row.sourceKey,
          );

          if (duplicate && skipDuplicates) {
            continue;
          }

          insertedConflicts.push({ ...row, id: `conflict-${insertedConflicts.length}` });
          inserted += 1;
        }

        return { count: inserted };
      }),
    },

    __insertedConflicts: insertedConflicts,
  };
  return client;
}