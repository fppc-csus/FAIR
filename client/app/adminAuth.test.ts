import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("adminAuth", () => {
  beforeEach(() => {
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
});