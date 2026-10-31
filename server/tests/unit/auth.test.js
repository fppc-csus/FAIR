import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/lib/supabase.js', () => ({
  supabase: {
    auth: {
      getUser: vi.fn(),
    },
  },
}));

import { supabase } from '../../src/lib/supabase.js';
import { requireAdmin, extractBearerToken, isAuthorizedAdmin } from '../../src/lib/auth.js';

function mockRes() {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

function mockReq(headers = {}) {
  return { headers };
}

describe('requireAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.FAIR_ADMIN_EMAIL = 'admin@fppc.ca.gov';
  });

  it('calls next() and sets req.user for a valid token', async () => {
    const user = { id: 'user-123', email: 'admin@fppc.ca.gov' };
    supabase.auth.getUser.mockResolvedValue({ data: { user }, error: null });

    const req = mockReq({ authorization: 'Bearer valid-jwt' });
    const res = mockRes();
    const next = vi.fn();

    await requireAdmin(req, res, next);

    expect(supabase.auth.getUser).toHaveBeenCalledWith('valid-jwt');
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toEqual(user);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 401 when the Authorization header is missing', async () => {
    const req = mockReq({});
    const res = mockRes();
    const next = vi.fn();

    await requireAdmin(req, res, next);

    expect(supabase.auth.getUser).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'authentication_required' }));
    expect(next).not.toHaveBeenCalled();
    expect(req.user).toBeUndefined();
  });

  it('returns 401 when the header is not a Bearer token', async () => {
    const req = mockReq({ authorization: 'Basic abc123' });
    const res = mockRes();
    const next = vi.fn();

    await requireAdmin(req, res, next);

    expect(supabase.auth.getUser).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'authentication_required' }));
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when supabase.auth.getUser reports an error (invalid/expired token)', async () => {
    supabase.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'invalid JWT', status: 401 },
    });

    const req = mockReq({ authorization: 'Bearer expired-jwt' });
    const res = mockRes();
    const next = vi.fn();

    await requireAdmin(req, res, next);

    expect(supabase.auth.getUser).toHaveBeenCalledWith('expired-jwt');
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'authentication_required' }));
    expect(next).not.toHaveBeenCalled();
    expect(req.user).toBeUndefined();
  });

  it('returns 403 for a valid user that is not the configured admin', async () => {
    supabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-456', email: 'other@fppc.ca.gov' } },
      error: null,
    });
    const res = mockRes();
    const next = vi.fn();

    await requireAdmin(mockReq({ authorization: 'Bearer valid-jwt' }), res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'admin_forbidden' }));
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 503 (never throws) when getUser rejects', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    supabase.auth.getUser.mockRejectedValue(new Error('network down'));

    const req = mockReq({ authorization: 'Bearer any' });
    const res = mockRes();
    const next = vi.fn();

    await expect(requireAdmin(req, res, next)).resolves.not.toThrow();

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'auth_unavailable' }));
    expect(next).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('returns 503 for a Supabase rate-limit or service error', async () => {
    supabase.auth.getUser.mockResolvedValue({ data: { user: null }, error: { status: 503 } });
    const res = mockRes(); const next = vi.fn();
    await requireAdmin(mockReq({ authorization: 'Bearer token' }), res, next);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(next).not.toHaveBeenCalled();
  });

  it('fails closed without treating missing server configuration as a bad session', async () => {
    delete process.env.FAIR_ADMIN_EMAIL;
    const res = mockRes();
    await requireAdmin(mockReq({ authorization: 'Bearer token' }), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(503);
    expect(supabase.auth.getUser).not.toHaveBeenCalled();
  });
});

describe('isAuthorizedAdmin', () => {
  it('fails closed when the configured admin email is missing', () => {
    const saved = process.env.FAIR_ADMIN_EMAIL;
    delete process.env.FAIR_ADMIN_EMAIL;
    expect(isAuthorizedAdmin({ email: 'admin@fppc.ca.gov' })).toBe(false);
    process.env.FAIR_ADMIN_EMAIL = saved;
  });
});

describe('extractBearerToken', () => {
  it('extracts the token case-insensitively and trims whitespace', () => {
    expect(extractBearerToken('Bearer abc')).toBe('abc');
    expect(extractBearerToken('bearer   abc  ')).toBe('abc');
  });

  it('returns null for missing, empty or non-Bearer values', () => {
    expect(extractBearerToken(undefined)).toBeNull();
    expect(extractBearerToken('')).toBeNull();
    expect(extractBearerToken('Bearer ')).toBeNull();
    expect(extractBearerToken('Basic abc')).toBeNull();
  });
});
