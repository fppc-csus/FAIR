import '../src/lib/env.js';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runNightlyLegistarSync } from '../src/jobs/nightlySync.js';

const DEFAULT_BACKFILL_LOOKBACK_DAYS = 365 * 2;

function readOption(argv, name) {
  const index = argv.indexOf(name);

  if (index === -1) {
    return null;
  }

  const value = argv[index + 1]?.trim();

  if (!value || value.startsWith('--')) {
    throw new Error(`The ${name} option requires a value`);
  }

  return value;
}

function validDate(value, name) {
  if (value == null) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || Number.isNaN(parsed.valueOf())
    || parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new Error(`${name} must use YYYY-MM-DD`);
  }
  return value;
}

export function readBackfillArguments(argv = []) {
  const city = readOption(argv, '--city');
  const startDate = validDate(readOption(argv, '--start'), '--start');
  const endDate = validDate(readOption(argv, '--end'), '--end');
  if (startDate && endDate && startDate > endDate) {
    throw new Error('--start must be on or before --end');
  }
  return { city, startDate, endDate };
}

export async function runBackfill({
  city = null,
  startDate = null,
  endDate = null,
  now = new Date(),
  run = runNightlyLegistarSync,
  log = console.log,
} = {}) {
  const startedAt = Date.now();
  const resolvedEndDate = endDate ?? now.toISOString().slice(0, 10);
  const resolvedStartDate = startDate ?? (() => {
    const date = new Date(`${resolvedEndDate}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() - DEFAULT_BACKFILL_LOOKBACK_DAYS);
    return date.toISOString().slice(0, 10);
  })();
  if (resolvedStartDate > resolvedEndDate) {
    throw new Error('--start must be on or before --end');
  }

  const result = await run({
    lookbackDays: undefined,
    startDate: resolvedStartDate,
    endDate: resolvedEndDate,
    city,
    detectExistingAgendaItems: true,
    includeFinalItemCount: true,
  });

  log(
    `[backfill] ${result.failures || result.detectionFailures || result.skippedRun || result.citiesProcessed === 0 ? 'incomplete' : 'complete'} ` +
      `range=${resolvedStartDate}..${resolvedEndDate} cities=${result.citiesProcessed} ` +
      `items_found=${result.itemsFound} inserted=${result.inserted} ` +
      `final_items=${result.finalItemCount ?? 0} ` +
      `items_skipped=${result.skipped} items_rechecked=${(result.cityResults ?? []).reduce((total, cityResult) => total + (cityResult.itemsRechecked ?? 0), 0)} ` +
      `conflicts=${result.conflictsDetected} detection_failures=${result.detectionFailures ?? 0} ` +
      `city_results=${JSON.stringify(result.cityResults ?? [])} ` +
      `elapsed_ms=${Date.now() - startedAt}`,
  );

  if (result.skippedRun) throw new Error('Backfill was skipped because another Legistar run is active');
  if (result.citiesProcessed === 0) throw new Error('Backfill processed no Legistar cities; verify enabled sources and city name');
  if (result.failures > 0) throw new Error(`Backfill failed for ${result.failures} Legistar city or cities`);
  if (result.detectionFailures > 0) throw new Error(`Backfill conflict detection failed for ${result.detectionFailures} agenda item batch or batches`);

  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const options = readBackfillArguments(process.argv.slice(2));

  runBackfill(options).catch((error) => {
    console.error('[backfill] command failed:', error);
    process.exitCode = 1;
  });
}