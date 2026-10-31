// server/src/routes/admin/sources.js
import express from 'express';
import { syncErrorMessage } from '../../utils/syncErrorMessage.js';
import { ApifyClient } from 'apify-client';
import { prisma } from '../../lib/prisma.js';
import { fetchLegistarAgendaItemsForDataSource } from '../../ingestion/legistar.js';
import { legistarItemKey } from '../../ingestion/legistarIdentity.js';
import { getSyntheticConflictStatus, runSyntheticConflictCheck, removeSyntheticConflictCheck } from '../../detection/syntheticConflictCheck.js';
import { parsePdfAgenda } from '../../ingestion/pdfParser.js';
import { upsertAgendaItems } from '../../ingestion/upsertAgendaItems.js';
import { apifySourceDiagnostic, buildApifyActorInput } from '../../ingestion/apifyActorInput.js';
import { downloadPdf } from '../../jobs/runApifyAgendaScrape.js';
import { detectConflictsForAgendaItems } from '../../detection/detectConflicts.js';
import {
  detectAgendaConflictsSafely,
  getRetryableAgendaItemIds,
} from '../../detection/detectAgendaConflictsSafely.js';

const router = express.Router();

function parseLegistarBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Enter a valid Legistar API base URL.');
  }

  if (url.protocol !== 'https:' || url.hostname !== 'webapi.legistar.com' || !/^\/v1\/[a-z0-9-]+\/?$/i.test(url.pathname)) {
    throw new Error('Use a Legistar API URL such as https://webapi.legistar.com/v1/sacramento.');
  }

  return url.toString().replace(/\/$/, '');
}

async function validateLegistarBaseUrl(value) {
  const baseUrl = parseLegistarBaseUrl(value);
  const response = await fetch(`${baseUrl}/Events?$top=1`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error(`Legistar test request failed (${response.status} ${response.statusText}).`);
  }
  if (!Array.isArray(await response.json())) {
    throw new Error('Legistar returned an unexpected response. Check the API base URL.');
  }
  return baseUrl;
}

async function validateApifyActorId(value) {
  const actorId = typeof value === 'string' ? value.trim() : '';
  if (!actorId) throw new Error('Enter an Apify actor ID.');
  if (!process.env.APIFY_TOKEN) throw new Error('Apify is not configured on the server (APIFY_TOKEN is missing).');

  try {
    const actor = await new ApifyClient({ token: process.env.APIFY_TOKEN }).actor(actorId).get();
    if (!actor) throw new Error('Actor was not found.');
  } catch (error) {
    throw new Error(`Could not access this actor using the configured Apify account: ${error.message}`);
  }
  return actorId;
}

async function validateSourceInput(body) {
  const cityName = typeof body.cityName === 'string' ? body.cityName.trim() : '';
  const sourceType = typeof body.sourceType === 'string'
    ? ['Legistar', 'Apify'].find((type) => type.toLowerCase() === body.sourceType.toLowerCase())
    : null;

  if (!cityName) throw new Error('City name is required.');
  if (!sourceType) throw new Error('Choose Legistar or Apify as the source type.');

  if (sourceType === 'Legistar') {
    const legistarBaseUrl = await validateLegistarBaseUrl(body.legistarBaseUrl);
    return {
      cityName,
      sourceType: 'legistar',
      legistarBaseUrl,
      legistarClientId: legistarBaseUrl.split('/').pop().toLowerCase(),
      apifyActorId: null,
      startUrl: null,
    };
  }

  const startUrl = validateStartUrl(body.startUrl, { required: true });
  return {
    cityName,
    sourceType: 'apify',
    legistarBaseUrl: null,
    apifyActorId: await validateApifyActorId(body.apifyActorId || process.env.APIFY_ACTOR_ID),
    legistarClientId: null,
    startUrl,
  };
}

function validateStartUrl(value, { required = false } = {}) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    if (required) throw new Error('Enter the public HTTPS agenda archive URL required by the Apify actor.');
    return null;
  }
  const url = new URL(normalized);
  if (url.protocol !== 'https:' || url.username || url.password || url.hostname === 'localhost') {
    throw new Error('Use a public HTTPS council agenda URL.');
  }
  return url.href;
}

function sendValidationError(res, error) {
  return res.status(400).json({ error: error.message ?? 'Invalid source configuration.' });
}

