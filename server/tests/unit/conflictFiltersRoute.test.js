import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ $queryRaw: vi.fn(), conflict: { findMany: vi.fn(), findUnique: vi.fn() } }));
vi.mock('../../src/lib/prisma.js', () => ({ default: db, prisma: db }));
import router from '../../src/routes/conflicts.js';

const app = express(); app.use('/api/conflicts', router); app.use((error, _req, res, _next) => res.status(500).json({ error: error.message }));

beforeEach(() => vi.clearAllMocks());
describe('GET /api/conflicts/filters', () => {
  it('returns sorted, unique filters without routing to conflict detail', async () => {
    db.$queryRaw.mockResolvedValue([{ city: 'Oakland' }, { city: 'Sacramento' }]);
    const response = await request(app).get('/api/conflicts/filters');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: ['Oakland', 'Sacramento'] });
    expect(db.conflict.findUnique).not.toHaveBeenCalled();
    expect(db.$queryRaw.mock.calls[0][0].sql).toContain('p.is_demo = false AND a.is_demo = false');
  });
  it('returns an empty city list when there are no public conflicts', async () => {
    db.$queryRaw.mockResolvedValue([]);
    expect((await request(app).get('/api/conflicts/filters')).body).toEqual({ data: [] });
  });
});