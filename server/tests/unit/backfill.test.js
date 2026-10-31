import { describe, expect, it, vi } from 'vitest';
import { readBackfillArguments, runBackfill } from '../../scripts/backfill.js';

describe('Legistar historical backfill', () => {
  it('parses an optional city and bounded date range', () => {
    expect(readBackfillArguments([
      '--city', 'Sonoma County', '--start', '2024-01-01', '--end', '2025-12-31',
    ])).toEqual({
      city: 'Sonoma County',
      startDate: '2024-01-01',
      endDate: '2025-12-31',
    });
  });

  it('rejects invalid and reversed date ranges', () => {
    expect(() => readBackfillArguments(['--start', '11/01/2025'])).toThrow('YYYY-MM-DD');
    expect(() => readBackfillArguments(['--start', '2025-02-31'])).toThrow('YYYY-MM-DD');
    expect(() => readBackfillArguments(['--start', '2025-12-01', '--end', '2025-11-01']))
      .toThrow('--start must be on or before --end');
  });

  it('runs the shared sync with explicit historical dates', async () => {
    const run = vi.fn().mockResolvedValue({
      citiesProcessed: 1,
      itemsFound: 2,
      inserted: 2,
      conflictsDetected: 0,
    });

    await runBackfill({
      city: 'Sonoma County',
      startDate: '2025-11-01',
      endDate: '2025-11-30',
      now: new Date('2026-10-28T12:00:00Z'),
      run,
      log: vi.fn(),
    });

    expect(run).toHaveBeenCalledWith({
      city: 'Sonoma County',
      startDate: '2025-11-01',
      endDate: '2025-11-30',
      lookbackDays: undefined,
    });
  });

  it('defaults a rolling two-year backfill to today', async () => {
    const run = vi.fn().mockResolvedValue({
      citiesProcessed: 0,
      itemsFound: 0,
      inserted: 0,
      conflictsDetected: 0,
    });

    await runBackfill({
      run,
      log: vi.fn(),
      now: new Date('2026-10-28T12:00:00Z'),
    });

    expect(run).toHaveBeenCalledWith({
      city: null,
      startDate: null,
      endDate: '2026-10-28',
      lookbackDays: 730,
    });
  });
});