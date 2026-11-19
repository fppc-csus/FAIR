import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/jobs/scheduleCronJobs.js', () => ({ scheduleCronJobs: vi.fn() }));
vi.mock('../../src/lib/prisma.js', () => {
  const prisma = new Proxy({}, { get: () => new Proxy({}, { get: () => vi.fn(async () => { throw new Error('database must not be read'); }) }) });
  return { prisma, default: prisma };
});

import { app } from '../../src/app.js';

describe('investigator-only data access', () => {
  it.each([
    '/api/conflicts',
    '/api/conflicts/filters',
    '/api/politicians',
    '/api/politicians/id/00000000-0000-4000-8000-000000000000',
    '/api/agenda',
    '/api/search?q=landpaths',
  ])('rejects %s without a session before touching the database', async (path) => {
    const response = await request(app).get(path);
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('authentication_required');
  });

  it('keeps the health check open for uptime monitoring', async () => {
    expect((await request(app).get('/health')).status).toBe(200);
  });
});
