type SessionResponse = { access_token: string; refresh_token: string; expires_in: number; expires_at?: number; user?: { id?: string; email?: string } };
export type AdminSession = SessionResponse & { expires_at: number };

const SESSION_KEY = "fair.admin.session";
const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

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
  const response = await fetch(`${url}/auth/v1/token?grant_type=${grant}`, { method: "POST", headers: { apikey: anonKey, "Content-Type": "application/json" }, body: JSON.stringify(credentials) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error_description ?? result.msg ?? result.message ?? "Sign-in failed.");
  return storeSession(result as SessionResponse);
}
export function signInWithPassword(email: string, password: string) { return requestToken("password", { email, password }); }
export async function getAdminSession(): Promise<AdminSession> { const session = readSession(); if (!session) throw new Error("Admin session is missing."); if (session.expires_at > Date.now() + 30_000) return session; return requestToken("refresh_token", { refresh_token: session.refresh_token }); }
export async function getAdminAccessToken() { return (await getAdminSession()).access_token; }
export function clearAdminSession() { window.localStorage.removeItem(SESSION_KEY); window.sessionStorage.removeItem(SESSION_KEY); window.localStorage.removeItem("adminAccessToken"); window.localStorage.removeItem("isAdmin"); }
export async function signOut() { const session = readSession(); clearAdminSession(); if (!session) return; try { const { url, anonKey } = authConfig(); await fetch(`${url}/auth/v1/logout`, { method: "POST", headers: { apikey: anonKey, Authorization: `Bearer ${session.access_token}` } }); } catch { /* best effort */ } }
export async function adminFetch(path: string, init: RequestInit = {}) {
  let token: string;
  try { token = await getAdminAccessToken(); } catch (error) { clearAdminSession(); if (window.location.pathname !== "/admin/login") window.location.assign("/admin/login"); throw error; }
  const headers = new Headers(init.headers); headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (response.status === 401) { clearAdminSession(); window.location.assign("/admin/login"); }
  return response;
}
export { API_URL };