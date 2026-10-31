import '../src/lib/env.js';
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

  const result = await run({
    lookbackDays: startDate ? undefined : DEFAULT_BACKFILL_LOOKBACK_DAYS,
    startDate,
    endDate: endDate ?? now.toISOString().slice(0, 10),
    city,
  });

  log(
    `[backfill] complete cities=${result.citiesProcessed} ` +
      `items_found=${result.itemsFound} inserted=${result.inserted} ` +
      `conflicts=${result.conflictsDetected} ` +
      `elapsed_ms=${Date.now() - startedAt}`,
  );

  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = readBackfillArguments(process.argv.slice(2));

  runBackfill(options).catch((error) => {
    console.error('[backfill] command failed:', error);
    process.exitCode = 1;
  });
}