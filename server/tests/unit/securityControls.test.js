import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  membershipFor: vi.fn(),
  runNightlyLegistarSync: vi.fn(),
  prisma: {
    $queryRaw: vi.fn(),
    politician: { findMany: vi.fn() },
  },
}));

vi.mock('../../src/lib/supabase.js', () => ({
  supabase: { auth: { getUser: mocks.getUser } },
}));
vi.mock('../../src/lib/adminAccess.js', () => ({
  membershipFor: mocks.membershipFor,
  acceptInvitation: vi.fn(),
  changeMember: vi.fn(),
  invitationById: vi.fn(),
  listAccess: vi.fn(),
  revokeInvitation: vi.fn(),
  sendInvitation: vi.fn(),
}));
vi.mock('../../src/lib/prisma.js', () => ({
  prisma: mocks.prisma,
  default: mocks.prisma,
}));
vi.mock('../../src/jobs/nightlySync.js', () => ({
  runNightlyLegistarSync: mocks.runNightlyLegistarSync,
}));

vi.stubEnv('NODE_ENV', 'production');
const { app } = await import('../../src/app.js');
const {
  createRateLimit,
  syncRateLimit,
  uploadRateLimit,
} = await import('../../src/middleware/rateLimits.js');

const protectedAdminRequests = [
  ['get', '/api/admin/session'],
  ['get', '/api/admin/users'],
  ['get', '/api/admin/sources'],
  ['get', '/api/admin/reports'],
  ['get', '/api/admin/politicians'],
  ['get', '/api/admin/detection-runs'],
  ['get', '/api/admin/conflicts'],
  ['get', '/api/admin/history'],
  ['post', '/api/admin/sync/run-nightly-sync'],
  ['post', '/api/admin/upload/form700'],
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({
    data: { user: { id: 'unauthorized-user', email: 'user@example.test' } },
    error: null,
  });
  mocks.membershipFor.mockResolvedValue(null);
});

describe('admin route authorization at the application mount points', () => {
  it.each(protectedAdminRequests)('rejects unauthenticated %s %s', async (method, path) => {
    const response = await request(app)[method](path);

    expect(response.status).toBe(401);
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.runNightlyLegistarSync).not.toHaveBeenCalled();
  });

  it.each(protectedAdminRequests)('rejects a valid Supabase user without membership for %s %s', async (method, path) => {
    const response = await request(app)[method](path).set('Authorization', 'Bearer valid-token');

    expect(response.status).toBe(403);
    expect(mocks.membershipFor).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'unauthorized-user' }),
    );
    expect(mocks.runNightlyLegistarSync).not.toHaveBeenCalled();
  });
});

describe('security response controls', () => {
  it('sets baseline production security headers on API responses', async () => {
    const response = await request(app).get('/health');

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['strict-transport-security']).toBeDefined();
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('returns an allowlisted public shape without archived paths or credentials', async () => {
    mocks.prisma.politician.findMany.mockResolvedValue([{
      id: 'public-politician',
      slug: 'public-politician',
      fullName: 'Public Politician',
      district: 'District 1',
      _count: { conflicts: 1 },
      archivedPath: 'filings/private/file.xlsx',
      serviceRoleKey: 'must-not-leak',
    }]);

    const response = await request(app).get('/api/politicians');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      data: [{
        id: 'public-politician',
        slug: 'public-politician',
        fullName: 'Public Politician',
        district: 'District 1',
        conflictCount: 1,
      }],
    });
    expect(JSON.stringify(response.body)).not.toMatch(/archivedPath|serviceRoleKey|must-not-leak/);
  });

  it('does not expose internal exception messages or credentials in public errors', async () => {
    mocks.prisma.$queryRaw.mockRejectedValue(
      new Error('service role secret internal database detail'),
    );

    const response = await request(app).get('/api/search?q=meeting');

    expect(response.status).toBe(500);
    expect(response.body.error).toBe(
      'The server could not complete this request. Please try again.',
    );
    expect(JSON.stringify(response.body)).not.toMatch(/secret|internal database detail/i);
  });

  it('limits requests and returns standard rate-limit headers', async () => {
    const limitedApp = express();
    limitedApp.use(createRateLimit({ windowMs: 60_000, limit: 2 }));
    limitedApp.get('/', (_req, res) => res.json({ ok: true }));

    expect((await request(limitedApp).get('/')).status).toBe(200);
    expect((await request(limitedApp).get('/')).status).toBe(200);
    const response = await request(limitedApp).get('/');

    expect(response.status).toBe(429);
    expect(response.body).toEqual({
      error: 'Too many requests. Please try again later.',
    });
    expect(response.headers['ratelimit-limit']).toBe('2');
    expect(response.headers['ratelimit-remaining']).toBe('0');
  });

  it('applies the configured public API limit at the application route', async () => {
    const publicAgent = request.agent(app);
    for (let index = 0; index < 118; index += 1) {
      const response = await publicAgent.get('/api/search');
      expect(response.status).toBe(200);
    }

    const response = await publicAgent.get('/api/search');
    expect(response.status).toBe(429);
    expect(response.body.error).toMatch(/Too many requests/);
  });

  it('limits uploads and manual sync to their configured request budgets', async () => {
    const uploadApp = express();
    uploadApp.use(uploadRateLimit);
    uploadApp.post('/', (_req, res) => res.sendStatus(204));
    for (let index = 0; index < 5; index += 1) {
      expect((await request(uploadApp).post('/')).status).toBe(204);
    }
    expect((await request(uploadApp).post('/')).status).toBe(429);

    const syncApp = express();
    syncApp.use(syncRateLimit);
    syncApp.post('/', (_req, res) => res.sendStatus(204));
    expect((await request(syncApp).post('/')).status).toBe(204);
    expect((await request(syncApp).post('/')).status).toBe(429);
  });

  it('limits requests across all mounted admin routes', async () => {
    for (let index = 0; index < 10; index += 1) {
      expect((await request(app).get('/api/admin/session')).status).toBe(401);
    }
    expect((await request(app).get('/api/admin/session')).status).toBe(429);
  });
});
