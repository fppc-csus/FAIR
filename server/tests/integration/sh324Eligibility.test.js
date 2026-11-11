import express from 'express';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertLocalTestDatabase } from './sh324DatabaseGuard.js';

const queued = vi.hoisted(() => vi.fn());
vi.mock('../../src/detection/detectionRuns.js', async (importOriginal) => ({
  ...(await importOriginal()), queueDetectionRun: queued,
}));

const enabled = process.env.RUN_SH324_DB_TESTS === 'true';
const suite = enabled ? describe : describe.skip;
const ADMIN = 'sh324-test-admin';
const DATE = '2025-01-01T00:00:00.000Z';
const NEXT_DATE = '2025-02-01T00:00:00.000Z';
let prisma;
let verifyEligibilityMetadata;
let scheduleEligibilityReprocessing;
let runDetectionRun;
let app;
let fixture;
let createdIds = [];

suite('SH-324 migrated PostgreSQL workflow', () => {
  beforeAll(async () => {
    assertLocalTestDatabase(process.env);
    ({ prisma } = await import('../../src/lib/prisma.js'));
    ({ verifyEligibilityMetadata } = await import('../../src/detection/verifyEligibility.js'));
    ({ scheduleEligibilityReprocessing } = await import('../../src/detection/scheduleEligibilityReprocessing.js'));
    ({ runDetectionRun } = await import('../../src/detection/detectionRuns.js'));
    const [server] = await prisma.$queryRaw`SELECT current_database() AS database, current_user AS username, host(inet_server_addr()) AS address, inet_server_port() AS port`;
    if (server.database !== 'fair_sh324_test' || server.username !== new URL(process.env.DATABASE_URL).username
      || server.address !== '127.0.0.1' || Number(server.port) !== 5432) {
      throw new Error(`Refusing to run outside local disposable SH-324 database: ${JSON.stringify(server)}.`);
    }
    const { default: router } = await import('../../src/routes/admin/eligibility.js');
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { id: ADMIN }; next(); });
    app.use(router);
    app.use((_error, _req, res, _next) => res.status(500).json({ error: 'transaction failed' }));
  });

  beforeEach(async () => {
    queued.mockClear();
    const jurisdiction = await prisma.jurisdiction.create({ data: { name: `SH324 ${randomUUID()}`, type: 'city' } });
    const other = await prisma.jurisdiction.create({ data: { name: `SH324 ${randomUUID()}`, type: 'city' } });
    const politician = await prisma.politician.create({ data: {
      slug: `sh324-${randomUUID()}`, fullName: 'SH324 fixture', officeTitle: 'Councilmember', jurisdictionId: jurisdiction.id,
    } });
    const filing = await prisma.form700Filing.create({ data: { politicianId: politician.id, filingYear: 2025 } });
    const meeting = await prisma.meeting.create({ data: { jurisdictionId: jurisdiction.id, bodyName: 'Council', meetingDate: new Date(DATE) } });
    const items = await Promise.all([1, 2].map((number) => prisma.agendaItem.create({ data: {
      meetingId: meeting.id, title: `SH324 item ${number}`, meetingDate: new Date(DATE),
    } })));
    fixture = { jurisdiction, other, politician, filing, meeting, items };
    createdIds = [politician.id, filing.id, ...items.map((item) => item.id)];
  });

  afterEach(async () => {
    if (!fixture) return;
    await prisma.detectionRun.deleteMany({ where: { OR: [
      { politicianId: fixture.politician.id }, { filingId: fixture.filing.id },
      { agendaItemId: { in: fixture.items.map((item) => item.id) } },
    ] } });
    await prisma.eligibilityVerificationEvent.deleteMany({ where: { recordId: { in: createdIds } } });
    await prisma.meeting.delete({ where: { id: fixture.meeting.id } });
    await prisma.politician.delete({ where: { id: fixture.politician.id } });
    await prisma.jurisdiction.deleteMany({ where: { id: { in: [fixture.jurisdiction.id, fixture.other.id] } } });
    fixture = null;
    vi.restoreAllMocks();
  });

  afterAll(async () => { await prisma?.$disconnect(); });

  it('persists verified values and audit events; raw SQL edits invalidate confirmations including linked meeting dates', async () => {
    const { politician, filing, items, meeting, jurisdiction, other } = fixture;
    for (const [kind, id, expectedValue] of [
      ['politician', politician.id, jurisdiction.id], ['filing', filing.id, 2025],
      ...items.map((item) => ['agenda', item.id, DATE]),
    ]) {
      const result = await verifyEligibilityMetadata({ prisma, kind, id, expectedValue, adminUserId: ADMIN, queue: queued });
      expect(result.verified).toBe(true);
    }
    expect(queued).toHaveBeenCalledTimes(4);
    await prisma.$executeRaw`UPDATE politicians SET jurisdiction_id = ${other.id}::uuid WHERE id = ${politician.id}::uuid`;
    await prisma.$executeRaw`UPDATE form700_filings SET filing_year = 2024 WHERE id = ${filing.id}::uuid`;
    await prisma.$executeRaw`UPDATE meetings SET meeting_date = ${new Date(NEXT_DATE)} WHERE id = ${meeting.id}::uuid`;
    expect(await prisma.politician.findUnique({ where: { id: politician.id } })).toMatchObject({ jurisdictionVerifiedId: null, jurisdictionVerifiedAt: null, jurisdictionVerifiedBy: null });
    expect(await prisma.form700Filing.findUnique({ where: { id: filing.id } })).toMatchObject({ filingYearVerifiedValue: null, filingYearVerifiedAt: null, filingYearVerifiedBy: null });
    for (const item of items) expect(await prisma.agendaItem.findUnique({ where: { id: item.id } })).toMatchObject({ meetingDateVerifiedValue: null, meetingDateVerifiedAt: null, meetingDateVerifiedBy: null });
    const events = await prisma.eligibilityVerificationEvent.findMany({ where: { recordId: { in: createdIds } } });
    expect(events.filter((event) => event.action === 'verified')).toHaveLength(4);
    expect(events.filter((event) => event.action === 'invalidated')).toHaveLength(4);
    expect(events.filter((event) => event.action === 'verified').every((event) => event.actorId === ADMIN)).toBe(true);
  });

  it('commits correction, audit, and all affected agenda work before dispatch', async () => {
    const { items, meeting } = fixture;
    const response = await request(app).post(`/agenda/${items[0].id}/correct`).send({ expectedValue: DATE, correctedValue: NEXT_DATE });
    expect(response.status).toBe(200);
    expect(response.body.data.detectionRunIds).toHaveLength(2);
    expect(await prisma.meeting.findUnique({ where: { id: meeting.id } })).toMatchObject({ meetingDate: new Date(NEXT_DATE) });
    const runs = await prisma.detectionRun.findMany({ where: { id: { in: response.body.data.detectionRunIds } } });
    expect(runs.map((run) => run.agendaItemId).sort()).toEqual(items.map((item) => item.id).sort());
    expect(queued.mock.calls.map(([id]) => id).sort()).toEqual(runs.map((run) => run.id).sort());
    expect(await prisma.eligibilityVerificationEvent.count({ where: { recordId: items[0].id, action: 'corrected', actorId: ADMIN } })).toBe(1);
  });

  it('makes verification and durable work visible to an independent connection at dispatch time', async () => {
    const { filing } = fixture;
    const { PrismaClient } = await import('@prisma/client');
    const observer = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
    try {
      const queue = vi.fn(async (id) => {
        const run = await observer.detectionRun.findUnique({ where: { id } });
        const savedFiling = await observer.form700Filing.findUnique({ where: { id: filing.id } });
        return { run, savedFiling };
      });
      const result = await verifyEligibilityMetadata({ prisma, kind: 'filing', id: filing.id,
        expectedValue: 2025, adminUserId: ADMIN, queue });
      expect(queue).toHaveBeenCalledExactlyOnceWith(result.detectionRunId);
      const [{ run, savedFiling }] = await Promise.all(queue.mock.results.map(({ value }) => value));
      expect(run).toMatchObject({ status: 'queued', filingId: filing.id });
      expect(savedFiling).toMatchObject({ filingYearVerifiedValue: 2025, filingYearVerifiedBy: ADMIN });
    } finally { await observer.$disconnect(); }
  });

  it('reconciles real cross-city and cross-year candidates when a raw metadata edit invalidates verification', async () => {
    const { politician, filing, items, other } = fixture;
    const agenda = items[0];
    const investment = await prisma.scheduleAInvestment.create({ data: {
      filingId: filing.id, politicianId: politician.id, entityName: 'Acme Builders', fairMarketValue: '$100,000',
    } });
    await prisma.agendaItem.update({ where: { id: agenda.id }, data: { title: 'Contract with Acme Builders' } });
    const { detectConflictsForAgendaItems } = await import('../../src/detection/detectConflicts.js');
    try {
      for (const [kind, id, expectedValue] of [
        ['politician', politician.id, fixture.jurisdiction.id], ['filing', filing.id, 2025], ['agenda', agenda.id, DATE],
      ]) await verifyEligibilityMetadata({ prisma, kind, id, expectedValue, adminUserId: ADMIN, queue: queued });
      // Distinct politician/agenda jurisdictions, and a filing year unrelated to the meeting year.
      await prisma.politician.update({ where: { id: politician.id }, data: { jurisdictionId: other.id } });
      await verifyEligibilityMetadata({ prisma, kind: 'politician', id: politician.id,
        expectedValue: other.id, adminUserId: ADMIN, queue: queued });
      const first = await detectConflictsForAgendaItems([agenda.id], {
        prisma, matchNamedEntity: async () => ({ matched: true }),
      });
      expect(first.inserted).toBe(1);
      const conflict = await prisma.conflict.findFirst({ where: { agendaItemId: agenda.id, disclosureId: investment.id } });
      expect(conflict).toMatchObject({ eligibilityStatus: 'active', filingYear: 2025,
        politicianJurisdictionId: other.id, jurisdictionId: fixture.jurisdiction.id });
      await prisma.conflict.update({ where: { id: conflict.id }, data: {
        reviewStatus: 'confirmed_conflict', reviewNote: 'SH324 review remains',
      } });
      const review = await prisma.conflictReview.create({ data: {
        conflictId: conflict.id, adminUserId: ADMIN, oldStatus: 'pending',
        newStatus: 'confirmed_conflict', note: 'SH324 review remains',
      } });
      await prisma.$executeRaw`UPDATE form700_filings SET filing_year = 2024 WHERE id = ${filing.id}::uuid`;
      const second = await detectConflictsForAgendaItems([agenda.id], {
        prisma, matchNamedEntity: async () => ({ matched: true }),
      });
      expect(second.inactivated).toBe(1);
      expect(await prisma.conflict.findUnique({ where: { id: conflict.id } })).toMatchObject({
        eligibilityStatus: 'inactive', reviewStatus: 'confirmed_conflict', reviewNote: 'SH324 review remains',
      });
      await verifyEligibilityMetadata({ prisma, kind: 'filing', id: filing.id,
        expectedValue: 2024, adminUserId: ADMIN, queue: queued });
      const third = await detectConflictsForAgendaItems([agenda.id], {
        prisma, matchNamedEntity: async () => ({ matched: true }),
      });
      expect(third.reactivated).toBe(1);
      expect(await prisma.conflict.findUnique({ where: { id: conflict.id } })).toMatchObject({
        eligibilityStatus: 'active', filingYear: 2024,
        reviewStatus: 'confirmed_conflict', reviewNote: 'SH324 review remains',
      });
      expect(await prisma.conflictReview.findUnique({ where: { id: review.id } })).toMatchObject({
        conflictId: conflict.id, note: 'SH324 review remains',
      });
    } finally {
      await prisma.conflict.deleteMany({ where: { agendaItemId: agenda.id } });
      await prisma.scheduleAInvestment.delete({ where: { id: investment.id } });
    }
  });

  it('rolls back metadata and audit when durable scheduling fails; does not dispatch', async () => {
    const { filing } = fixture;
    // An impossible FK rejects the durable insert *inside* the real transaction.
    const client = prisma.$extends({ query: { detectionRun: { create({ args, query }) {
      return query({ ...args, data: { ...args.data, politicianId: '00000000-0000-4000-8000-000000000001' } });
    } } } });
    await expect(verifyEligibilityMetadata({ prisma: client, kind: 'filing', id: filing.id,
      expectedValue: 2025, adminUserId: ADMIN, queue: queued })).rejects.toThrow();
    expect(await prisma.form700Filing.findUnique({ where: { id: filing.id } })).toMatchObject({ filingYear: 2025 });
    expect(await prisma.form700Filing.findUnique({ where: { id: filing.id } })).toMatchObject({
      filingYearVerifiedValue: null, filingYearVerifiedAt: null, filingYearVerifiedBy: null,
    });
    expect(await prisma.eligibilityVerificationEvent.count({ where: { recordId: filing.id } })).toBe(0);
    expect(await prisma.detectionRun.count({ where: { filingId: filing.id } })).toBe(0);
    expect(queued).not.toHaveBeenCalled();
  });

  it('rolls back a correction and trigger invalidation when work cannot be saved', async () => {
    const { filing } = fixture;
    await verifyEligibilityMetadata({ prisma, kind: 'filing', id: filing.id,
      expectedValue: 2025, adminUserId: ADMIN, queue: queued });
    queued.mockClear();
    const baselineEvents = await prisma.eligibilityVerificationEvent.count({ where: { recordId: filing.id } });
    const baselineRuns = await prisma.detectionRun.count({ where: { filingId: filing.id } });
    const client = prisma.$extends({ query: { detectionRun: { create({ args, query }) {
      return query({ ...args, data: { ...args.data, politicianId: '00000000-0000-4000-8000-000000000001' } });
    } } } });
    await expect(client.$transaction(async (tx) => {
      await tx.form700Filing.update({ where: { id: filing.id }, data: { filingYear: 2024 } });
      await tx.eligibilityVerificationEvent.create({ data: {
        recordType: 'filing', recordId: filing.id, action: 'corrected', value: '2025 -> 2024', actorId: ADMIN,
      } });
      await scheduleEligibilityReprocessing(tx, { kind: 'filing', id: filing.id,
        row: filing, correctedFilingYear: 2024 });
    })).rejects.toThrow();
    expect(await prisma.form700Filing.findUnique({ where: { id: filing.id } })).toMatchObject({
      filingYear: 2025, filingYearVerifiedValue: 2025, filingYearVerifiedBy: ADMIN,
    });
    expect(await prisma.eligibilityVerificationEvent.count({ where: { recordId: filing.id } })).toBe(baselineEvents);
    expect(await prisma.detectionRun.count({ where: { filingId: filing.id } })).toBe(baselineRuns);
    expect(queued).not.toHaveBeenCalled();
  });

  it('schedules every filing when jurisdiction is corrected and persists corrected filing year', async () => {
    const { politician, filing, jurisdiction, other } = fixture;
    const second = await prisma.form700Filing.create({ data: { politicianId: politician.id, filingYear: 2024 } });
    createdIds.push(second.id);
    const response = await request(app).post(`/politician/${politician.id}/correct`).send({ expectedValue: jurisdiction.id, correctedValue: other.id });
    expect(response.status).toBe(200);
    expect(response.body.data.detectionRunIds).toHaveLength(2);
    const runs = await prisma.detectionRun.findMany({ where: { id: { in: response.body.data.detectionRunIds } } });
    expect(runs.map((run) => run.filingId).sort()).toEqual([filing.id, second.id].sort());
    const filingResponse = await request(app).post(`/filing/${filing.id}/correct`).send({ expectedValue: 2025, correctedValue: 2023 });
    expect(filingResponse.status).toBe(200);
    expect(await prisma.detectionRun.findUnique({ where: { id: filingResponse.body.data.detectionRunIds[0] } })).toMatchObject({ filingId: filing.id, filingYear: 2023 });
  });

  it('retries failed work using persisted items, including with zero remaining filings', async () => {
    const { politician, filing, items } = fixture;
    const ids = await prisma.$transaction((tx) => scheduleEligibilityReprocessing(tx, { kind: 'filing', id: filing.id, row: filing }));
    const detect = vi.fn().mockRejectedValueOnce(new Error('temporary failure')).mockResolvedValue({ totalCandidates: 0 });
    const first = await runDetectionRun(ids[0], { prisma, detectConflictsForAgendaItems: detect });
    expect(first.run.status).toBe('failed');
    expect(await prisma.detectionRunItem.count({ where: { detectionRunId: ids[0], status: 'failed' } })).toBe(1);
    expect((await runDetectionRun(ids[0], { prisma, detectConflictsForAgendaItems: detect })).run.status).toBe('completed');
    expect((await prisma.detectionRunItem.findMany({ where: { detectionRunId: ids[0] } })).map((item) => item.attempts)).toContain(2);
    await prisma.form700Filing.delete({ where: { id: filing.id } });
    // The filing FK cascades detection runs; test an agenda-specific durable run instead.
    const agendaIds = await prisma.$transaction((tx) => scheduleEligibilityReprocessing(tx, { kind: 'agenda', id: items[0].id }));
    const agendaDetect = vi.fn().mockRejectedValueOnce(new Error('temporary failure')).mockResolvedValue({ totalCandidates: 0 });
    expect((await runDetectionRun(agendaIds[0], { prisma, detectConflictsForAgendaItems: agendaDetect })).status).toBe('failed');
    expect((await runDetectionRun(agendaIds[0], { prisma, detectConflictsForAgendaItems: agendaDetect })).run.status).toBe('completed');
    expect(agendaDetect).toHaveBeenCalledTimes(2);
    expect(await prisma.form700Filing.count({ where: { politicianId: politician.id } })).toBe(0);
  });

  it('claims queued work only once across workers while detection is in progress', async () => {
    const { items } = fixture;
    const held = await prisma.detectionRun.create({ data: { trigger: 'eligibility_correction', agendaItemId: items[1].id, filingYear: 1900 } });
    let release;
    const blocked = new Promise((resolve) => { release = resolve; });
    let started;
    const entered = new Promise((resolve) => { started = resolve; });
    const concurrentDetect = vi.fn(async () => { started(); await blocked; return { totalCandidates: 0 }; });
    const worker = runDetectionRun(held.id, { prisma, detectConflictsForAgendaItems: concurrentDetect });
    await entered;
    try {
      // A second connection uses the worker's persisted claim predicate, bypassing
      // the in-process activeRuns guard entirely.
      const secondClaim = await prisma.detectionRun.updateMany({
        where: { id: held.id, OR: [
          { status: { in: ['queued', 'failed'] } },
          { status: 'running', lockAt: null },
          { status: 'running', lockAt: { lt: new Date(Date.now() - 10 * 60 * 1000) } },
        ] },
        data: { status: 'running', lockAt: new Date() },
      });
      expect(secondClaim.count).toBe(0);
      expect(await runDetectionRun(held.id, { prisma, detectConflictsForAgendaItems: concurrentDetect })).toMatchObject({ alreadyRunning: true });
    } finally { release(); }
    expect((await worker).run.status).toBe('completed');
    expect(concurrentDetect).toHaveBeenCalledTimes(1);
  });
});