import express from 'express';
import request from 'supertest';
import { beforeEach, expect, it, vi } from 'vitest';

const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const queueDetectionRun = vi.hoisted(() => vi.fn());
vi.mock('../../src/detection/detectionRuns.js', () => ({ queueDetectionRun }));
const prisma = vi.hoisted(() => ({
  $transaction: vi.fn(), $queryRaw: vi.fn(), $queryRawUnsafe: vi.fn(),
  politician: { findUnique: vi.fn(), update: vi.fn() },
  jurisdiction: { findUnique: vi.fn() },
  form700Filing: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  agendaItem: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() }, meeting: { update: vi.fn() },
  detectionRun: { create: vi.fn() },
  eligibilityVerificationEvent: { create: vi.fn() },
}));
vi.mock('../../src/lib/prisma.js', () => ({ prisma }));
import router from '../../src/routes/admin/eligibility.js';
const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.user = { id: 'admin-1' }; next(); }); app.use(router);
beforeEach(() => {
  vi.resetAllMocks();
  prisma.$transaction.mockImplementation(fn => fn(prisma));
  prisma.jurisdiction.findUnique.mockResolvedValue({ id: OTHER });
  prisma.form700Filing.findFirst.mockResolvedValue(null);
  prisma.form700Filing.findMany.mockResolvedValue([]);
  prisma.agendaItem.findMany.mockResolvedValue([{ id: ID }]);
  prisma.detectionRun.create.mockResolvedValue({ id: OTHER });
});

it('rejects malformed and stale corrections without writing', async () => {
  prisma.form700Filing.findUnique.mockResolvedValue({ id: ID, politicianId: OTHER, filingYear: 2025 });
  expect((await request(app).post(`/filing/${ID}/correct`).send({ expectedValue: 2025, correctedValue: '2024' })).status).toBe(400);
  expect((await request(app).post(`/filing/${ID}/correct`).send({ expectedValue: 2023, correctedValue: 2024 })).status).toBe(409);
  expect(prisma.form700Filing.update).not.toHaveBeenCalled();
});

it('writes a correction and an attributable audit event without confirming it', async () => {
  prisma.form700Filing.findUnique.mockResolvedValue({ id: ID, politicianId: OTHER, filingYear: 2025 });
  const response = await request(app).post(`/filing/${ID}/correct`).send({ expectedValue: 2025, correctedValue: 2024 });
  expect(response.body.data).toMatchObject({ corrected: true, value: 2024, verified: false, detectionRunIds: [OTHER] });
  expect(prisma.form700Filing.update).toHaveBeenCalledWith({ where: { id: ID }, data: { filingYear: 2024 } });
  expect(prisma.eligibilityVerificationEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'corrected', actorId: 'admin-1', value: '2025 -> 2024' }) });
  expect(prisma.detectionRun.create).toHaveBeenCalledWith({ data: expect.objectContaining({ filingId: ID, trigger: 'eligibility_correction' }), select: { id: true } });
  expect(queueDetectionRun).toHaveBeenCalledWith(OTHER);
});

it('rejects a duplicate filing year and a nonexistent jurisdiction', async () => {
  prisma.form700Filing.findUnique.mockResolvedValue({ id: ID, politicianId: OTHER, filingYear: 2025 });
  prisma.form700Filing.findFirst.mockResolvedValue({ id: OTHER });
  expect((await request(app).post(`/filing/${ID}/correct`).send({ expectedValue: 2025, correctedValue: 2024 })).status).toBe(409);
  prisma.politician.findUnique.mockResolvedValue({ id: ID, jurisdictionId: null });
  prisma.jurisdiction.findUnique.mockResolvedValue(null);
  expect((await request(app).post(`/politician/${ID}/correct`).send({ expectedValue: null, correctedValue: OTHER })).status).toBe(400);
  expect(prisma.eligibilityVerificationEvent.create).not.toHaveBeenCalled();
});

it('corrects both linked meeting and item dates so they cannot remain ambiguous', async () => {
  prisma.agendaItem.findUnique.mockResolvedValue({ id: ID, meetingId: OTHER, meetingDate: null, meeting: { meetingDate: new Date('2025-01-01T00:00:00.000Z') } });
  const response = await request(app).post(`/agenda/${ID}/correct`).send({ expectedValue: '2025-01-01T00:00:00.000Z', correctedValue: '2025-02-01T00:00:00.000Z' });
  expect(response.status).toBe(200);
  expect(prisma.meeting.update).toHaveBeenCalledWith({ where: { id: OTHER }, data: { meetingDate: new Date('2025-02-01T00:00:00.000Z') } });
  expect(prisma.agendaItem.update).toHaveBeenCalledWith({ where: { id: ID }, data: { meetingDate: new Date('2025-02-01T00:00:00.000Z') } });
  expect(prisma.detectionRun.create).toHaveBeenCalledWith({ data: expect.objectContaining({ agendaItemId: ID }), select: { id: true } });
});

it('rechecks every linked agenda item after a meeting-date correction', async () => {
  prisma.agendaItem.findUnique.mockResolvedValue({ id: ID, meetingId: OTHER, meetingDate: null, meeting: { meetingDate: new Date('2025-01-01T00:00:00.000Z') } });
  prisma.agendaItem.findMany.mockResolvedValue([{ id: ID }, { id: OTHER }]);
  prisma.detectionRun.create.mockResolvedValueOnce({ id: 'run-1' }).mockResolvedValueOnce({ id: 'run-2' });
  const response = await request(app).post(`/agenda/${ID}/correct`).send({ expectedValue: '2025-01-01T00:00:00.000Z', correctedValue: '2025-02-01T00:00:00.000Z' });
  expect(response.body.data.detectionRunIds).toEqual(['run-1', 'run-2']);
  expect(prisma.detectionRun.create.mock.calls.map(([call]) => call.data.agendaItemId)).toEqual([ID, OTHER]);
  expect(queueDetectionRun.mock.calls).toEqual([['run-1'], ['run-2']]);
});

it('does not dispatch or acknowledge a correction if durable scheduling fails', async () => {
  prisma.form700Filing.findUnique.mockResolvedValue({ id: ID, politicianId: OTHER, filingYear: 2025 });
  prisma.detectionRun.create.mockRejectedValue(new Error('database unavailable'));
  const response = await request(app).post(`/filing/${ID}/correct`).send({ expectedValue: 2025, correctedValue: 2024 });
  expect(response.status).toBe(500);
  expect(queueDetectionRun).not.toHaveBeenCalled();
});