async function runLegistarSource(source, options = {}) {
  const { allItems } = await fetchLegistarAgendaItemsForDataSource(source, { lookbackDays: 30, ...options });
  const rows = allItems.flatMap(({ item, meeting, meetingId }) => {
    const itemId = item.EventItemId ?? item.id;
    if (itemId == null) return [];
    const rawMeetingDate = meeting.EventDate ?? meeting.date ?? null;
    const meetingDate = rawMeetingDate && !Number.isNaN(Date.parse(rawMeetingDate))
      ? new Date(rawMeetingDate)
      : null;
    const title = item.EventItemTitle ?? item.EventItemMatterName ?? item.MatterName ?? item.Title ?? item.title ?? 'Untitled agenda item';
    const description = item.EventItemAgendaNote ?? item.AgendaNote ?? null;
    const itemText = [title, description, item.EventItemMinutesNote ?? item.MinutesNote, item.EventItemActionText]
      .filter((value) => value != null && String(value).trim() !== '')
      .join('\n');

    return [{
      sourceType: 'legistar',
      legistarItemId: legistarItemKey(source.legistarBaseUrl, itemId),
      legistarEventId: String(meetingId),
      legistarMatterId: item.EventItemMatterId != null
        ? String(item.EventItemMatterId)
        : item.MatterId != null ? String(item.MatterId) : null,
      cityName: source.cityName,
      cityId: source.id,
      title,
      description,
      itemText: itemText || null,
      sourceUrl: meeting.EventInSiteURL ?? meeting.EventAgendaFile ?? null,
      agendaNumber: item.EventItemAgendaNumber ?? item.AgendaNumber ?? null,
      bodyName: meeting.EventBodyName ?? meeting.bodyName ?? null,
      meetingDate,
      eventItemPassedFlag: item.EventItemPassedFlag == null ? null : Boolean(item.EventItemPassedFlag),
      legistarItemPayload: item,
    }];
  });
  const result = await upsertAgendaItems(
    prisma,
    rows,
    (row) => ({ legistarItemId: row.legistarItemId }),
  );
  const detection = await detectAgendaConflictsSafely(
    result.changedIds,
    detectConflictsForAgendaItems,
    { prisma },
  );
  return {
    itemsFound: rows.length,
    itemsInserted: result.inserted,
    itemsSkipped: result.skipped,
    ...detection,
  };
}

async function runApifySource(source) {
  if (!process.env.APIFY_TOKEN) throw new Error('Apify is not configured on the server (APIFY_TOKEN is missing).');

  const client = new ApifyClient({ token: process.env.APIFY_TOKEN });
  const input = buildApifyActorInput(source);
  console.info('[admin/sources] invoking Apify actor', apifySourceDiagnostic(source));
  const run = await client.actor(source.apifyActorId).call(input, { timeout: 600 });
  if (run.status && run.status !== 'SUCCEEDED') throw new Error(`Actor ${run.status}: ${run.statusMessage || 'Check the Apify run log.'}`);
  const items = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await client.dataset(run.defaultDatasetId).listItems({ limit: 1000, offset });
    items.push(...(page.items ?? []));
    if ((page.items?.length ?? 0) < 1000) break;
  }
  let itemsInserted = 0;
  let itemsSkipped = 0;
  let conflictCandidates = 0;
  let conflictsDetected = 0;
  let conflictsSkipped = 0;
  const detectionErrors = [];
  for (const item of items) {
    const url = item.pdf_url ?? item.pdfUrl ?? item.agenda_url ?? item.url ?? null;
    const date = item.meeting_date ?? item.meetingDate ?? null;
    const meetingDate = date && !Number.isNaN(Date.parse(date)) ? new Date(date) : null;
    if (!url || !meetingDate) {
      itemsSkipped += 1;
      continue;
    }
    const parsedRows = (await parsePdfAgenda(await downloadPdf(url), source.id, meetingDate)).map((row) => ({
      ...row,
      sourceUrl: url,
      cityName: source.cityName,
      title: item.document_title ?? item.title ?? item.agenda_title ?? item.agendaTitle ?? item.name ?? 'Agenda item',
    }));
    const result = await upsertAgendaItems(
      prisma,
      parsedRows,
      (row) => ({
        cityId_meetingDate_itemNumber: {
          cityId: row.cityId,
          meetingDate: row.meetingDate,
          itemNumber: row.itemNumber,
        },
      }),
    );
    itemsInserted += result.inserted;
    itemsSkipped += result.skipped;
    if (result.changedIds.length > 0) {
      const detection = await detectAgendaConflictsSafely(
        result.changedIds,
        detectConflictsForAgendaItems,
        { prisma },
      );
      conflictCandidates += detection.conflictCandidates;
      conflictsDetected += detection.conflictsDetected;
      conflictsSkipped += detection.conflictsSkipped;
      detectionErrors.push(...detection.detectionErrors);
    }
  }
  return {
    itemsFound: items.length,
    itemsInserted,
    itemsSkipped,
    conflictCandidates,
    conflictsDetected,
    conflictsSkipped,
    detectionErrors,
    detectionFailures: detectionErrors.length,
  };
}

