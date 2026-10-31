import { describe, expect, it, vi } from 'vitest';
import { getSyntheticConflictStatus, runSyntheticConflictCheck, removeSyntheticConflictCheck } from '../../src/detection/syntheticConflictCheck.js';

function database() {
  const state = { politician: null, filing: null, sources: [], items: [], conflicts: [] };
  const prisma = {
    politician: {
      findUnique: vi.fn(async () => state.politician),
      upsert: vi.fn(async ({ create }) => (state.politician ??= { id: 'official', ...create })),
      deleteMany: vi.fn(async () => { state.politician = null; state.filing = null; state.sources = []; state.conflicts = []; }),
    },
    form700Filing: { upsert: vi.fn(async ({ create }) => (state.filing ??= { id: 'filing', ...create })) },
    scheduleCdeIncome: {
      deleteMany: vi.fn(async () => { state.sources = []; }),
      create: vi.fn(async ({ data }) => { state.sources.push(data); return data; }),
      findMany: vi.fn(async ({ where }) => where.filing.politician.isDemo ? state.sources : []),
    },
    scheduleAInvestment: { findMany: vi.fn(async () => []) },
    scheduleBRealEstate: { findMany: vi.fn(async () => []) },
    scheduleA2BusinessPosition: { findMany: vi.fn(async () => []) },
    agendaItem: {
      findMany: vi.fn(async ({ where }) => where.id
        ? state.items.filter((item) => where.id.in.includes(item.id)) : state.items),
      upsert: vi.fn(async ({ where, create, update }) => {
        const existing = state.items.find((item) => item.legistarItemId === where.legistarItemId);
        if (existing) return Object.assign(existing, update);
        const row = { id: `agenda-${state.items.length}`, ...create };
        state.items.push(row);
        return row;
      }),
      deleteMany: vi.fn(async () => { state.items = []; state.conflicts = []; }),
    },
    conflict: {
      findMany: vi.fn(async () => state.conflicts),
      createMany: vi.fn(async ({ data }) => {
        let count = 0;
        for (const row of data) {
          if (!state.conflicts.some((entry) => entry.politicianId === row.politicianId
            && entry.agendaItemId === row.agendaItemId && entry.sourceKey === row.sourceKey)) {
            state.conflicts.push({ id: `conflict-${state.conflicts.length}`, ...row });
            count += 1;
          }
        }
        return { count };
      }),
    },
  };
  prisma.$transaction = async (callback) => callback(prisma);
  return { prisma, state };
}

describe('fictional database conflict fixture with the real matcher', () => {
  it('detects the disclosed vendor, leaves the control clear, and remains idempotent', async () => {
    const { prisma, state } = database();
    const result = await runSyntheticConflictCheck(prisma);
    expect(result.passed).toBe(true);
    expect(result.firstRun.inserted).toBe(1);
    expect(result.secondRun.inserted).toBe(0);
    expect(result.controlConflictCount).toBe(0);
    expect(state.conflicts).toHaveLength(1);
    expect(state.conflicts[0].conflictType).toBe('INCOME');
    expect(state.items.every((row) => row.isDemo)).toBe(true);
    expect((await runSyntheticConflictCheck(prisma)).passed).toBe(true);
    expect(state.conflicts).toHaveLength(1);
  });

  it('reports an absent fixture and removes only demo-owned identities', async () => {
    const { prisma } = database();
    expect(await getSyntheticConflictStatus(prisma)).toEqual({ exists: false, passed: false });
    await runSyntheticConflictCheck(prisma);
    await removeSyntheticConflictCheck(prisma);
    expect(prisma.agendaItem.deleteMany).toHaveBeenCalledWith({ where: {
      isDemo: true, legistarItemId: { in: ['fair-demo:matching-agenda-001', 'fair-demo:control-agenda-001'] },
    } });
    expect(await getSyntheticConflictStatus(prisma)).toEqual({ exists: false, passed: false });
  });

  it('refuses to repurpose a non-demo official using the reserved slug', async () => {
    const { prisma, state } = database();
    state.politician = { id: 'existing', isDemo: false };
    await expect(runSyntheticConflictCheck(prisma)).rejects.toThrow('Refusing to overwrite');
    expect(prisma.politician.upsert).not.toHaveBeenCalled();
  });
});