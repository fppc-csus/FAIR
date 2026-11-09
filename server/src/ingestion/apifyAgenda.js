import { parsePdfAgenda } from './pdfParser.js';
import { prisma } from '../lib/prisma.js';
import { upsertAgendaItems } from './upsertAgendaItems.js';
import { detectConflictsForAgendaItems } from '../detection/detectConflicts.js';
import { detectAgendaConflictsSafely } from '../detection/detectAgendaConflictsSafely.js';
import { runSyncJob } from '../jobs/syncJobRun.js';

const PDF_DOWNLOAD_TIMEOUT_MS = 30_000;
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const DOCUMENT_URL_PATTERN = /^https?:\/\/\S+$/i;
export const QUALITY_SAMPLE_LIMIT = 5;

const DOCUMENT_QUALITY = {
  HAS_TEXT: 'has-text',
  IMAGE_ONLY: 'image-only',
  UNSUPPORTED: 'unsupported',
  DOWNLOAD_FAILED: 'download-failed',
  OVERSIZED: 'oversized',
  PARSE_ERROR: 'parse-error',
};

function classifyError(error) {
  const message = errorMessage(error);
  if (/not a PDF/.test(message)) return DOCUMENT_QUALITY.UNSUPPORTED;
  if (/exceeds.*MB limit/.test(message)) return DOCUMENT_QUALITY.OVERSIZED;
  if (/Download|timeout|AbortSignal|network|fetch/i.test(message)) return DOCUMENT_QUALITY.DOWNLOAD_FAILED;
  if (/no (extractable |parseable )?(agenda )?text|no valid agenda items/.test(message)) return DOCUMENT_QUALITY.IMAGE_ONLY;
  return DOCUMENT_QUALITY.PARSE_ERROR;
}

const QUALITY_COUNT_KEYS = {
  [DOCUMENT_QUALITY.HAS_TEXT]: 'documentsWithText',
  [DOCUMENT_QUALITY.IMAGE_ONLY]: 'documentsImageOnly',
  [DOCUMENT_QUALITY.UNSUPPORTED]: 'documentsUnsupported',
  [DOCUMENT_QUALITY.DOWNLOAD_FAILED]: 'documentsDownloadFailed',
  [DOCUMENT_QUALITY.OVERSIZED]: 'documentsOversized',
  [DOCUMENT_QUALITY.PARSE_ERROR]: 'documentsParseError',
};

function qualityCountKey(quality) {
  return QUALITY_COUNT_KEYS[quality] ?? 'documentsParseError';
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeMeetingDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date;
}

function normalizeActorItem(item, cityName) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw new Error('Actor result must be an object');
  }

  const pdfUrl = normalizeString(item.pdf_url ?? item.pdfUrl ?? item.agenda_url ?? item.url);
  if (!pdfUrl) throw new Error('Actor item is missing pdf_url');

  let url;
  try {
    url = new URL(pdfUrl);
  } catch {
    throw new Error('Actor item has an invalid PDF URL');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Actor item PDF URL must use HTTP or HTTPS without credentials');
  }

  const meetingDate = normalizeMeetingDate(item.meeting_date ?? item.meetingDate);
  if (!meetingDate) throw new Error('Actor item has an invalid or missing meeting_date');

  return {
    pdfUrl: url.href,
    cityName: normalizeString(item.city_name ?? item.cityName) || cityName,
    meetingDate,
    title: normalizeString(item.document_title ?? item.title ?? item.agenda_title ?? item.agendaTitle ?? item.name),
  };
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
  if (!response.body?.getReader) throw new Error('PDF response did not include a readable body');

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new Error(`PDF exceeds ${Math.floor(maxBytes / 1024 / 1024)} MB limit`);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }

  const buffer = Buffer.concat(chunks, totalBytes);
  if (!buffer.subarray(0, 1024).includes(Buffer.from('%PDF-'))) {
    throw new Error('Downloaded document is not a PDF');
  }
  return buffer;
}

async function findOrCreateDataSource(prismaClient, cityName, actorId) {
  const existing = await prismaClient.dataSource.findFirst({
    where: { cityName, sourceType: 'apify' },
  });
  if (existing) return existing;

  return prismaClient.dataSource.create({
    data: { cityName, sourceType: 'apify', apifyActorId: actorId ?? null },
  });
}

