import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

vi.mock('../../src/lib/prisma.js', () => {
  const prisma = { $queryRaw: vi.fn() };
  return { prisma, default: prisma };
});

import { app } from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('health checks', () => {
  it('reports ready when the database responds', async () => {
    prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    const response = await request(app).get('/health/ready');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ready', database: 'ok' });
  });

  it('reports unavailable without exposing database errors', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('database secret detail'));
    const response = await request(app).get('/health/ready');
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ status: 'unavailable', database: 'error' });
    expect(JSON.stringify(response.body)).not.toContain('secret');
  });

});

describe('application responses', () => {
  it('returns the stable health response without querying the database', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('returns JSON for unknown routes', async () => {
    const response = await request(app).get('/api/does-not-exist');

    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toMatch(/json/);
    expect(response.body).toEqual({ error: 'not found' });
  });

  it('rejects malformed JSON without exposing its contents', async () => {
    const response = await request(app)
      .post('/api/admin/upload/form700')
      .set('Content-Type', 'application/json')
      .send('{"privateValue":"secret",');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'The request body contains invalid JSON.',
    });
    expect(JSON.stringify(response.body)).not.toContain('secret');
  });

  it('returns 413 for an oversized JSON body', async () => {
    const response = await request(app)
      .post('/api/admin/upload/form700')
      .send({ value: 'x'.repeat(110 * 1024) });

    expect(response.status).toBe(413);
    expect(response.body).toEqual({
      error: 'The uploaded file or request body is too large.',
    });
  });
});
