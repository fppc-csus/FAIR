import { vi } from "vitest";

export function createMockPrisma({
  agendaItems = [],
  scheduleB = [],
  scheduleCde = [],
  scheduleA2 = [],
  initialConflicts = [],
} = {}) {
  const insertedConflicts = [...initialConflicts];

  const verifiedAt = new Date('2026-01-01T00:00:00.000Z');
  const verifiedItem = (item) => ({ ...item, meetingDateVerifiedAt: verifiedAt,
    meetingDateVerifiedBy: 'test-admin', meetingDateVerifiedValue: new Date(item.meetingDate) });
  const verifiedRow = (row) => ({ ...row, filing: {
    id: row.filingId, filingYear: row.filingYear, filingYearVerifiedValue: row.filingYear,
    filingYearVerifiedAt: verifiedAt, filingYearVerifiedBy: 'test-admin',
    politicianId: row.politicianId, politician: {
      jurisdictionId: row.politicianJurisdictionId,
      jurisdictionVerifiedId: row.politicianJurisdictionId,
      jurisdictionVerifiedAt: verifiedAt, jurisdictionVerifiedBy: 'test-admin', needsReview: false,
    },
  } });
  const filterRows = (rows) => rows.map(verifiedRow);

  const client = {
    jurisdiction: { findMany: vi.fn().mockResolvedValue([{ id: "sac", name: "Sacramento" }]) },
    $transaction: async (fn) => fn(client),
    agendaItem: {
      findMany: vi.fn().mockResolvedValue(agendaItems.map(verifiedItem)),
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