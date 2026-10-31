import { request, safeMessage } from "./lib/request";
type SessionResponse = { access_token: string; refresh_token: string; expires_in: number; expires_at?: number; user?: { id?: string; email?: string } };
export type AdminSession = SessionResponse & { expires_at: number };

const SESSION_KEY = "fair.admin.session";
const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
let refreshPromise: Promise<AdminSession> | null = null;
class InvalidAdminSession extends Error {}

function authConfig() {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey || url.includes("YOUR_PROJECT_REF") || anonKey.includes("YOUR_PUBLIC")) throw new Error("Admin sign-in is not configured. Add the public Supabase URL and anon key to client/.env.");
  return { url: url.replace(/\/$/, ""), anonKey };
}
export function isAdminAuthConfigured() { try { authConfig(); return true; } catch { return false; } }

function storeSession(session: SessionResponse): AdminSession {
  const expiresAt = session.expires_at ? session.expires_at * (session.expires_at < 10_000_000_000 ? 1000 : 1) : Date.now() + session.expires_in * 1000;
  const saved = { ...session, expires_at: expiresAt } as AdminSession;
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(saved));
  return saved;
}
function readSession(): AdminSession | null {
  try { const raw = window.localStorage.getItem(SESSION_KEY) ?? window.sessionStorage.getItem(SESSION_KEY); if (!raw) return null; const session = JSON.parse(raw) as AdminSession; return session.access_token && session.refresh_token ? session : null; } catch { return null; }
}
async function requestToken(grant: "password" | "refresh_token", credentials: Record<string, string>) {
  const { url, anonKey } = authConfig();
  const response = await request(`${url}/auth/v1/token?grant_type=${grant}`, { method: "POST", headers: { apikey: anonKey, "Content-Type": "application/json" }, body: JSON.stringify(credentials) });
  const result = await response.json();
  if (!response.ok) {
    const message = safeMessage(result.error_description ?? result.msg ?? result.message, "Sign-in failed.");
    if (grant === 'refresh_token' && [400, 401, 403].includes(response.status)) throw new InvalidAdminSession('Your admin session expired. Sign in again.');
    throw new Error(message);
  }
  if (!result.access_token || !result.refresh_token || !Number.isFinite(result.expires_in)) throw new Error('Authentication returned an incomplete session. Please retry.');
  return storeSession(result as SessionResponse);
}
export function signInWithPassword(email: string, password: string) { return requestToken("password", { email, password }); }
async function refreshAdminSession(session: AdminSession) {
  if (!refreshPromise) refreshPromise = requestToken("refresh_token", { refresh_token: session.refresh_token }).finally(() => { refreshPromise = null; });
  return refreshPromise;
}
export async function getAdminSession(forceRefresh = false): Promise<AdminSession> { const session = readSession(); if (!session) throw new Error("Admin session is missing."); if (!forceRefresh && session.expires_at > Date.now() + 30_000) return session; return refreshAdminSession(session); }
export async function getAdminAccessToken() { return (await getAdminSession()).access_token; }
export function clearAdminSession() { window.localStorage.removeItem(SESSION_KEY); window.sessionStorage.removeItem(SESSION_KEY); window.localStorage.removeItem("adminAccessToken"); window.localStorage.removeItem("isAdmin"); }
export async function signOut() { const session = readSession(); clearAdminSession(); if (!session) return; try { const { url, anonKey } = authConfig(); await request(`${url}/auth/v1/logout`, { method: "POST", headers: { apikey: anonKey, Authorization: `Bearer ${session.access_token}` } }); } catch { /* best effort */ } }

async function authorizedRequest(path: string, init: RequestInit, forceRefresh = false) {
  const session = await getAdminSession(forceRefresh);
  const headers = new Headers(init.headers); headers.set("Authorization", `Bearer ${session.access_token}`);
  return request(`${API_URL}${path}`, { ...init, headers });
}

async function responseMessage(response: Response, fallback: string) {
  try { const payload = await response.clone().json(); return safeMessage(payload?.error, fallback); }
  catch { return fallback; }
}

export async function verifyAdminAccess() {
  let response: Response;
  try {
    response = await authorizedRequest('/api/admin/session', {});
    if (response.status === 401) response = await authorizedRequest('/api/admin/session', {}, true);
  } catch (error) {
    if (error instanceof InvalidAdminSession) clearAdminSession();
    throw error;
  }
  if (response.ok) return;
  if (response.status === 401) { clearAdminSession(); throw new Error('Your admin session expired. Sign in again.'); }
  if (response.status === 403) { clearAdminSession(); throw new Error(await responseMessage(response, 'This account is not authorized for FAIR administration.')); }
  throw new Error(await responseMessage(response, 'Admin authentication could not be verified. Please retry without signing in again.'));
}

function redirectToLogin(reason: 'expired' | 'forbidden') {
  const url = `/admin/login?reason=${reason}`;
  if (window.location.pathname + window.location.search !== url) window.location.assign(url);
}
export async function adminFetch(path: string, init: RequestInit = {}) {
  const startedAt = performance.now();
  const method = init.method ?? "GET";
  console.debug("[admin-auth] session start", { method, path, apiUrl: API_URL });
  try {
    await getAdminSession();
    console.debug("[admin-auth] session ready", { method, path, elapsedMs: Math.round(performance.now() - startedAt) });
  } catch (error) {
    console.error("[admin-auth] session failed", { method, path, elapsedMs: Math.round(performance.now() - startedAt), errorName: error instanceof Error ? error.name : typeof error });
    if (error instanceof InvalidAdminSession) { clearAdminSession(); redirectToLogin('expired'); }
    throw error;
  }
  let response = await authorizedRequest(path, init);
  if (response.status === 401) {
    try { response = await authorizedRequest(path, init, true); }
    catch (error) {
      if (error instanceof InvalidAdminSession) { clearAdminSession(); redirectToLogin('expired'); }
      throw error;
    }
  }
  console.debug("[admin-auth] API response", { method, path, status: response.status, elapsedMs: Math.round(performance.now() - startedAt), requestId: response.headers.get("X-Request-ID") });
  if (response.status === 401) { clearAdminSession(); redirectToLogin('expired'); }
  if (response.status === 403) { clearAdminSession(); redirectToLogin('forbidden'); }
  return response;
}
export { API_URL };