function hasAgendaText(value) {
  const text = normalizeString(value);
  return Boolean(text) && !DOCUMENT_URL_PATTERN.test(text);
}

async function upsertAgendaRows(prismaClient, rows, source, sourceUrl, documentTitle, includeUnchanged) {
  let inserted = 0;
  let skipped = 0;
  const changedIds = [];

  for (const row of rows) {
    if (!row || !hasAgendaText(row.itemText)) {
      skipped += 1;
      continue;
    }

    const meetingDate = normalizeMeetingDate(row.meetingDate);
    const itemNumber = normalizeString(row.itemNumber);
    if (!meetingDate || !itemNumber) {
      skipped += 1;
      continue;
    }

    const key = {
      cityId: source.id,
      meetingDate,
      itemNumber,
    };
    const where = { cityId_meetingDate_itemNumber: key };
    const data = {
      ...row,
      cityId: source.id,
      cityName: source.cityName,
      title: row.title ?? documentTitle ?? null,
      sourceUrl,
      meetingDate,
      itemNumber,
      itemText: normalizeString(row.itemText),
      sourceType: 'apify',
    };

    const result = await upsertAgendaItems(prismaClient, [data], () => where, { includeUnchanged });
    inserted += result.inserted;
    skipped += result.skipped;
    changedIds.push(...result.changedIds);
  }

  return { inserted, skipped, changedIds };
}

async function updateRunRecords(prismaClient, source, syncLogId, counts, errors) {
  const completedAt = new Date();
  const lastError = errors.length > 0
    ? errors.map((entry) => entry.message).join('; ')
    : null;
  await prismaClient.$transaction([
    prismaClient.syncLog.update({
      where: { id: syncLogId },
      data: {
        status: counts.documentsFound > 0 && counts.documentsSkipped === counts.documentsFound
          ? 'failed'
          : 'success',
        completedAt,
        itemsFound: counts.documentsFound,
        documentsFound: counts.documentsFound,
        pdfsFetched: counts.pdfsFetched,
        documentsSkipped: counts.documentsSkipped,
        itemsInserted: counts.itemsInserted,
        itemsSkipped: counts.itemsSkipped,
        conflictCandidates: counts.conflictCandidates,
        conflictsDetected: counts.conflictsDetected,
        conflictsSkipped: counts.conflictsSkipped,
        detectionErrors: counts.detectionErrors,
        errors: errors.length > 0 ? errors : null,
      },
    }),
    prismaClient.dataSource.update({
      where: { id: source.id },
      data: {
        lastSyncedAt: completedAt,
        lastError,
        lastDocumentsFound: counts.documentsFound,
        lastPdfsFetched: counts.pdfsFetched,
        lastItemsInserted: counts.itemsInserted,
        lastItemsSkipped: counts.itemsSkipped,
        lastSyncErrors: errors.length > 0 ? errors : null,
      },
    }),
  ]);
}

