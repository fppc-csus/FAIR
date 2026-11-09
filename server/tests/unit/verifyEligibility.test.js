import { describe, expect, it, vi } from 'vitest';
import { verifyEligibilityMetadata } from '../../src/detection/verifyEligibility.js';

const CITY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DATE = '2025-01-01T00:00:00.000Z';

function database(kind, row, { failAudit = false } = {}) {
  const records = { politician: row, form700Filing: row, agendaItem: row };
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    jurisdiction: { findUnique: vi.fn().mockResolvedValue({ id: CITY }) },
    eligibilityVerificationEvent: { create: vi.fn(async () => { if (failAudit) throw new Error('audit failed'); }) },
    detectionRun: { create: vi.fn().mockResolvedValue({ id: 'run' }) },
  };
  for (const model of ['politician', 'form700Filing', 'agendaItem']) {
    tx[model] = {
      findUnique: vi.fn(async () => records[model] && { ...records[model] }),
      update: vi.fn(async ({ data }) => Object.assign(records[model], data)),
      ...(model === 'form700Filing' ? { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) } : {}),
    };
  }
  const prisma = { $transaction: vi.fn(async (action) => {
    const snapshot = { ...row };
    try { return await action(tx); } catch (error) {
      for (const key of Object.keys(row)) if (!(key in snapshot)) delete row[key];
      Object.assign(row, snapshot);
      throw error;
    }
  }) };
  return { tx, prisma, row, kind };
}

