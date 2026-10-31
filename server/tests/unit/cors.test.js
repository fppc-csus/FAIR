import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import '../../src/lib/env.js';

vi.mock('../../src/lib/prisma.js', () => {
  const prisma = { $queryRaw: vi.fn() };
  return { prisma, default: prisma };
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function loadApp(mode, origin) {
  vi.resetModules();
  vi.stubEnv('NODE_ENV', mode);
  vi.stubEnv('CLIENT_ORIGIN', origin);

  const { app } = await import('../../src/app.js');
  return app;
}

describe('CORS configuration', () => {
  it('allows the configured production client', async () => {
    const app = await loadApp('production', 'https://fair.example');

    const response = await request(app)
      .get('/health')
      .set('Origin', 'https://fair.example');

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin'])
      .toBe('https://fair.example');
  });

  it('does not grant access to another origin', async () => {
    const app = await loadApp('production', 'https://fair.example');

    const response = await request(app)
      .get('/health')
      .set('Origin', 'https://other.example');

    // Browsers deny access when this header does not match their origin.
    const allowed = response.headers['access-control-allow-origin'];
    expect(allowed).not.toBe('https://other.example');
    expect(allowed).not.toBe('*');
  });

  it('disables CORS in production without a client origin', async () => {
    const app = await loadApp('production', '');

    const response = await request(app)
      .get('/health')
      .set('Origin', 'http://localhost:5173');

    expect(response.headers['access-control-allow-origin'])
      .toBeUndefined();
  });

  it('supports localhost preflight requests in development', async () => {
    const app = await loadApp('development', '');

    const response = await request(app)
      .options('/api/conflicts')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'authorization');

    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin'])
      .toBe('http://localhost:5173');
    expect(response.headers['access-control-allow-headers'])
      .toContain('authorization');
  });
});