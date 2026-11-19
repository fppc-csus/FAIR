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
      failures: 0,
      detectionFailures: 0,
      cityResults: [],
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
      detectExistingAgendaItems: true,
      includeFinalItemCount: true,
    });
  });

  it('defaults to an explicit inclusive two-year date range', async () => {
    const run = vi.fn().mockResolvedValue({
      citiesProcessed: 1,
      itemsFound: 0,
      inserted: 0,
      conflictsDetected: 0,
      failures: 0,
      detectionFailures: 0,
      cityResults: [],
    });

    await runBackfill({
      run,
      log: vi.fn(),
      now: new Date('2026-10-28T12:00:00Z'),
    });

    expect(run).toHaveBeenCalledWith({
      city: null,
      startDate: '2024-10-28',
      endDate: '2026-10-28',
      lookbackDays: undefined,
      detectExistingAgendaItems: true,
      includeFinalItemCount: true,
    });
  });

  it.each([
    [{ citiesProcessed: 0, failures: 0, detectionFailures: 0 }, 'processed no Legistar cities'],
    [{ citiesProcessed: 1, failures: 1, detectionFailures: 0 }, 'failed for 1 Legistar city'],
    [{ citiesProcessed: 1, failures: 0, detectionFailures: 1 }, 'conflict detection failed'],
    [{ citiesProcessed: 1, failures: 0, detectionFailures: 0, skippedRun: true }, 'another Legistar run is active'],
  ])('fails acceptance backfills when sync evidence is incomplete', async (result, message) => {
    await expect(runBackfill({ run: vi.fn().mockResolvedValue(result), log: vi.fn() }))
      .rejects.toThrow(message);
  });
});