describe('administrator metadata verification', () => {
  it('rejects unresolved politician jurisdiction without triggering detection', async () => {
    const queue = vi.fn();
    const { prisma } = database('politician', { jurisdictionId: null });
    expect(await verifyEligibilityMetadata({ prisma, kind: 'politician', id: 'p', expectedValue: CITY, adminUserId: 'admin', queue })).toEqual({ error: 'UNRESOLVED_POLITICIAN_JURISDICTION' });
    expect(queue).not.toHaveBeenCalled();
  });

  it('verifies a filing year with administrator attribution and queues a durable rerun', async () => {
    const queue = vi.fn();
    const { prisma, tx } = database('filing', { id: 'f', filingYear: 2010, politicianId: 'p' });
    const result = await verifyEligibilityMetadata({ prisma, kind: 'filing', id: 'f', expectedValue: 2010, adminUserId: 'admin', queue });
    expect(result).toMatchObject({ verified: true, detectionRunId: 'run' });
    expect(tx.form700Filing.update.mock.calls[0][0].data).toMatchObject({ filingYearVerifiedValue: 2010, filingYearVerifiedBy: 'admin' });
    expect(queue).toHaveBeenCalledWith('run');
    expect(tx.eligibilityVerificationEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ recordType: 'filing', action: 'verified', actorId: 'admin' }) });
  });

  it('rejects conflicting meeting dates and does not stamp verification', async () => {
    const { prisma, tx } = database('agenda', { meetingId: null, meetingDate: new Date(DATE), meeting: { meetingDate: new Date('2025-01-02') } });
    expect(await verifyEligibilityMetadata({ prisma, kind: 'agenda', id: 'a', expectedValue: DATE, adminUserId: 'admin' })).toEqual({ error: 'AMBIGUOUS_MEETING_DATE' });
    expect(tx.agendaItem.update).not.toHaveBeenCalled();
  });

  it('rejects a stale reviewed value and does not change metadata', async () => {
    const { prisma, tx } = database('filing', { filingYear: 2020, politicianId: 'p' });
    const result = await verifyEligibilityMetadata({ prisma, kind: 'filing', id: 'f', expectedValue: 2019, adminUserId: 'admin' });
    expect(result).toEqual({ error: 'STALE_VALUE' });
    expect(tx.form700Filing.update).not.toHaveBeenCalled();
  });

  it('confirms politician jurisdiction only when its identity and reference are valid', async () => {
    const { prisma, tx } = database('politician', { jurisdictionId: CITY, needsReview: false });
    const result = await verifyEligibilityMetadata({ prisma, kind: 'politician', id: 'p', expectedValue: CITY, adminUserId: 'admin' });
    expect(result).toEqual({ verified: true, detectionRunId: null, detectionRunIds: [] });
    expect(tx.politician.update).toHaveBeenCalledWith({ where: { id: 'p' }, data: expect.objectContaining({ jurisdictionVerifiedId: CITY, jurisdictionVerifiedBy: 'admin' }) });
  });

  it('confirms agenda dates and queues durable detection without changing matching rules', async () => {
    const { prisma, tx } = database('agenda', { meetingId: null, meetingDate: new Date(DATE) });
    const queue = vi.fn();
    const result = await verifyEligibilityMetadata({ prisma, kind: 'agenda', id: 'a', expectedValue: DATE, adminUserId: 'admin', queue });
    expect(result).toMatchObject({ verified: true });
    expect(tx.agendaItem.update).toHaveBeenCalledWith({ where: { id: 'a' }, data: expect.objectContaining({ meetingDateVerifiedBy: 'admin' }) });
    expect(tx.detectionRun.create).toHaveBeenCalledWith({ data: expect.objectContaining({ agendaItemId: 'a', trigger: 'eligibility_correction' }), select: { id: true } });
    expect(queue).toHaveBeenCalledWith('run');
  });

  it('creates one durable recheck for every filing when jurisdiction is confirmed', async () => {
    const { prisma, tx } = database('politician', { jurisdictionId: CITY, needsReview: false });
    tx.form700Filing.findMany.mockResolvedValue([{ id: 'first', filingYear: 2024 }, { id: 'second', filingYear: 2025 }]);
    tx.detectionRun.create.mockResolvedValueOnce({ id: 'run-1' }).mockResolvedValueOnce({ id: 'run-2' });
    const queue = vi.fn();
    const result = await verifyEligibilityMetadata({ prisma, kind: 'politician', id: 'p', expectedValue: CITY, adminUserId: 'admin', queue });
    expect(result.detectionRunIds).toEqual(['run-1', 'run-2']);
    expect(queue.mock.calls).toEqual([['run-1'], ['run-2']]);
    expect(tx.detectionRun.create.mock.calls.map(([call]) => call.data.filingId)).toEqual(['first', 'second']);
  });

  it('is idempotent and does not create a second audit event or detection run', async () => {
    const { prisma, tx } = database('filing', { filingYear: 2025, filingYearVerifiedValue: 2025, filingYearVerifiedAt: new Date(), filingYearVerifiedBy: 'admin' });
    const queue = vi.fn();
    expect(await verifyEligibilityMetadata({ prisma, kind: 'filing', id: 'f', expectedValue: 2025, adminUserId: 'admin', queue })).toEqual({ alreadyVerified: true });
    expect(tx.eligibilityVerificationEvent.create).not.toHaveBeenCalled();
    expect(tx.detectionRun.create).not.toHaveBeenCalled();
    expect(queue).not.toHaveBeenCalled();
  });

  it('rolls back verification if its audit event cannot be written', async () => {
    const row = { filingYear: 2025 };
    const { prisma, tx } = database('filing', row, { failAudit: true });
    await expect(verifyEligibilityMetadata({ prisma, kind: 'filing', id: 'f', expectedValue: 2025, adminUserId: 'admin' })).rejects.toThrow('audit failed');
    expect(row.filingYearVerifiedAt).toBeUndefined();
    expect(tx.detectionRun.create).not.toHaveBeenCalled();
  });

  it('rejects missing identity and malformed expected values', async () => {
    const { prisma } = database('filing', { filingYear: 2025 });
    expect(await verifyEligibilityMetadata({ prisma, kind: 'filing', id: 'f', expectedValue: 2025, adminUserId: '' })).toEqual({ error: 'ADMIN_IDENTITY_REQUIRED' });
    expect(await verifyEligibilityMetadata({ prisma, kind: 'filing', id: 'f', expectedValue: '2025', adminUserId: 'admin' })).toEqual({ error: 'INVALID_EXPECTED_VALUE' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    const { prisma: dates } = database('agenda', { meetingDate: new Date(DATE) });
    expect(await verifyEligibilityMetadata({ prisma: dates, kind: 'agenda', id: 'a', expectedValue: '2025', adminUserId: 'admin' })).toEqual({ error: 'INVALID_EXPECTED_VALUE' });
    expect(await verifyEligibilityMetadata({ prisma: dates, kind: 'agenda', id: 'a', expectedValue: '2025-02-30T00:00:00Z', adminUserId: 'admin' })).toEqual({ error: 'INVALID_EXPECTED_VALUE' });
    expect(dates.$transaction).not.toHaveBeenCalled();
  });

  it('does not silently verify preexisting data, and rejects missing or invalid metadata', async () => {
    for (const [kind, row, expectedValue, error] of [
      ['filing', { filingYear: null }, 2025, 'MISSING_FILING_YEAR'],
      ['filing', { filingYear: 10000 }, 2025, 'INVALID_FILING_YEAR'],
      ['agenda', { meetingId: null, meetingDate: null }, DATE, 'MISSING_MEETING_DATE'],
      ['agenda', { meetingId: null, meetingDate: 'bad date' }, DATE, 'INVALID_MEETING_DATE'],
      ['politician', { jurisdictionId: CITY, needsReview: true }, CITY, 'POLITICIAN_IDENTITY_REVIEW'],
    ]) {
      const { prisma, tx } = database(kind, row);
      expect(await verifyEligibilityMetadata({ prisma, kind, id: 'record', expectedValue, adminUserId: 'admin' })).toEqual({ error });
      expect(tx.eligibilityVerificationEvent.create).not.toHaveBeenCalled();
    }
  });

  it('rejects a nonexistent politician jurisdiction', async () => {
    const { prisma, tx } = database('politician', { jurisdictionId: CITY });
    tx.jurisdiction.findUnique.mockResolvedValue(null);
    expect(await verifyEligibilityMetadata({ prisma, kind: 'politician', id: 'record', expectedValue: CITY, adminUserId: 'admin' })).toEqual({ error: 'INVALID_POLITICIAN_JURISDICTION' });
    expect(tx.politician.update).not.toHaveBeenCalled();
  });

  it('rejects an agenda whose linked meeting changed before confirmation', async () => {
    const { prisma, tx } = database('agenda', { meetingId: 'second-meeting', meetingDate: new Date(DATE) });
    tx.agendaItem.findUnique.mockResolvedValueOnce({ meetingId: 'first-meeting' })
      .mockResolvedValueOnce({ meetingId: 'second-meeting', meetingDate: new Date(DATE) });
    expect(await verifyEligibilityMetadata({ prisma, kind: 'agenda', id: 'record', expectedValue: DATE, adminUserId: 'admin' })).toEqual({ error: 'STALE_VALUE' });
    expect(tx.agendaItem.update).not.toHaveBeenCalled();
  });

  it('serializes concurrent confirmations and records only one successful confirmation', async () => {
    const row = { filingYear: 2025, politicianId: 'politician' };
    const { prisma, tx } = database('filing', row);
    let previous = Promise.resolve();
    prisma.$transaction.mockImplementation(async (action) => {
      const turn = previous;
      let release;
      previous = new Promise((resolve) => { release = resolve; });
      await turn;
      try { return await action(tx); } finally { release(); }
    });
    const queue = vi.fn();
    const calls = [1, 2].map(() => verifyEligibilityMetadata({ prisma, kind: 'filing', id: 'f', expectedValue: 2025, adminUserId: 'admin', queue }));
    const results = await Promise.all(calls);
    expect(results.filter((result) => result.verified)).toHaveLength(1);
    expect(results.filter((result) => result.alreadyVerified)).toHaveLength(1);
    expect(tx.eligibilityVerificationEvent.create).toHaveBeenCalledTimes(1);
    expect(queue).toHaveBeenCalledTimes(1);
  });
});