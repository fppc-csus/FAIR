/**
 * Allowed browser origins for CORS. CLIENT_ORIGIN may list several origins
 * separated by commas (e.g. the Cloudflare custom domain and the
 * *.amplifyapp.com default domain during a cutover).
 */
export function parseClientOrigins(value) {
  return String(value ?? '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

export function getClientOrigin({
  clientOrigin = process.env.CLIENT_ORIGIN,
  nodeEnv = process.env.NODE_ENV,
} = {}) {
  const origins = parseClientOrigins(clientOrigin);
  if (origins.length === 0) return nodeEnv === 'production' ? false : 'http://localhost:5173';
  return origins.length === 1 ? origins[0] : origins;
}

/** The canonical frontend URL (first configured origin), used in emailed links. */
export function primaryClientOrigin(clientOrigin = process.env.CLIENT_ORIGIN) {
  return parseClientOrigins(clientOrigin)[0] ?? null;
}
