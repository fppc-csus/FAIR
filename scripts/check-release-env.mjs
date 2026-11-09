import { pathToFileURL } from 'node:url';

// Read-only preflight: no network calls, no credential values in diagnostics.
export function checkReleaseEnv(env, target) {
  const errors = [];
  const warnings = [];
  const has = name => typeof env[name] === 'string' && env[name].trim() !== '';
  const requireName = name => { if (!has(name)) errors.push(`${name}: required`); };
  function url(name, protocols) {
    requireName(name);
    if (!has(name)) return;
    try {
      const parsed = new URL(env[name]);
      if (!protocols.includes(parsed.protocol) || !parsed.hostname || parsed.username && protocols.includes('https:')) throw Error();
      if (['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsed.hostname)) throw Error();
    } catch { errors.push(`${name}: invalid production URL`); }
  }
  if (target === 'server') {
    if (env.NODE_ENV !== 'production') errors.push('NODE_ENV: must be production');
    url('DATABASE_URL', ['postgres:', 'postgresql:']);
    url('DIRECT_URL', ['postgres:', 'postgresql:']);
    url('SUPABASE_URL', ['https:']);
    url('CLIENT_ORIGIN', ['https:']);
    if (!has('SUPABASE_SECRET_KEY') && !has('SUPABASE_SERVICE_ROLE_KEY')) errors.push('SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY: required');
    requireName('APIFY_TOKEN');
    if (!['true', 'false'].includes(env.CRON_ENABLED)) errors.push('CRON_ENABLED: explicitly set true or false');
    if (has('CRON_TIMEZONE')) {
      try { new Intl.DateTimeFormat('en', { timeZone: env.CRON_TIMEZONE }); }
      catch { errors.push('CRON_TIMEZONE: invalid time zone'); }
    }
    for (const name of ['PORT', 'APIFY_LOOKBACK_DAYS', 'LEGISTAR_LOOKBACK_DAYS']) {
      if (has(name) && (!/^\d+$/.test(env[name]) || Number(env[name]) < 1 || !Number.isSafeInteger(Number(env[name])) || name === 'PORT' && Number(env[name]) > 65535)) errors.push(`${name}: invalid positive integer`);
    }
    if (!has('FAIR_ADMIN_EMAIL')) warnings.push('FAIR_ADMIN_EMAIL: needed only to bootstrap the first owner; verify initialized memberships');
    if (!has('APIFY_ACTOR_ID')) warnings.push('APIFY_ACTOR_ID: verify every Apify source has its own actor ID');
    if (!has('GEMINI_API_KEY') && !has('LLM_API_KEY')) warnings.push('Gemini credentials absent: optional matching assistance unavailable');
  } else if (target === 'client') {
    url('VITE_API_URL', ['https:']);
    url('VITE_SUPABASE_URL', ['https:']);
    requireName('VITE_SUPABASE_ANON_KEY');
    const allowed = new Set(['VITE_API_URL', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'VITE_SUPABASE_PUBLISHABLE_KEY']);
    for (const [name, value] of Object.entries(env)) {
      if (!name.startsWith('VITE_') || !value) continue;
      if (!allowed.has(name)) errors.push(`${name}: unapproved browser variable`);
      if (/sb_secret_|apify_api_|-----BEGIN .*PRIVATE KEY|postgres(?:ql)?:\/\//i.test(value)) errors.push(`${name}: server credential pattern in browser variable`);
      // A legacy Supabase service-role JWT must never be used as a public key.
      for (const token of value.matchAll(/eyJ[\w-]*\.([\w-]+)\.[\w-]+/g)) {
        try { if (JSON.parse(Buffer.from(token[1], 'base64url').toString()).role === 'service_role') errors.push(`${name}: privileged JWT in browser variable`); } catch { /* not a decodable JWT */ }
      }
    }
    warnings.push('Non-VITE server credentials in Vercel require a separate usage review; this check does not inspect deployed assets');
  } else errors.push('Target must be server or client');
  return { errors, warnings };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = checkReleaseEnv(process.env, process.argv[2]);
  for (const message of result.errors) console.error(`ERROR ${message}`);
  for (const message of result.warnings) console.warn(`REVIEW ${message}`);
  if (!result.errors.length) console.log('Configuration preflight passed; credentials and account controls still need operational verification.');
  process.exitCode = result.errors.length ? 1 : 0;
}
