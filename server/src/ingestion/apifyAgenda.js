import { parsePdfAgenda } from './pdfParser.js';
import { prisma } from '../lib/prisma.js';

const PDF_DOWNLOAD_TIMEOUT_MS = 30_000;
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const DOCUMENT_URL_PATTERN = /^https?:\/\/\S+$/i;

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

async function upsertAgendaRows(prismaClient, rows, source, sourceUrl, documentTitle) {
  let inserted = 0;
  let skipped = 0;

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
    const existing = await prismaClient.agendaItem.findUnique({ where, select: { id: true } });
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

    await prismaClient.agendaItem.upsert({ where, create: data, update: data });
    if (existing) skipped += 1;
    else inserted += 1;
  }

  return { inserted, skipped };
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

export async function ingestApifyAgendaItems({
  items,
  source: sourceInput,
  syncLogId = null,
  prismaClient = prisma,
  parsePdf = parsePdfAgenda,
  fetchImpl = fetch,
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
      data: { dataSourceId: source.id, sourceType: 'apify', status: 'running' },
    });

  const counts = {
    documentsFound: items.length,
    pdfsFetched: 0,
    documentsSkipped: 0,
    itemsInserted: 0,
    itemsSkipped: 0,
  };
  const errors = [];

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
        upsertAgendaRows(transactionClient, validRows, source, item.pdfUrl, item.title)
      ));
      counts.itemsInserted += result.inserted;
      counts.itemsSkipped += result.skipped;
      if (result.inserted === 0 && result.skipped === 0) {
        throw new Error('PDF contained no valid agenda items');
      }
    } catch (error) {
      counts.documentsSkipped += 1;
      const detail = {
        pdfUrl: item?.pdfUrl ?? null,
        message: errorMessage(error),
      };
      errors.push(detail);
      log(`[apify] city="${source.cityName}" skipped pdf="${detail.pdfUrl ?? 'unknown'}": ${detail.message}`);
    }
  }

  await updateRunRecords(prismaClient, source, run.id, counts, errors);
  return {
    cityName: source.cityName,
    ...counts,
    errors,
  };
}
