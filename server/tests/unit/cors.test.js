import { afterAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import '../../src/lib/env.js';
import { getClientOrigin } from '../../src/middleware/clientOrigin.js';

vi.mock('../../src/lib/prisma.js', () => {
  const prisma = { $queryRaw: vi.fn() };
  return { prisma, default: prisma };
});

vi.stubEnv('NODE_ENV', 'production');
vi.stubEnv('CLIENT_ORIGIN', 'https://fair.example');
const { app } = await import('../../src/app.js');

afterAll(() => vi.unstubAllEnvs());

describe('CORS configuration', () => {
  it('allows the configured production client', async () => {
    const response = await request(app)
      .get('/health')
      .set('Origin', 'https://fair.example');

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin'])
      .toBe('https://fair.example');
  }, 10_000);

  it('does not grant access to another origin', async () => {
    const response = await request(app)
      .get('/health')
      .set('Origin', 'https://other.example');

    // Browsers deny access when this header does not match their origin.
    const allowed = response.headers['access-control-allow-origin'];
    expect(allowed).not.toBe('https://other.example');
    expect(allowed).not.toBe('*');
  });

  it('disables CORS in production without a client origin', async () => {
    expect(getClientOrigin({ nodeEnv: 'production', clientOrigin: '' })).toBe(false);
  });

  it('supports localhost preflight requests in development', async () => {
    expect(getClientOrigin({ nodeEnv: 'development', clientOrigin: '' }))
      .toBe('http://localhost:5173');
    const response = await request(app)
      .options('/api/conflicts')
      .set('Origin', 'https://fair.example')
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'authorization');

    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin'])
      .toBe('https://fair.example');
    expect(response.headers['access-control-allow-headers'])
      .toContain('authorization');
  });
});