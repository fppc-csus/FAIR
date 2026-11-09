import '../lib/env.js';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { ingestApifyAgendaItems, downloadPdf } from '../ingestion/apifyAgenda.js';
import { parsePdfAgenda } from '../ingestion/pdfParser.js';
import { prisma } from '../lib/prisma.js';
import { detectConflictsForAgendaItems } from '../detection/detectConflicts.js';
import { runSyncJob } from './syncJobRun.js';

const DEFAULT_LOOKBACK_DAYS = 14;

function assertEnv(name) {
  if (!process.env[name]) throw new Error(`Missing ${name} in server/.env`);
}

function normalizeCityName(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function validateDateRange(startDate, endDate) {
  if ((startDate && !endDate) || (!startDate && endDate)) {
    throw new Error('--start and --end must be provided together');
  }
  for (const [name, value] of [['--start', startDate], ['--end', endDate]]) {
    if (!value) continue;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)
      || Number.isNaN(parsed.valueOf())
      || parsed.toISOString().slice(0, 10) !== value) {
      throw new Error(`${name} must use YYYY-MM-DD`);
    }
  }
  if (startDate && endDate && startDate > endDate) {
    throw new Error('--start must be on or before --end');
  }
}

async function countAgendaItemsForCity(prismaClient, cityId, startDate, endDate) {
  if (!cityId || typeof prismaClient?.agendaItem?.count !== 'function') {
    throw new Error('Cannot report final Apify item count for this source');
  }
  const exclusiveEndDate = new Date(`${endDate}T00:00:00.000Z`);
  exclusiveEndDate.setUTCDate(exclusiveEndDate.getUTCDate() + 1);
  return prismaClient.agendaItem.count({
    where: {
      cityId,
      meetingDate: {
        gte: new Date(`${startDate}T00:00:00.000Z`),
        lt: exclusiveEndDate,
      },
    },
  });
}

export { downloadPdf };

