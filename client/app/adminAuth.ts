import { request, safeMessage } from "./lib/request";
type SessionResponse = { access_token: string; refresh_token: string; expires_in: number; expires_at?: number; user?: { id?: string; email?: string } };
export type AdminSession = SessionResponse & { expires_at: number };

const SESSION_KEY = "fair.admin.session";
const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
let refreshPromise: Promise<AdminSession> | null = null;
export class InvalidAdminSession extends Error {}
export class AdminAccessDenied extends Error {}

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
export async function getAdminSession(forceRefresh = false): Promise<AdminSession> { const session = readSession(); if (!session) throw new InvalidAdminSession("Admin session is missing."); if (!forceRefresh && session.expires_at > Date.now() + 30_000) return session; return refreshAdminSession(session); }
export async function getAdminAccessToken() { return (await getAdminSession()).access_token; }
export function clearAdminSession() { accessCache = null; window.localStorage.removeItem(SESSION_KEY); window.sessionStorage.removeItem(SESSION_KEY); window.localStorage.removeItem("adminAccessToken"); window.localStorage.removeItem("isAdmin"); }
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

// One membership check per minute is enough: the guard and the admin nav both
// ask on every page load, and the API rejects stale sessions regardless.
const ACCESS_CACHE_MS = 60_000;
let accessCache: { token: string; at: number; promise: Promise<{ userId: string; email: string; role: 'owner' | 'admin' }> } | null = null;

export function verifyAdminAccess() {
  const token = readSession()?.access_token ?? '';
  if (accessCache && accessCache.token === token && Date.now() - accessCache.at < ACCESS_CACHE_MS) return accessCache.promise;
  const promise = verifyAdminAccessUncached();
  accessCache = { token, at: Date.now(), promise };
  promise.catch(() => { if (accessCache?.promise === promise) accessCache = null; });
  return promise;
}

async function verifyAdminAccessUncached() {
  let response: Response;
  try {
    response = await authorizedRequest('/api/admin/session', {});
    if (response.status === 401) response = await authorizedRequest('/api/admin/session', {}, true);
  } catch (error) {
    if (error instanceof InvalidAdminSession) clearAdminSession();
    throw error;
  }
  if (response.ok) return (await response.json()).data as { userId: string; email: string; role: 'owner' | 'admin' };
  if (response.status === 401) { clearAdminSession(); throw new InvalidAdminSession('Your admin session expired. Sign in again.'); }
  if (response.status === 403) { clearAdminSession(); throw new AdminAccessDenied(await responseMessage(response, 'This account is not authorized for FAIR administration.')); }
  throw new Error(await responseMessage(response, 'Admin authentication could not be verified. Please retry without signing in again.'));
}

function redirectToLogin(reason: 'expired' | 'forbidden') {
  const url = `/admin/login?reason=${reason}`;
  if (window.location.pathname + window.location.search !== url) window.location.assign(url);
}
type AdminFetchOptions = { redirectOnNotFound?: boolean };

export async function adminFetch(path: string, init: RequestInit = {}, { redirectOnNotFound = true }: AdminFetchOptions = {}) {
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
  if (response.status === 403) {
    const payload = await response.clone().json().catch(() => ({}));
    if (payload.code !== 'owner_required') clearAdminSession();
    redirectToLogin('forbidden');
  }
  if (redirectOnNotFound && response.status === 404 && window.location.pathname !== '/404') window.location.assign('/404');
  return response;
}

/**
 * Authenticated request for investigator data. FAIR has no public data API, so
 * every record request carries the signed-in session. Accepts an absolute API
 * URL or a path; 404s are returned to the caller instead of redirecting.
 */
export function investigatorFetch(url: string, init: RequestInit = {}) {
  const path = url.startsWith(API_URL) ? url.slice(API_URL.length) : url;
  return adminFetch(path, init, { redirectOnNotFound: false });
}

/** Download an authenticated file (e.g. CSV export) without exposing the token in a URL. */
export async function downloadAuthenticated(url: string, fallbackName: string) {
  const response = await investigatorFetch(url);
  if (!response.ok) throw new Error(await responseMessage(response, 'The export could not be generated. Please retry.'));
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const filename = disposition.match(/filename="?([^";]+)"?/)?.[1] ?? fallbackName;
  const href = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = href; link.download = filename; document.body.append(link); link.click(); link.remove();
  URL.revokeObjectURL(href);
}
export { API_URL };

export async function requestPasswordReset(email: string) {
  const { url, anonKey } = authConfig();
  const redirect = new URL('/admin/account', window.location.origin);
  const response = await request(`${url}/auth/v1/recover?redirect_to=${encodeURIComponent(redirect.href)}`, {
    method: 'POST', headers: { apikey: anonKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
  });
  if (!response.ok) throw new Error('Password reset could not be requested. Please retry later.');
}

// Invitation/recovery emails use Supabase's implicit redirect by default.
// Custom token_hash templates are supported as well. Never retain tokens in URLs.
export async function receiveAccountLink() {
  const { url, anonKey } = authConfig();
  const params = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.slice(1));
  const invitation = params.get('invitation');
  const tokenHash = params.get('token_hash');
  const type = params.get('type');
  const error = hash.get('error_description') ?? params.get('error_description');
  window.history.replaceState(null, '', '/admin/account');
  if (error) throw new Error('This account link is invalid or expired. Request a new invitation or password reset.');
  if (hash.get('access_token') && hash.get('refresh_token')) {
    const expires = Number(hash.get('expires_in'));
    if (!Number.isFinite(expires) || expires <= 0) throw new Error('Invalid account link.');
    storeSession({ access_token: hash.get('access_token')!, refresh_token: hash.get('refresh_token')!, expires_in: expires });
  } else if (tokenHash && ['invite', 'recovery'].includes(type ?? '')) {
    const response = await request(`${url}/auth/v1/verify`, { method: 'POST', headers: { apikey: anonKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ token_hash: tokenHash, type }) });
    const result = await response.json();
    if (!response.ok || !result.access_token || !result.refresh_token || !Number.isFinite(result.expires_in)) throw new Error('This account link is invalid or expired. Request a new link.');
    storeSession(result);
  } else {
    throw new Error('Open a fresh invitation or password-reset email to set your password.');
  }
  return invitation;
}

export async function finishAccountSetup(password: string, invitation: string | null) {
  const { url, anonKey } = authConfig();
  const session = await getAdminSession();
  const response = await request(`${url}/auth/v1/user`, { method: 'PUT', headers: { apikey: anonKey, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(safeMessage(payload.msg ?? payload.message, 'Password could not be updated. Request a new account link.'));
  }
  if (invitation) {
    const accepted = await authorizedRequest('/api/admin/users/accept', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: invitation }) });
    if (!accepted.ok) throw new Error(await responseMessage(accepted, 'Your password was saved, but access could not be activated. Ask an owner to resend the invitation.'));
  }
  await verifyAdminAccess();
}