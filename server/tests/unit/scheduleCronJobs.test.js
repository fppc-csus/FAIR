import { beforeEach, describe, expect, it, vi } from 'vitest';

const { schedule } = vi.hoisted(() => ({ schedule: vi.fn() }));
vi.mock('node-cron', () => ({ default: { schedule } }));
vi.mock('../../src/jobs/runApifyAgendaScrape.js', () => ({
  runApifyAgendaScrape: vi.fn(),
}));
vi.mock('../../src/jobs/nightlySync.js', () => ({
  runNightlyLegistarSync: vi.fn(),
}));

import { runApifyAgendaScrape } from '../../src/jobs/runApifyAgendaScrape.js';
import { scheduleCronJobs } from '../../src/jobs/scheduleCronJobs.js';

describe('scheduled Apify ingestion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('CRON_ENABLED', 'true');
    vi.stubEnv('APIFY_LOOKBACK_DAYS', '21');
  });

  it('sends cron executions through the same Apify agenda job as the CLI', async () => {
    runApifyAgendaScrape.mockResolvedValue({
      pdfsFetched: 1,
      inserted: 1,
      skipped: 0,
    });
    scheduleCronJobs();
    const apifyCallback = schedule.mock.calls.find(([expression]) => expression === '10 3 * * 1')?.[1];

    expect(apifyCallback).toBeTypeOf('function');
    await apifyCallback();

    expect(runApifyAgendaScrape).toHaveBeenCalledWith({ lookbackDays: 21 });
  });
});
