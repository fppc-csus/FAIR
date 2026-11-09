import { describe, expect, it, vi } from 'vitest';
import { loadTestConfig, runLoadTest } from '../../scripts/security-load-test.mjs';

describe('security load-test safeguards', () => {
  it('requires an explicit non-production target acknowledgement', () => {
    expect(() => loadTestConfig({
      FAIR_LOAD_TEST_BASE_URL: 'https://fair.example',
    })).toThrow(/non-production/);
  });

  it('rejects invalid URLs, unsafe durations, and sync without an admin token', () => {
    expect(() => loadTestConfig({
      FAIR_LOAD_TEST_TARGET: 'non-production',
      FAIR_LOAD_TEST_BASE_URL: 'file:///tmp/test',
    })).toThrow(/HTTP\(S\)/);
    expect(() => loadTestConfig({
      FAIR_LOAD_TEST_TARGET: 'non-production',
      FAIR_LOAD_TEST_BASE_URL: 'https://staging.example',
      FAIR_LOAD_TEST_DURATION_SECONDS: '61',
    })).toThrow(/from 1 to 60/);
    expect(() => loadTestConfig({
      FAIR_LOAD_TEST_TARGET: 'non-production',
      FAIR_LOAD_TEST_BASE_URL: 'https://staging.example',
      FAIR_LOAD_TEST_SYNC: 'true',
    })).toThrow(/ADMIN_TOKEN/);
  });

  it('loads public list/search endpoints and optionally triggers sync once', async () => {
    const config = loadTestConfig({
      FAIR_LOAD_TEST_TARGET: 'non-production',
      FAIR_LOAD_TEST_BASE_URL: 'https://staging.example',
      FAIR_LOAD_TEST_DURATION_SECONDS: '1',
      FAIR_LOAD_TEST_WORKERS: '1',
      FAIR_LOAD_TEST_SYNC: 'true',
      FAIR_LOAD_TEST_ADMIN_TOKEN: 'test-token',
    });
    const fetchImpl = vi.fn(async (url, options) => ({
      status: String(url).includes('/sync/')
        ? (options.headers.authorization === 'Bearer test-token' ? 200 : 401)
        : 200,
    }));

    const result = await runLoadTest(config, {
      fetchImpl,
      pause: (milliseconds) => new Promise((resolve) => setTimeout(resolve, Math.min(milliseconds, 25))),
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      new URL('/api/admin/sync/run-nightly-sync', config.baseUrl),
      expect.objectContaining({
        method: 'POST',
        headers: { authorization: 'Bearer test-token' },
        redirect: 'error',
      }),
    );
    expect(result.failures).toEqual([]);
    expect(result.requests['/api/admin/sync/run-nightly-sync 200']).toBe(1);
    expect(result.requests['/health/ready 200']).toBe(1);
  });
});
