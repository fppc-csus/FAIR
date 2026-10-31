import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ runFindMany: vi.fn(), filingFindMany: vi.fn() }));
vi.mock('../../src/lib/prisma.js', () => ({ prisma: { form700ImportRun: { findMany: mocks.runFindMany }, form700Filing: { findMany: mocks.filingFindMany } } }));
import router from '../../src/routes/admin/history.js';

const app = express(); app.use('/api/admin/history', router); app.use((error, _req, res, _next) => res.status(500).json({ error: error.message }));
const counts = { scheduleAInvestments: 2, scheduleBRealEstate: 1, scheduleCdeIncome: 3, scheduleA2Positions: 0 };

beforeEach(() => { vi.clearAllMocks(); mocks.runFindMany.mockResolvedValue([]); mocks.filingFindMany.mockResolvedValue([]); });

describe('GET /api/admin/history', () => {
  it('groups existing filing metadata by digest and deduplicates warnings', async () => {
    mocks.filingFindMany.mockResolvedValue([1, 2].map(index => ({
      id: `filing-${index}`, filerName: `Filer ${index}`, filingYear: 2019, originalFilename: 'county.xlsx', createdAt: new Date('2026-10-30T10:00:00Z'),
      importMetadata: { digest: 'same-digest', warnings: ['Review amendments.'] }, _count: counts,
      politician: { fullName: `Filer ${index}`, slug: `filer-${index}`, jurisdiction: { name: 'County Test' } },
    })));
    const response = await request(app).get('/api/admin/history');
    expect(response.status).toBe(200);
    expect(response.body.pagination).toMatchObject({ total: 1, page: 1 });
    expect(response.body.data[0]).toMatchObject({ imported: 2, warnings: ['Review amendments.'] });
    expect(response.body.data[0].results[0].schedules_parsed).toEqual({ A: 2, B: 1, CDE: 3, A2: 0 });
  });

  it('prefers durable run history over duplicate legacy metadata', async () => {
    mocks.runFindMany.mockResolvedValue([{ id: 'run', originalFilename: 'county.xlsx', sourceDigest: 'digest', createdAt: new Date(), status: 'partial', importedCount: 1, skippedCount: 1, failedCount: 1, warnings: ['Warning'], results: [{ filer_name: 'Alex', filing_id: 'filing', status: 'imported' }] }]);
    mocks.filingFindMany.mockResolvedValue([{ id: 'filing', filerName: 'Alex', filingYear: 2019, originalFilename: 'county.xlsx', createdAt: new Date(), importMetadata: { digest: 'digest' }, _count: counts, politician: { fullName: 'Alex', slug: 'alex', jurisdiction: null } }]);
    const response = await request(app).get('/api/admin/history');
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0]).toMatchObject({ id: 'run', imported: 1, skipped: 1, failed: 1 });
  });

  it('filters warnings/failures and search text', async () => {
    mocks.runFindMany.mockResolvedValue([
      { id: 'one', originalFilename: 'sonoma.xlsx', sourceDigest: 'a', createdAt: new Date(), status: 'completed', importedCount: 1, skippedCount: 0, failedCount: 0, warnings: ['Amendment'], results: [{ filer_name: 'James Gore' }] },
      { id: 'two', originalFilename: 'other.xlsx', sourceDigest: 'b', createdAt: new Date(), status: 'completed', importedCount: 1, skippedCount: 0, failedCount: 0, warnings: [], results: [{ filer_name: 'Other Person' }] },
    ]);
    const response = await request(app).get('/api/admin/history?warningOnly=true&search=James');
    expect(response.body.data.map(row => row.id)).toEqual(['one']);
  });

  it('preserves original filing history when a later run only skipped it', async () => {
    mocks.runFindMany.mockResolvedValue([{ id: 'retry', originalFilename: 'county.xlsx', sourceDigest: 'digest', createdAt: new Date(), status: 'completed', importedCount: 0, skippedCount: 1, failedCount: 0, warnings: [], results: [{ filing_id: 'filing', status: 'skipped' }] }]);
    mocks.filingFindMany.mockResolvedValue([{ id: 'filing', filerName: 'Alex', filingYear: 2019, createdAt: new Date(), importMetadata: { digest: 'digest', warnings: ['Original warning'] }, _count: counts, politician: { fullName: 'Alex', slug: 'alex' } }]);
    const response = await request(app).get('/api/admin/history');
    expect(response.body.data).toHaveLength(2);
    expect(response.body.data.find(row => row.source === 'filing-metadata').warnings).toEqual(['Original warning']);
  });

  it('paginates and clamps out-of-range pages', async () => {
    mocks.runFindMany.mockResolvedValue(Array.from({ length: 21 }, (_, index) => ({ id: String(index), originalFilename: 'county.xlsx', createdAt: new Date(), warnings: [], results: [] })));
    const response = await request(app).get('/api/admin/history?page=999');
    expect(response.body.pagination).toEqual({ page: 2, pageSize: 20, pageCount: 2, total: 21 });
    expect(response.body.data).toHaveLength(1);
  });
  it('validates year and status filters', async () => {
    expect((await request(app).get('/api/admin/history?year=invalid')).status).toBe(400);
    expect((await request(app).get('/api/admin/history?status=invalid')).status).toBe(400);
    expect(mocks.runFindMany).not.toHaveBeenCalled();
  });
});