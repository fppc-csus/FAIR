import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("adminAuth", () => {
  beforeEach(() => {
    window.localStorage.clear(); window.sessionStorage.clear();
    vi.resetModules();
    vi.stubEnv("VITE_SUPABASE_URL", "https://fair-test.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "public-anon-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("stores the complete Supabase session used by the admin guard", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      access_token: "access-token",
      refresh_token: "refresh-token",
      expires_in: 3600,
      user: { id: "admin-1", email: "admin@example.gov" },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const { signInWithPassword, getAdminSession } = await import("./adminAuth");
    await signInWithPassword("admin@example.gov", "password");

    const stored = JSON.parse(window.localStorage.getItem("fair.admin.session") ?? "{}");
    expect(stored.access_token).toBe("access-token");
    expect(stored.refresh_token).toBe("refresh-token");
    await expect(getAdminSession()).resolves.toMatchObject({ access_token: "access-token" });
  });

  it("reports placeholder configuration as unavailable", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://YOUR_PROJECT_REF.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "YOUR_PUBLIC_SUPABASE_ANON_OR_PUBLISHABLE_KEY");
    vi.resetModules();
    const { isAdminAuthConfigured } = await import("./adminAuth");
    expect(isAdminAuthConfigured()).toBe(false);
  });

  it('coordinates concurrent refreshes so only one refresh token request runs', async () => {
    window.localStorage.setItem('fair.admin.session', JSON.stringify({ access_token: 'old', refresh_token: 'refresh', expires_in: 1, expires_at: Date.now() - 1 }));
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ access_token: 'new', refresh_token: 'next', expires_in: 3600 }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const { getAdminSession } = await import('./adminAuth');
    const [first, second] = await Promise.all([getAdminSession(), getAdminSession()]);
    expect(first.access_token).toBe('new'); expect(second.access_token).toBe('new');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refreshes and retries one unauthorized API response without clearing the session', async () => {
    window.localStorage.setItem('fair.admin.session', JSON.stringify({ access_token: 'old', refresh_token: 'refresh', expires_in: 3600, expires_at: Date.now() + 3600_000 }));
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ code: 'authentication_required' }, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ access_token: 'new', refresh_token: 'next', expires_in: 3600 }))
      .mockResolvedValueOnce(Response.json({ data: [] }));
    const { adminFetch } = await import('./adminAuth');
    expect((await adminFetch('/api/admin/history')).status).toBe(200);
    expect(JSON.parse(window.localStorage.getItem('fair.admin.session')!).access_token).toBe('new');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not clear a valid session when verification is temporarily unavailable', async () => {
    window.localStorage.setItem('fair.admin.session', JSON.stringify({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600, expires_at: Date.now() + 3600_000 }));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ error: 'retry', code: 'auth_unavailable' }, { status: 503 }));
    const { verifyAdminAccess } = await import('./adminAuth');
    await expect(verifyAdminAccess()).rejects.toThrow('retry');
    expect(window.localStorage.getItem('fair.admin.session')).not.toBeNull();
  });

  it('retains the session if the refresh after a 401 has a temporary failure', async () => {
    window.localStorage.setItem('fair.admin.session', JSON.stringify({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600, expires_at: Date.now() + 3600_000 }));
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({}, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ msg: 'Authentication service unavailable' }, { status: 503 }));
    const { adminFetch } = await import('./adminAuth');
    await expect(adminFetch('/api/admin/history')).rejects.toThrow('Authentication service unavailable');
    expect(window.localStorage.getItem('fair.admin.session')).not.toBeNull();
  });
});