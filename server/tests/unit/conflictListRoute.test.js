import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { parseConflictQuery, conflictSql } from '../../src/utils/conflictQuery.js';
const db = vi.hoisted(() => ({ $transaction: vi.fn(), $queryRaw: vi.fn(), conflict: { findMany: vi.fn() } }));
vi.mock('../../src/lib/prisma.js', () => ({ prisma: db, default: db }));
import router from '../../src/routes/conflicts.js';
const app = express();
app.use('/api/conflicts', router);
app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.publicMessage ?? 'internal server error' }));
beforeEach(() => { vi.resetAllMocks(); db.$transaction.mockImplementation(fn => fn(db)); });
const row = id => ({ id, politician: { fullName: 'Alex', jurisdiction: { name: 'Davis' } }, agendaItem: { cityName: 'Davis', title: 'Contract' }, detectedAt: new Date('2026-10-01'), conflictType: 'INCOME', severity: 'HIGH' });
describe('conflict list contract', () => {
  it('returns bounded pagination and preserves SQL ordering', async () => {
    db.$queryRaw.mockResolvedValueOnce([{ total: 41 }]).mockResolvedValueOnce([{ id: 'b' }, { id: 'a' }]);
    db.conflict.findMany.mockResolvedValue([row('a'), row('b')]);
    const res = await request(app).get('/api/conflicts?page=2&pageSize=20');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 41, page: 2, pageSize: 20 });
    expect(res.body.data.map(r => r.id)).toEqual(['b', 'a']);
    const query = db.$queryRaw.mock.calls[1][0];
    expect(query.sql).toContain('c.id ASC');
    expect(query.values.slice(-2)).toEqual([20, 20]);
    expect(db.$transaction.mock.calls[0][1]).toEqual({ isolationLevel: 'RepeatableRead' });
  });
  it('returns an empty out-of-range page with its total', async () => {
    db.$queryRaw.mockResolvedValueOnce([{ total: 1 }]).mockResolvedValueOnce([]);
    const res = await request(app).get('/api/conflicts?page=9');
    expect(res.body).toEqual({ data: [], total: 1, page: 9, pageSize: 20 });
    expect(db.conflict.findMany).not.toHaveBeenCalled();
  });
  it.each(['page=0', 'page=-1', 'page=1.5', 'page=1x', 'pageSize=101', 'limit=0', 'sort=sql', 'types=NOPE', 'severities=CRITICAL', 'reviewStatus=private', 'fromDate=2026-02-30', 'fromDate=2026-10-02&toDate=2026-10-01', 'city[x]=a', 'page=1&page=2'])('rejects %s without querying the DB', async query => {
    const res = await request(app).get(`/api/conflicts?${query}`);
    expect(res.status).toBe(400); expect(res.body.error).toEqual(expect.any(String));
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('parameterizes combined filters and uses exclusive next-day end', () => {
    const filters = parseConflictQuery({ city: "Davis' OR TRUE--", types: ['GIFT', 'INCOME'], severities: 'high', reviewStatus: 'pending', fromDate: '2026-10-01', toDate: '2026-10-02', sort: 'severity' });
    const { from, order } = conflictSql(filters);
    expect(from.sql).not.toContain(filters.city);
    expect(from.values).toContain(filters.city);
    expect(from.values).toContainEqual(new Date('2026-10-03'));
    expect(order.sql).toContain("WHEN 'MEDIUM' THEN 2");
    expect(order.sql).toContain('c.id ASC');
  });
  it('returns consistent JSON on database failure', async () => {
    db.$transaction.mockRejectedValue(new Error('SQL secret'));
    const res = await request(app).get('/api/conflicts');
    expect(res.status).toBe(500); expect(res.body).toEqual({ error: 'internal server error' });
  });
  it('provides city choices independently of the page', async () => {
    db.$queryRaw.mockResolvedValue([{ city: 'Davis' }, { city: 'Sacramento' }]);
    const res = await request(app).get('/api/conflicts/filters');
    expect(res.body).toEqual({ data: ['Davis', 'Sacramento'] });
  });
});
