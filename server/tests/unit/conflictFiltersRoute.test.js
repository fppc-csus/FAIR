import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ conflict: { findMany: vi.fn(), findUnique: vi.fn() } }));
vi.mock('../../src/lib/prisma.js', () => ({ default: db, prisma: db }));
import router from '../../src/routes/conflicts.js';

const app = express(); app.use('/api/conflicts', router); app.use((error, _req, res, _next) => res.status(500).json({ error: error.message }));
function conflict(city, conflictType, severity) { return { id: `${city}-${conflictType}`, detectedAt: new Date(), politician: { fullName: 'Official', jurisdiction: { name: city } }, agendaItem: { cityName: city, title: 'Agenda' }, conflictType, severity }; }

beforeEach(() => vi.clearAllMocks());
describe('GET /api/conflicts/filters', () => {
  it('returns sorted, unique filters without routing to conflict detail', async () => {
    db.conflict.findMany.mockResolvedValue([conflict('Oakland', 'INCOME', 'MEDIUM'), conflict('Oakland', 'GIFT', 'HIGH'), conflict('Sacramento', 'INCOME', 'HIGH')]);
    const response = await request(app).get('/api/conflicts/filters');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: { cities: ['Oakland', 'Sacramento'], conflictTypes: ['GIFT', 'INCOME'], severities: ['HIGH', 'MEDIUM'] } });
    expect(db.conflict.findUnique).not.toHaveBeenCalled();
    expect(db.conflict.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { politician: { isDemo: false }, agendaItem: { isDemo: false } } }));
  });
});