/** Run the full Apify → PDF → agenda_items ingestion pipeline. */
async function performApifyAgendaScrape({
  lookbackDays = DEFAULT_LOOKBACK_DAYS,
  startDate,
  endDate,
  city = null,
  jobRunId = null,
  prismaClient = prisma,
  scrapeAgendaPDFs,
  parsePdf = parsePdfAgenda,
  detect = detectConflictsForAgendaItems,
  fetchImpl = fetch,
  log = console.log,
} = {}) {
  validateDateRange(startDate, endDate);
  if (!scrapeAgendaPDFs) {
    assertEnv('APIFY_TOKEN');
    ({ scrapeAgendaPDFs } = await import('../../services/apifyscraper.js'));
  }

  const sourceErrors = [];
  const completedSourceCities = new Set();
  const scrapeOptions = {
    lookbackDays,
    onSourceComplete: (source) => completedSourceCities.add(normalizeCityName(source.cityName)),
    onSourceError: (source, error) => {
      sourceErrors.push({ cityName: source.cityName, message: error.message });
      log(`[apify] city="${source.cityName}" scrape failed: ${error.message}`);
    },
  };
  if (startDate) Object.assign(scrapeOptions, { startDate, endDate });
  if (city) scrapeOptions.city = city;
  const actorItems = await scrapeAgendaPDFs(scrapeOptions);
  if (!Array.isArray(actorItems)) throw new Error('Apify dataset results must be an array');

  const requestedCity = normalizeCityName(city).toLowerCase();
  const byCity = new Map();
  let missingCity = 0;
  let documentsOutsideWindow = 0;

  for (const item of actorItems) {
    const cityName = normalizeCityName(item?.city_name ?? item?.cityName);
    if (requestedCity && cityName.toLowerCase() !== requestedCity) continue;
    if (startDate && endDate) {
      const meetingDate = typeof item?.meeting_date === 'string'
        ? item.meeting_date.slice(0, 10)
        : '';
      if (meetingDate < startDate || meetingDate > endDate) {
        documentsOutsideWindow += 1;
        continue;
      }
    }
    if (!cityName) {
      missingCity += 1;
      log('[apify] skipped actor result with no city_name');
      continue;
    }
    const cityItems = byCity.get(cityName) ?? [];
    cityItems.push(item);
    byCity.set(cityName, cityItems);
  }
  if (startDate) {
    for (const sourceError of sourceErrors) {
      try {
        const source = await prismaClient.dataSource.findFirst({
          where: { cityName: sourceError.cityName, sourceType: 'apify' },
          select: { id: true },
        });
        if (!source?.id) throw new Error('Configured Apify source was not found');
        sourceError.finalItemCount = await countAgendaItemsForCity(
          prismaClient,
          source.id,
          startDate,
          endDate,
        );
      } catch (error) {
        sourceError.finalItemCountError = error instanceof Error ? error.message : String(error);
      }
    }
  }
  for (const cityName of completedSourceCities) {
    if ((!requestedCity || cityName.toLowerCase() === requestedCity) && cityName) {
      if (!byCity.has(cityName)) byCity.set(cityName, []);
    }
  }

  const cities = [];
  for (const [cityName, items] of byCity) {
    let summary;
    try {
      summary = await ingestApifyAgendaItems({
        items,
        source: { cityName, apifyActorId: process.env.APIFY_ACTOR_ID ?? null },
        prismaClient,
        jobRunId,
        ...(parsePdf ? { parsePdf } : {}),
        fetchImpl,
        detect,
        detectExistingAgendaItems: Boolean(startDate),
        log,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`[apify] city="${cityName}" failed: ${message}`);
      summary = {
        cityName,
        documentsFound: items.length,
        pdfsFetched: 0,
        documentsSkipped: items.length,
        documentsWithText: 0,
        documentsImageOnly: 0,
        documentsUnsupported: 0,
        documentsDownloadFailed: 0,
        documentsOversized: 0,
        documentsParseError: 0,
        itemsInserted: 0,
        itemsSkipped: 0,
        conflictCandidates: 0,
        conflictsDetected: 0,
        conflictsSkipped: 0,
        detectionFailures: 0,
        detectionErrors: [],
        errors: [{ message }],
        sampledDocuments: [],
      };
    }
    if (startDate) {
      try {
        const sourceId = summary.cityId ?? (await prismaClient.dataSource.findFirst({
          where: { cityName, sourceType: 'apify' },
          select: { id: true },
        }))?.id;
        summary.finalItemCount = await countAgendaItemsForCity(
          prismaClient,
          sourceId,
          startDate,
          endDate,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        summary.finalItemCountError = message;
        summary.errors.push({ message, type: 'final-item-count' });
        log(`[apify] city="${cityName}" final item count failed: ${message}`);
      }
    }
    cities.push(summary);
  }

  const totals = cities.reduce((result, summary) => ({
    citiesProcessed: result.citiesProcessed + 1,
    ...(startDate ? { finalItemCount: result.finalItemCount + (summary.finalItemCount ?? 0) } : {}),
    documentsFound: result.documentsFound + summary.documentsFound,
    pdfsFetched: result.pdfsFetched + summary.pdfsFetched,
    documentsSkipped: result.documentsSkipped + summary.documentsSkipped,
    documentsWithText: result.documentsWithText + summary.documentsWithText,
    documentsImageOnly: result.documentsImageOnly + summary.documentsImageOnly,
    documentsUnsupported: result.documentsUnsupported + summary.documentsUnsupported,
    documentsDownloadFailed: result.documentsDownloadFailed + summary.documentsDownloadFailed,
    documentsOversized: result.documentsOversized + summary.documentsOversized,
    documentsParseError: result.documentsParseError + summary.documentsParseError,
    itemsInserted: result.itemsInserted + summary.itemsInserted,
    itemsSkipped: result.itemsSkipped + summary.itemsSkipped,
    inserted: result.inserted + summary.itemsInserted,
    skipped: result.skipped + summary.itemsSkipped + summary.documentsSkipped,
    conflictCandidates: result.conflictCandidates + summary.conflictCandidates,
    conflictsDetected: result.conflictsDetected + summary.conflictsDetected,
    conflictsSkipped: result.conflictsSkipped + summary.conflictsSkipped,
    detectionFailures: result.detectionFailures + summary.detectionErrors.length,
    detectionErrors: result.detectionErrors.concat(summary.detectionErrors),
    errors: result.errors + summary.errors.length,
    sampledDocuments: result.sampledDocuments.concat(summary.sampledDocuments ?? []),
  }), {
    citiesProcessed: 0,
    ...(startDate ? { finalItemCount: 0 } : {}),
    documentsFound: 0,
    pdfsFetched: 0,
    inserted: 0,
    skipped: missingCity,
    documentsSkipped: 0,
    documentsWithText: 0,
    documentsImageOnly: 0,
    documentsUnsupported: 0,
    documentsDownloadFailed: 0,
    documentsOversized: 0,
    documentsParseError: 0,
    itemsInserted: 0,
    itemsSkipped: 0,
    conflictCandidates: 0,
    conflictsDetected: 0,
    conflictsSkipped: 0,
    detectionFailures: 0,
    detectionErrors: [],
    errors: missingCity + sourceErrors.length,
    documentsOutsideWindow: 0,
    sampledDocuments: [],
  });

  totals.inserted = totals.itemsInserted;
  if (startDate) {
    totals.finalItemCount += sourceErrors.reduce(
      (count, sourceError) => count + (
        completedSourceCities.has(normalizeCityName(sourceError.cityName))
          ? 0
          : (sourceError.finalItemCount ?? 0)
      ),
      0,
    );
  }
  totals.documentsOutsideWindow = documentsOutsideWindow;
  totals.skipped = missingCity + documentsOutsideWindow + totals.documentsSkipped + totals.itemsSkipped;
  log(`[apify] complete ${JSON.stringify(totals)}`);
  return {
    ...totals,
    cities,
    sourceErrors,
    ...(startDate ? { dateRange: { startDate, endDate } } : {}),
  };
}

export async function runApifyAgendaScrape(options = {}) {
  const prismaClient = options.prismaClient ?? prisma;
  const outcome = await runSyncJob(
    'apify',
    ({ runId }) => performApifyAgendaScrape({ ...options, jobRunId: runId }),
    {
      prismaClient,
      hasErrors: (result) => result.errors > 0 || result.detectionFailures > 0,
    },
  );
  if (!outcome.skipped) return outcome.result;

  return {
    citiesProcessed: 0,
    documentsFound: 0,
    pdfsFetched: 0,
    inserted: 0,
    skipped: 0,
    documentsSkipped: 0,
    itemsInserted: 0,
    itemsSkipped: 0,
    conflictCandidates: 0,
    conflictsDetected: 0,
    conflictsSkipped: 0,
    detectionFailures: 0,
    detectionErrors: [],
    errors: 0,
    documentsOutsideWindow: 0,
    skippedRun: true,
    cities: [],
    ...(options.startDate ? { finalItemCount: 0 } : {}),
    ...(options.startDate ? { dateRange: { startDate: options.startDate, endDate: options.endDate } } : {}),
  };
}

function readOption(argv, name) {
  const index = argv.indexOf(name);
  if (index < 0) return null;
  const value = argv[index + 1]?.trim();
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

function readApifyArguments(argv) {
  const city = readOption(argv, '--city');
  const startDate = readOption(argv, '--start');
  const endDate = readOption(argv, '--end');
  validateDateRange(startDate, endDate);
  const options = {};
  if (city) options.city = city;
  if (startDate) Object.assign(options, { startDate, endDate });
  return options;
}

export async function runApifyAgendaCli({ argv = process.argv.slice(2), run = runApifyAgendaScrape } = {}) {
  const options = readApifyArguments(argv);
  const result = await run(options);
  console.log(JSON.stringify(result, null, 2));
  if (
    result.errors > 0
    || result.detectionFailures > 0
    || result.skippedRun
    || (options.startDate && result.citiesProcessed === 0)
  ) process.exitCode = 1;
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runApifyAgendaCli().catch((error) => {
    console.error('[apify] command failed:', error);
    process.exitCode = 1;
  });
}