async function performApifyAgendaIngestion({
  items,
  source: sourceInput,
  syncLogId = null,
  jobRunId = null,
  prismaClient = prisma,
  parsePdf = parsePdfAgenda,
  fetchImpl = fetch,
  detect = detectConflictsForAgendaItems,
  detectExistingAgendaItems = false,
  log = console.log,
} = {}) {
  if (!Array.isArray(items)) throw new Error('Apify dataset results must be an array');
  if (!sourceInput?.cityName) throw new Error('An Apify data source city name is required');

  const source = sourceInput.id
    ? sourceInput
    : await findOrCreateDataSource(prismaClient, sourceInput.cityName, sourceInput.apifyActorId);
  const run = syncLogId
    ? { id: syncLogId }
    : await prismaClient.syncLog.create({
      data: {
        jobRunId,
        dataSourceId: source.id,
        sourceType: 'apify',
        status: 'running',
      },
    });
  if (syncLogId && jobRunId) {
    await prismaClient.syncLog.update({
      where: { id: syncLogId },
      data: { jobRunId },
    });
  }

  const counts = {
    documentsFound: items.length,
    pdfsFetched: 0,
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
    detectionErrors: [],
  };
  const errors = [];
  const sampled = [];

  for (const actorItem of items) {
    let item;
    try {
      item = normalizeActorItem(actorItem, source.cityName);
      if (item.cityName.toLowerCase() !== source.cityName.toLowerCase()) {
        throw new Error(`Actor item city "${item.cityName}" does not match source city "${source.cityName}"`);
      }

      const buffer = await downloadPdf(item.pdfUrl, { fetchImpl });
      counts.pdfsFetched += 1;
      const rows = await parsePdf(buffer, source.id, item.meetingDate);
      const validRows = Array.isArray(rows) ? rows : [];
      if (validRows.length === 0 || !validRows.some((row) => hasAgendaText(row?.itemText))) {
        throw new Error('PDF contained no parseable agenda text');
      }

      const result = await prismaClient.$transaction((transactionClient) => (
        upsertAgendaRows(
          transactionClient,
          validRows,
          source,
          item.pdfUrl,
          item.title,
          detectExistingAgendaItems,
        )
      ));
      counts.itemsInserted += result.inserted;
      counts.itemsSkipped += result.skipped;
      counts.documentsWithText += 1;
      if (sampled.length < QUALITY_SAMPLE_LIMIT) {
        sampled.push({ pdfUrl: item.pdfUrl, quality: DOCUMENT_QUALITY.HAS_TEXT, message: null });
      }
      if (result.changedIds.length) {
        const detection = await detectAgendaConflictsSafely(result.changedIds, detect, { prisma: prismaClient });
        counts.conflictCandidates += detection.conflictCandidates;
        counts.conflictsDetected += detection.conflictsDetected;
        counts.conflictsSkipped += detection.conflictsSkipped;
        counts.detectionErrors.push(...detection.detectionErrors);
      }
      if (result.inserted === 0 && result.skipped === 0) {
        throw new Error('PDF contained no valid agenda items');
      }
    } catch (error) {
      counts.documentsSkipped += 1;
      const quality = classifyError(error);
      counts[qualityCountKey(quality)] += 1;
      const detail = {
        pdfUrl: item?.pdfUrl ?? null,
        message: errorMessage(error),
        quality,
      };
      if (sampled.length < QUALITY_SAMPLE_LIMIT) {
        sampled.push({ pdfUrl: detail.pdfUrl, quality, message: detail.message });
      }
      errors.push(detail);
      log(`[apify] city="${source.cityName}" skipped pdf="${detail.pdfUrl ?? 'unknown'}": ${detail.message}`);
    }
  }

  await updateRunRecords(prismaClient, source, run.id, counts, errors);
  return {
    cityName: source.cityName,
    cityId: source.id,
    ...counts,
    sampledDocuments: sampled,
    errors,
  };
}

export async function ingestApifyAgendaItems(options = {}) {
  const {
    items,
    source: sourceInput,
    prismaClient = prisma,
  } = options;
  if (!Array.isArray(items)) throw new Error('Apify dataset results must be an array');
  if (!sourceInput?.cityName) throw new Error('An Apify data source city name is required');

  const source = sourceInput.id
    ? sourceInput
    : await findOrCreateDataSource(prismaClient, sourceInput.cityName, sourceInput.apifyActorId);
  if (options.skipJobLock) {
    return performApifyAgendaIngestion({
      ...options,
      source,
      prismaClient,
      jobRunId: options.jobRunId ?? null,
    });
  }

  const outcome = await runSyncJob(
    `apify-city:${source.id}`,
    ({ runId }) => performApifyAgendaIngestion({
      ...options,
      source,
      jobRunId: runId,
    }),
    {
      prismaClient,
      hasErrors: (result) => result.errors.length > 0 || result.detectionErrors.length > 0,
    },
  );
  if (!outcome.skipped) return outcome.result;

  return {
    cityName: source.cityName,
    documentsFound: 0,
    pdfsFetched: 0,
    documentsSkipped: 0,
    itemsInserted: 0,
    itemsSkipped: 0,
    conflictCandidates: 0,
    conflictsDetected: 0,
    conflictsSkipped: 0,
    detectionErrors: [],
    errors: [],
    skippedRun: true,
  };
}
