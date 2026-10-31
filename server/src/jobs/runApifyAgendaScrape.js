import '../lib/env.js';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { ingestApifyAgendaItems, downloadPdf } from '../ingestion/apifyAgenda.js';
import { parsePdfAgenda } from '../ingestion/pdfParser.js';
import { upsertAgendaItems } from '../ingestion/upsertAgendaItems.js';
import { prisma } from '../lib/prisma.js';
import { detectConflictsForAgendaItems } from '../detection/detectConflicts.js';
import { detectAgendaConflictsSafely } from '../detection/detectAgendaConflictsSafely.js';

const DEFAULT_LOOKBACK_DAYS = 14;

function assertEnv(name) {
  if (!process.env[name]) throw new Error(`Missing ${name} in server/.env`);
}

function normalizeCityName(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeMeetingDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date;
}

function normalizeActorItem(item) {
  return {
    pdfUrl: normalizeString(item?.pdf_url ?? item?.pdfUrl ?? item?.url),
    cityName: normalizeString(item?.city_name ?? item?.cityName),
    meetingDate: normalizeMeetingDate(item?.meeting_date ?? item?.meetingDate),
  };
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export async function downloadPdf(
  pdfUrl,
  { fetchImpl = fetch, timeoutMs = PDF_DOWNLOAD_TIMEOUT_MS, maxBytes = MAX_PDF_BYTES } = {},
) {
  const response = await fetchImpl(pdfUrl, {
    headers: { Accept: 'application/pdf' },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`PDF download failed (${response.status} ${response.statusText})`);
  }

  const contentLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error(`PDF exceeds ${Math.floor(maxBytes / 1024 / 1024)} MB limit`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > maxBytes) {
    throw new Error(`PDF exceeds ${Math.floor(maxBytes / 1024 / 1024)} MB limit`);
  }
  return buffer;
}

async function findOrCreateDataSource(prismaClient, cityName) {
  const existing = await prismaClient.dataSource.findFirst({
    where: { cityName, sourceType: 'apify' },
  });
  if (existing) return existing;

  return prismaClient.dataSource.create({
    data: {
      cityName,
      sourceType: 'apify',
      apifyActorId: process.env.APIFY_ACTOR_ID ?? null,
    },
  });
}

async function processCityItems({ cityName, items, prismaClient, parsePdf, fetchImpl, detect, log }) {
  const source = await findOrCreateDataSource(prismaClient, cityName);
  const syncLog = await prismaClient.syncLog.create({
    data: {
      dataSourceId: source.id,
      sourceType: 'apify',
      status: 'running',
      startedAt: new Date(),
      itemsFound: items.length,
    },
  });
  let inserted = 0;
  let skipped = 0;
  let conflictCandidates = 0;
  let conflictsDetected = 0;
  let conflictsSkipped = 0;
  const detectionErrors = [];
  const errors = [];

  for (const item of items) {
    try {
      if (!item.pdfUrl) throw new Error('Actor item is missing pdf_url');
      if (!item.meetingDate) throw new Error('Actor item has an invalid or missing meeting_date');

      const buffer = await downloadPdf(item.pdfUrl, { fetchImpl });
      const rows = (await parsePdf(buffer, source.id, item.meetingDate)).map((row) => ({
        ...row,
        sourceUrl: item.pdfUrl,
      }));
      if (rows.length === 0) throw new Error('PDF contained no parseable agenda text');

      const result = await upsertAgendaItems(
        prismaClient,
        rows.map((row) => ({ ...row, cityName })),
        (row) => ({
          cityId_meetingDate_itemNumber: {
            cityId: row.cityId,
            meetingDate: row.meetingDate,
            itemNumber: row.itemNumber,
          },
        }),
      );
      inserted += result.inserted;
      skipped += result.skipped;
      if (result.changedIds.length > 0) {
        const detection = await detectAgendaConflictsSafely(
          result.changedIds,
          detect,
          { prisma: prismaClient },
        );
        conflictCandidates += detection.conflictCandidates;
        conflictsDetected += detection.conflictsDetected;
        conflictsSkipped += detection.conflictsSkipped;
        detectionErrors.push(...detection.detectionErrors);
      }
    } catch (error) {
      skipped += 1;
      const detail = { pdfUrl: item.pdfUrl || null, message: errorMessage(error) };
      errors.push(detail);
      log(`[cron][apify] city="${cityName}" skipped pdf="${item.pdfUrl || 'unknown'}": ${detail.message}`);
    }
  }

  const completedAt = new Date();
  const lastError = errors.length > 0 ? errors.map((entry) => entry.message).join('; ') : null;
  await prismaClient.$transaction([
    prismaClient.syncLog.update({
      where: { id: syncLog.id },
      data: {
        status: errors.length === items.length && items.length > 0 ? 'failed' : 'success',
        completedAt,
        itemsFound: items.length,
        itemsInserted: inserted,
        itemsSkipped: skipped,
        conflictCandidates,
        conflictsDetected,
        conflictsSkipped,
        detectionErrors,
        errors: errors.length > 0 ? errors : null,
      },
    }),
    prismaClient.dataSource.update({
      where: { id: source.id },
      data: { lastSyncedAt: completedAt, lastError },
    }),
  ]);

  return {
    cityName,
    pdfsFetched: items.length,
    inserted,
    skipped,
    conflictCandidates,
    conflictsDetected,
    conflictsSkipped,
    detectionErrors,
    errors,
  };
}

/** Run the full Apify → PDF → agenda_items ingestion pipeline. */
export async function runApifyAgendaScrape({
  lookbackDays = DEFAULT_LOOKBACK_DAYS,
  city = null,
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

  const actorItems = await scrapeAgendaPDFs({ lookbackDays });
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
    cities.push(await ingestApifyAgendaItems({
      items,
      source: { cityName, apifyActorId: process.env.APIFY_ACTOR_ID ?? null },
      prismaClient,
      ...(parsePdf ? { parsePdf } : {}),
      fetchImpl,
      log,
    }));
  }

  const totals = cities.reduce((result, summary) => ({
    citiesProcessed: result.citiesProcessed + 1,
    documentsFound: result.documentsFound + summary.documentsFound,
    pdfsFetched: result.pdfsFetched + summary.pdfsFetched,
    documentsSkipped: result.documentsSkipped + summary.documentsSkipped,
    itemsInserted: result.itemsInserted + summary.itemsInserted,
    itemsSkipped: result.itemsSkipped + summary.itemsSkipped,
    inserted: result.inserted + summary.inserted,
    skipped: result.skipped + summary.skipped,
    conflictCandidates: result.conflictCandidates + summary.conflictCandidates,
    conflictsDetected: result.conflictsDetected + summary.conflictsDetected,
    conflictsSkipped: result.conflictsSkipped + summary.conflictsSkipped,
    detectionFailures: result.detectionFailures + summary.detectionErrors.length,
    detectionErrors: result.detectionErrors.concat(summary.detectionErrors),
    errors: result.errors + summary.errors.length,
  }), {
    citiesProcessed: 0,
    documentsFound: 0,
    pdfsFetched: 0,
    inserted: 0,
    skipped: missingCity.length,
    conflictCandidates: 0,
    conflictsDetected: 0,
    conflictsSkipped: 0,
    detectionFailures: 0,
    detectionErrors: [],
    errors: missingCity.length,
  });

  totals.inserted = totals.itemsInserted;
  totals.skipped = totals.documentsSkipped + totals.itemsSkipped;
  log(`[apify] complete ${JSON.stringify(totals)}`);
  return { ...totals, cities };
}

function readCityArgument(argv) {
  const index = argv.indexOf('--city');
  return index >= 0 ? argv[index + 1] ?? null : null;
}

export async function runApifyAgendaCli({ argv = process.argv.slice(2), run = runApifyAgendaScrape } = {}) {
  const result = await run({ city: readCityArgument(argv) });
  console.log(JSON.stringify(result, null, 2));
  if (result.errors > 0) process.exitCode = 1;
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runApifyAgendaCli().catch((error) => {
    console.error('[apify] command failed:', error);
    process.exitCode = 1;
  });
}