async function executeSourceSync(source, syncLogId, options = {}) {
  try {
    const result = source.sourceType.toLowerCase() === 'legistar'
      ? await runLegistarSource(source, options)
      : await runApifySource(source);
    const completedAt = new Date();

    await prisma.$transaction([
      prisma.syncLog.update({
        where: { id: syncLogId },
        data: {
          status: 'success',
          completedAt,
          itemsFound: result.itemsFound,
          itemsInserted: result.itemsInserted,
          itemsSkipped: result.itemsSkipped,
          conflictCandidates: result.conflictCandidates ?? 0,
          conflictsDetected: result.conflictsDetected ?? 0,
          conflictsSkipped: result.conflictsSkipped ?? 0,
          detectionErrors: result.detectionErrors ?? [],
        },
      }),
      prisma.dataSource.update({
        where: { id: source.id },
        data: { lastSyncedAt: completedAt, lastError: null },
      }),
    ]);
  } catch (error) {
    const completedAt = new Date();
    await prisma.$transaction([
      prisma.syncLog.update({
        where: { id: syncLogId },
        data: { status: 'failed', completedAt, errors: { message: error.message } },
      }),
      prisma.dataSource.update({
        where: { id: source.id },
        data: { lastError: error.message },
      }),
    ]);
  }
}

router.get('/', async (req, res) => {
  const startedAt = performance.now();
  const id = req.requestId ?? 'unknown';
  try {
    console.info(`[sources:${id}] loading source rows`);
    const sources = await prisma.dataSource.findMany({ orderBy: { cityName: 'asc' } });
    console.info(`[sources:${id}] loaded ${sources.length} source rows in ${Math.round(performance.now() - startedAt)}ms; loading counts and sync status`);
    const rows = await Promise.all(sources.map(async (source) => {
      const [totalAgendaItems, latestSync] = await Promise.all([
        prisma.agendaItem.count({
          where: {
            isDemo: false,
            sourceType: source.sourceType.toLowerCase() === 'legistar' ? 'legistar' : { in: ['apify', 'pdf'] },
            OR: [
              { cityId: source.id },
              { cityId: null, cityName: { equals: source.cityName, mode: 'insensitive' } },
            ],
          },
        }),
        prisma.syncLog.findFirst({
          where: { dataSourceId: source.id },
          orderBy: { startedAt: 'desc' },
        }),
      ]);

      return {
        id: source.id,
        cityName: source.cityName,
        sourceType: source.sourceType,
        legistarBaseUrl: source.legistarBaseUrl,
        apifyActorId: source.apifyActorId,
        startUrl: source.startUrl,
        enabled: source.enabled,
        lastSyncTime: source.lastSyncedAt,
        totalAgendaItems,
        lastSyncItemsFound: latestSync?.itemsFound ?? 0,
        lastSyncItemsInserted: latestSync?.itemsInserted ?? 0,
        lastError: syncErrorMessage(latestSync?.errors) ?? syncErrorMessage(source.lastError),
        status: latestSync?.status ?? (source.enabled ? 'ready' : 'disabled'),
      };
    }));

    console.info(`[sources:${id}] complete ${rows.length} rows in ${Math.round(performance.now() - startedAt)}ms`);
    return res.json(rows);
  } catch (err) {
    console.error('[admin/sources] failed to load sources', err);
    return res.status(500).json({ error: 'Failed to load sources.' });
  }
});

// This fixture is deliberately separate from production sources and public APIs.
router.get('/demo-conflict', async (_req, res) => {
  try {
    return res.json(await getSyntheticConflictStatus(prisma));
  } catch (error) {
    console.error('[demo-conflict] status failed', error);
    return res.status(500).json({ error: 'Could not load the synthetic test status.' });
  }
});

router.post('/demo-conflict', async (_req, res) => {
  try {
    return res.json(await runSyntheticConflictCheck(prisma));
  } catch (error) {
    console.error('[demo-conflict] check failed', error);
    return res.status(500).json({ error: 'Synthetic conflict check failed. No successful test is recorded.' });
  }
});

