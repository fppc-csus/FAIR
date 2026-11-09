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

export { downloadPdf };

/** Run the full Apify → PDF → agenda_items ingestion pipeline. */
async function performApifyAgendaScrape({
  lookbackDays = DEFAULT_LOOKBACK_DAYS,
  city = null,
  jobRunId = null,
  prismaClient = prisma,
  scrapeAgendaPDFs,
  parsePdf = parsePdfAgenda,
  detect = detectConflictsForAgendaItems,
  fetchImpl = fetch,
  log = console.log,
} = {}) {
  if (!scrapeAgendaPDFs) {
    assertEnv('APIFY_TOKEN');
    ({ scrapeAgendaPDFs } = await import('../../services/apifyscraper.js'));
  }

  const sourceErrors = [];
  const actorItems = await scrapeAgendaPDFs({
    lookbackDays,
    onSourceError: (source, error) => {
      sourceErrors.push({ cityName: source.cityName, message: error.message });
      log(`[apify] city="${source.cityName}" scrape failed: ${error.message}`);
    },
  });
  if (!Array.isArray(actorItems)) throw new Error('Apify dataset results must be an array');

  const requestedCity = normalizeCityName(city).toLowerCase();
  const byCity = new Map();
  let missingCity = 0;

  for (const item of actorItems) {
    const cityName = normalizeCityName(item?.city_name ?? item?.cityName);
    if (requestedCity && cityName.toLowerCase() !== requestedCity) continue;
    if (!cityName) {
      missingCity += 1;
      log('[apify] skipped actor result with no city_name');
      continue;
    }
    const cityItems = byCity.get(cityName) ?? [];
    cityItems.push(item);
    byCity.set(cityName, cityItems);
  }

  const cities = [];
  for (const [cityName, items] of byCity) {
    try {
      cities.push(await ingestApifyAgendaItems({
        items,
        source: { cityName, apifyActorId: process.env.APIFY_ACTOR_ID ?? null },
        prismaClient,
        jobRunId,
        ...(parsePdf ? { parsePdf } : {}),
        fetchImpl,
        detect,
        log,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`[apify] city="${cityName}" failed: ${message}`);
      cities.push({
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
      });
    }
  }

  const totals = cities.reduce((result, summary) => ({
    citiesProcessed: result.citiesProcessed + 1,
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
    sampledDocuments: [],
  });

  totals.inserted = totals.itemsInserted;
  totals.skipped = missingCity + totals.documentsSkipped + totals.itemsSkipped;
  log(`[apify] complete ${JSON.stringify(totals)}`);
  return { ...totals, cities, sourceErrors };
}

export async function runApifyAgendaScrape(options = {}) {
  const prismaClient = options.prismaClient ?? prisma;
  const outcome = await runSyncJob(
    'apify',
    ({ runId }) => performApifyAgendaScrape({ ...options, jobRunId: runId }),
    {
      prismaClient,
      hasErrors: (result) => result.errors > 0,
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
    skippedRun: true,
    cities: [],
  };
}

function readCityArgument(argv) {
  const index = argv.indexOf('--city');
  return index >= 0 ? argv[index + 1] ?? null : null;
}

export async function runApifyAgendaCli({ argv = process.argv.slice(2), run = runApifyAgendaScrape } = {}) {
  const result = await run({ city: readCityArgument(argv) });
  console.log(JSON.stringify(result, null, 2));
  if (result.errors > 0 || result.skippedRun) process.exitCode = 1;
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runApifyAgendaCli().catch((error) => {
    console.error('[apify] command failed:', error);
    process.exitCode = 1;
  });
}
