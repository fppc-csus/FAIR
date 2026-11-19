import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkReleaseEnv } from './check-release-env.mjs';
const server = { NODE_ENV: 'production', DATABASE_URL: 'postgresql://test:test@db.example.test/db', DIRECT_URL: 'postgresql://test:test@db.example.test/db', SUPABASE_URL: 'https://project.example.test', CLIENT_ORIGIN: 'https://app.example.test', SUPABASE_SECRET_KEY: 'test-placeholder', APIFY_TOKEN: 'test-placeholder', CRON_ENABLED: 'false' };
const client = { VITE_API_URL: 'https://api.example.test', VITE_SUPABASE_URL: 'https://project.example.test', VITE_SUPABASE_ANON_KEY: 'public-placeholder' };
test('valid production settings and service-role fallback pass', () => {
  assert.deepEqual(checkReleaseEnv(server, 'server').errors, []);
  const fallback = { ...server, SUPABASE_SECRET_KEY: '', SUPABASE_SERVICE_ROLE_KEY: 'placeholder' };
  assert.deepEqual(checkReleaseEnv(fallback, 'server').errors, []);
  assert.deepEqual(checkReleaseEnv(client, 'client').errors, []);
});
test('missing configuration fails with names only', () => {
  const result = checkReleaseEnv({}, 'server');
  assert.ok(result.errors.some(x => x.includes('DATABASE_URL')));
  assert.ok(result.errors.some(x => x.includes('APIFY_TOKEN')));
});
test('malformed URLs never echo sensitive input', () => {
  const secret = 'private-password-must-not-appear';
  const result = checkReleaseEnv({ ...server, DATABASE_URL: secret }, 'server');
  assert.ok(result.errors.length);
  assert.ok(!JSON.stringify(result).includes(secret));
});
test('production rejects local or insecure endpoints and invalid controls', () => {
  for (const patch of [{CLIENT_ORIGIN:'http://app.example.test'}, {CLIENT_ORIGIN:'https://localhost'}, {NODE_ENV:'development'}, {CRON_ENABLED:'yes'}, {PORT:'70000'}, {CRON_TIMEZONE:'invalid/zone'}]) assert.ok(checkReleaseEnv({...server,...patch}, 'server').errors.length);
});
test('public key variable must not substitute for anon key in current code', () => {
  assert.ok(checkReleaseEnv({ ...client, VITE_SUPABASE_ANON_KEY: '', VITE_SUPABASE_PUBLISHABLE_KEY: 'public' }, 'client').errors.length);
});
test('browser secrets and unexpected VITE names fail', () => {
  for (const patch of [{VITE_DATABASE_URL:'placeholder'}, {VITE_SUPABASE_ANON_KEY:'sb_secret_test-placeholder'}, {VITE_SUPABASE_ANON_KEY:'apify_api_test-placeholder'}]) assert.ok(checkReleaseEnv({...client,...patch}, 'client').errors.length);
  const payload = Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url');
  assert.ok(checkReleaseEnv({...client, VITE_SUPABASE_ANON_KEY:`eyJhbGciOiJIUzI1NiJ9.${payload}.signature`},'client').errors.length);
});
test('invalid target fails closed', () => assert.ok(checkReleaseEnv({}, 'other').errors.length));