router.delete('/demo-conflict', async (_req, res) => {
  try {
    await removeSyntheticConflictCheck(prisma);
    return res.json({ removed: true });
  } catch (error) {
    console.error('[demo-conflict] cleanup failed', error);
    return res.status(500).json({ error: 'Could not remove the synthetic test records.' });
  }
});

// Create/reuse a city source and start discovery without waiting for the crawl.
router.post('/discover', async (req, res) => {
  try {
    const cityName = typeof req.body.cityName === 'string' ? req.body.cityName.trim() : '';
    if (!cityName || cityName.length > 100) return res.status(400).json({ error: 'Enter a California city name (1–100 characters).' });
    const data = await validateSourceInput({ cityName, sourceType: 'Apify', startUrl: req.body.startUrl });
    const existing = await prisma.dataSource.findFirst({ where: { cityName: { equals: cityName, mode: 'insensitive' }, sourceType: 'apify' } });
    if (existing) {
      const active = await prisma.syncLog.findFirst({ where: { dataSourceId: existing.id, status: 'running' } });
      if (active) return res.status(409).json({ error: 'This city already has a running sync.' });
    }
    const source = existing
      ? await prisma.dataSource.update({ where: { id: existing.id }, data: { ...data, startUrl: data.startUrl ?? existing.startUrl, enabled: true } })
      : await prisma.dataSource.create({ data });
    const syncLog = await prisma.syncLog.create({ data: { dataSourceId: source.id, sourceType: 'apify', status: 'running' } });
    void executeSourceSync(source, syncLog.id).catch((error) => console.error('[admin/sources] discovery result persistence failed', error));
    return res.status(202).json({ sourceId: source.id, syncLogId: syncLog.id, status: 'running' });
  } catch (error) {
    return sendValidationError(res, error);
  }
});

router.get('/:id/documents', async (req, res) => {
  try {
    const rows = await prisma.agendaItem.findMany({
      where: { cityId: req.params.id, sourceType: 'apify' },
      select: { id: true, title: true, sourceUrl: true, meetingDate: true },
      orderBy: { meetingDate: 'desc' }, take: 200,
    });
    return res.json(rows.filter((row) => /^https?:\/\//i.test(row.sourceUrl ?? '')).map((row) => ({
      id: row.id, title: row.title, pdfUrl: row.sourceUrl, meetingDate: row.meetingDate,
    })));
  } catch {
    return res.status(500).json({ error: 'Failed to load agenda documents.' });
  }
});

router.post('/', async (req, res) => {
  try {
    const source = await prisma.dataSource.create({ data: await validateSourceInput(req.body) });
    return res.status(201).json(source);
  } catch (error) {
    return sendValidationError(res, error);
  }
});

router.put('/:id', async (req, res) => {
  try {
    const existing = await prisma.dataSource.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Source not found.' });
    const body = req.body.sourceType?.toLowerCase() === 'apify' && req.body.startUrl == null
      ? { ...req.body, startUrl: existing.startUrl }
      : req.body;
    const source = await prisma.dataSource.update({
      where: { id: req.params.id },
      data: await validateSourceInput(body),
    });
    return res.json(source);
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Source not found.' });
    return sendValidationError(res, error);
  }
});

router.delete('/:id', async (req, res) => {
  try {
    // Agenda items are not deleted with a source; sync-log references use SET NULL.
    const source = await prisma.dataSource.findUnique({ where: { id: req.params.id } });
    if (!source) return res.status(404).json({ error: 'Source not found.' });
    const preservedAgendaItems = await prisma.agendaItem.count({
      where: {
        OR: [
          { cityId: source.id },
          { cityName: { equals: source.cityName, mode: 'insensitive' } },
        ],
      },
    });
    await prisma.dataSource.delete({ where: { id: req.params.id } });
    return res.json({
      deleted: true,
      sourceId: source.id,
      preservedAgendaItems,
      message: `Source deleted. ${preservedAgendaItems} ingested agenda item(s) were preserved.`,
    });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Source not found.' });
    console.error('[admin/sources] failed to delete source', error);
    return res.status(500).json({ error: 'Failed to delete source.' });
  }
});

router.patch('/:id/enabled', async (req, res) => {
  try {
    if (typeof req.body?.enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled must be a boolean.' });
    }
    const source = await prisma.dataSource.update({
      where: { id: req.params.id },
      data: { enabled: req.body.enabled },
    });
    return res.json({ id: source.id, enabled: source.enabled });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Source not found.' });
    console.error('[admin/sources] failed to update source state', error);
    return res.status(500).json({ error: 'Failed to update source state.' });
  }
});

