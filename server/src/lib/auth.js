/**
 * Admin auth guard for Express.
 *
 * Verifies the Supabase session JWT sent by the client as
 * `Authorization: Bearer <jwt>` using the service-role client
 * (`supabase.auth.getUser(token)`), attaches the user to `req.user`, and
 * otherwise returns a structured 401, 403, or 503 response.
 *
 * FAIR authorizes the single admin account by comparing the verified user's
 * email with the server-only FAIR_ADMIN_EMAIL setting. Missing configuration
 * fails closed as a service configuration error.
 *
 * Invalid sessions receive 401, unauthorized users receive 403, and temporary
 * verification/configuration failures receive 503 without granting access.
 */
import { supabase } from './supabase.js';

const AUTHENTICATION_REQUIRED = { error: 'Admin session is invalid or expired.', code: 'authentication_required' };
const FORBIDDEN = { error: 'This Supabase account is not authorized as the FAIR administrator.', code: 'admin_forbidden' };
const AUTH_UNAVAILABLE = { error: 'Admin authentication could not be verified. Please retry.', code: 'auth_unavailable' };

export function isAuthorizedAdmin(user) {
  const configuredEmail = String(process.env.FAIR_ADMIN_EMAIL ?? '').trim().toLowerCase();
  const userEmail = String(user?.email ?? '').trim().toLowerCase();
  return Boolean(configuredEmail && userEmail && configuredEmail === userEmail);
}

export function extractBearerToken(headerValue) {
  if (typeof headerValue !== 'string') return null;
  const match = headerValue.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const token = match[1].trim();
  return token.length > 0 ? token : null;
}

export async function requireAdmin(req, res, next) {
  const startedAt = performance.now();
  const id = req.requestId ?? 'unknown';
  try {
    const token = extractBearerToken(req.headers?.authorization);
    if (!token) {
      console.warn(`[auth:${id}] missing bearer token ${Math.round(performance.now() - startedAt)}ms`);
      return res.status(401).json(AUTHENTICATION_REQUIRED);
    }

    if (!String(process.env.FAIR_ADMIN_EMAIL ?? '').trim()) {
      console.error(`[auth:${id}] FAIR_ADMIN_EMAIL is not configured`);
      return res.status(503).json(AUTH_UNAVAILABLE);
    }

    console.info(`[auth:${id}] verifying Supabase user`);
    const { data, error } = await supabase.auth.getUser(token);
    if (error && (error.status >= 500 || error.status === 429 || ![400, 401, 403, 422].includes(error.status))) {
      console.warn(`[auth:${id}] Supabase verification temporarily unavailable`);
      return res.status(503).json(AUTH_UNAVAILABLE);
    }
    if (error || !data?.user) {
      console.warn(`[auth:${id}] rejected ${Math.round(performance.now() - startedAt)}ms`);
      return res.status(401).json(AUTHENTICATION_REQUIRED);
    }

    if (!isAuthorizedAdmin(data.user)) {
      console.warn(`[auth:${id}] valid user is not an authorized admin`);
      return res.status(403).json(FORBIDDEN);
    }

    req.user = data.user;
    console.info(`[auth:${id}] verified ${Math.round(performance.now() - startedAt)}ms`);
    return next();
  } catch (err) {
    console.error('[auth] requireAdmin failed:', err?.message ?? err);
    return res.status(503).json(AUTH_UNAVAILABLE);
  }
}

export default requireAdmin;
