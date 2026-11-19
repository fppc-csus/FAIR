import { pathToFileURL } from 'node:url';

const publicPaths = ['/api/politicians?limit=100', '/api/search?q=city%20council'];

export function loadTestConfig(env = process.env) {
  if (env.FAIR_LOAD_TEST_TARGET !== 'non-production') {
    throw new Error('Set FAIR_LOAD_TEST_TARGET=non-production only after verifying the target is not production.');
  }

  let baseUrl;
  try {
    baseUrl = new URL(env.FAIR_LOAD_TEST_BASE_URL);
  } catch {
    throw new Error('FAIR_LOAD_TEST_BASE_URL must be an absolute URL.');
  }
  if (!['http:', 'https:'].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password) {
    throw new Error('FAIR_LOAD_TEST_BASE_URL must use HTTP(S) and contain no credentials.');
  }
  if (baseUrl.pathname !== '/' || baseUrl.search || baseUrl.hash) {
    throw new Error('FAIR_LOAD_TEST_BASE_URL must contain only the server origin.');
  }

  const durationSeconds = Number(env.FAIR_LOAD_TEST_DURATION_SECONDS ?? 30);
  const workers = Number(env.FAIR_LOAD_TEST_WORKERS ?? 3);
  if (!Number.isInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > 60) {
    throw new Error('FAIR_LOAD_TEST_DURATION_SECONDS must be an integer from 1 to 60.');
  }
  if (!Number.isInteger(workers) || workers < 1 || workers > 5) {
    throw new Error('FAIR_LOAD_TEST_WORKERS must be an integer from 1 to 5.');
  }

  const triggerSync = env.FAIR_LOAD_TEST_SYNC === 'true';
  if (triggerSync && !env.FAIR_LOAD_TEST_ADMIN_TOKEN) {
    throw new Error('FAIR_LOAD_TEST_ADMIN_TOKEN is required when FAIR_LOAD_TEST_SYNC=true.');
  }

  return {
    baseUrl: baseUrl.origin,
    durationMs: durationSeconds * 1000,
    workers,
    triggerSync,
    adminToken: triggerSync ? env.FAIR_LOAD_TEST_ADMIN_TOKEN : undefined,
  };
}

export async function runLoadTest(config, {
  fetchImpl = fetch,
  pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
} = {}) {
  const startedAt = Date.now();
  const counts = new Map();
  const failures = [];
  let nextPath = 0;
  const record = (path, status) => {
    const key = `${path} ${status}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (status < 200 || status >= 300) failures.push({ path, status });
  };

  const check = async (path, options = {}) => {
    const response = await fetchImpl(new URL(path, config.baseUrl), {
      ...options,
      redirect: 'error',
      signal: AbortSignal.timeout(path.includes('/sync/') ? 120_000 : 10_000),
    });
    record(path, response.status);
  };

  const deadline = startedAt + config.durationMs;
  const workers = Array.from({ length: config.workers }, async () => {
    while (Date.now() < deadline) {
      const path = publicPaths[nextPath++ % publicPaths.length];
      await check(path);
      if (Date.now() < deadline) await pause(1000);
    }
  });

  const syncPath = '/api/admin/sync/run-nightly-sync';
  const sync = config.triggerSync
    ? check(syncPath, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.adminToken}` },
    })
    : Promise.resolve();

  await Promise.all([...workers, sync]);
  await check('/health/ready');

  return {
    durationMs: Date.now() - startedAt,
    requests: Object.fromEntries(counts),
    failures,
    ready: !failures.some(({ path }) => path === '/health/ready'),
  };
}

async function main() {
  const config = loadTestConfig();
  const result = await runLoadTest(config);
  console.log(JSON.stringify(result, null, 2));
  if (result.failures.length > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Security load test failed: ${error.message}`);
    process.exitCode = 1;
  });
}