router.post('/:id/sync', async (req, res) => {
  try {
    const source = await prisma.dataSource.findUnique({ where: { id: req.params.id } });
    if (!source) return res.status(404).json({ error: 'Source not found.' });
    if (source.enabled === false) return res.status(409).json({ error: 'Enable this source before starting a sync.' });

    const options = {};
    for (const field of ['startDate', 'endDate']) {
      const value = req.body?.[field];
      if (value == null || value === '') continue;
      const parsed = new Date(`${value}T00:00:00.000Z`);
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
        || Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
        return res.status(400).json({ error: `${field} must be a calendar date in YYYY-MM-DD format.` });
      }
      options[field] = value;
    }
    if (Object.keys(options).length && source.sourceType.toLowerCase() !== 'legistar') {
      return res.status(400).json({ error: 'Historical date ranges are supported only for Legistar sources.' });
    }
    if (options.startDate && options.endDate && options.startDate > options.endDate) {
      return res.status(400).json({ error: 'Start date must be on or before end date.' });
    }

    const syncLog = await prisma.syncLog.create({
      data: { dataSourceId: source.id, sourceType: source.sourceType.toLowerCase(), status: 'running' },
    });
    void executeSourceSync(source, syncLog.id, options).catch((error) => {
      console.error('[admin/sources] failed to persist sync result', error);
    });
    return res.status(202).json({ syncLogId: syncLog.id, status: 'running' });
  } catch (error) {
    console.error('[admin/sources] failed to start sync', error);
    return res.status(500).json({ error: 'Failed to start source sync.' });
  }
});

router.get('/:id/sync/:syncLogId', async (req, res) => {
  try {
    const syncLog = await prisma.syncLog.findFirst({
      where: { id: req.params.syncLogId, dataSourceId: req.params.id },
    });
    if (!syncLog) return res.status(404).json({ error: 'Sync run not found.' });
    return res.json({
      id: syncLog.id,
      status: syncLog.status,
      startedAt: syncLog.startedAt,
      completedAt: syncLog.completedAt,
      itemsFound: syncLog.itemsFound,
      itemsInserted: syncLog.itemsInserted,
      itemsSkipped: syncLog.itemsSkipped,
      conflictCandidates: syncLog.conflictCandidates,
      conflictsDetected: syncLog.conflictsDetected,
      conflictsSkipped: syncLog.conflictsSkipped,
      detectionErrors: syncLog.detectionErrors,
      detectionFailures: syncLog.detectionErrors?.length ?? 0,
      error: syncErrorMessage(syncLog.errors),
    });
  } catch (error) {
    console.error('[admin/sources] failed to load sync status', error);
    return res.status(500).json({ error: 'Failed to load sync status.' });
  }
});

router.post('/:id/sync/:syncLogId/retry-detection', async (req, res) => {
  try {
    const syncLog = await prisma.syncLog.findFirst({
      where: { id: req.params.syncLogId, dataSourceId: req.params.id },
    });
    if (!syncLog) return res.status(404).json({ error: 'Sync run not found.' });

    const agendaItemIds = getRetryableAgendaItemIds(syncLog.detectionErrors);
    if (agendaItemIds.length === 0) {
      return res.status(409).json({ error: 'This sync run has no retryable detection failures.' });
    }

    const detection = await detectAgendaConflictsSafely(
      agendaItemIds,
      detectConflictsForAgendaItems,
      { prisma },
    );
    const updated = await prisma.syncLog.update({
      where: { id: syncLog.id },
      data: {
        conflictCandidates: (syncLog.conflictCandidates ?? 0) + detection.conflictCandidates,
        conflictsDetected: (syncLog.conflictsDetected ?? 0) + detection.conflictsDetected,
        conflictsSkipped: (syncLog.conflictsSkipped ?? 0) + detection.conflictsSkipped,
        detectionErrors: detection.detectionErrors,
      },
    });

    return res.json({
      conflictCandidates: updated.conflictCandidates,
      conflictsDetected: updated.conflictsDetected,
      conflictsSkipped: updated.conflictsSkipped,
      detectionErrors: updated.detectionErrors,
      detectionFailures: updated.detectionErrors.length,
    });
  } catch (error) {
    console.error('[admin/sources] failed to retry conflict detection', error);
    return res.status(500).json({ error: 'Failed to retry conflict detection.' });
  }
});

export default router;
