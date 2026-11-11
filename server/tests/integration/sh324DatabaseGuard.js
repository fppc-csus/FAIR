// Check explicit process URLs before importing application modules, which load server/.env.
export function assertLocalTestDatabase(env) {
  if (env.RUN_SH324_DB_TESTS !== 'true') throw new Error('Explicit SH-324 database test opt-in is required.');
  if (!env.DATABASE_URL || !env.DIRECT_URL) throw new Error('Set both DATABASE_URL and DIRECT_URL explicitly.');
  const urls = [env.DATABASE_URL, env.DIRECT_URL].map((value) => new URL(value));
  if (urls[0].href !== urls[1].href || urls.some((url) =>
    !['postgresql:', 'postgres:'].includes(url.protocol)
    || url.hostname !== '127.0.0.1' || url.port !== '5432'
    || url.pathname !== '/fair_sh324_test' || !url.username
  )) throw new Error('SH-324 tests require matching local 127.0.0.1:5432/fair_sh324_test URLs with an explicit user.');
}