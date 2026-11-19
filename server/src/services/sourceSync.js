import { ApifyClient } from 'apify-client';
import { prisma } from '../lib/prisma.js';
import { fetchLegistarAgendaItemsForDataSource } from '../ingestion/legistar.js';
import { legistarItemKey } from '../ingestion/legistarIdentity.js';
import { ingestApifyAgendaItems } from '../ingestion/apifyAgenda.js';
import { upsertAgendaItems } from '../ingestion/upsertAgendaItems.js';
import { buildApifyActorInput } from '../ingestion/apifyActorInput.js';
import { detectConflictsForAgendaItems } from '../detection/detectConflicts.js';
import {
  detectAgendaConflictsSafely,
} from '../detection/detectAgendaConflictsSafely.js';
import { runSyncJob } from '../jobs/syncJobRun.js';

async function runLegistarSource(source, options = {}) {
  const { allItems } = await fetchLegistarAgendaItemsForDataSource(source, {
    lookbackDays: 30,
    ...options,
  });

  const rows = allItems.flatMap(({ item, meeting, meetingId }) => {
    const itemId = item.EventItemId ?? item.id;
    if (itemId == null) return [];

    const rawMeetingDate = meeting.EventDate ?? meeting.date ?? null;
    const meetingDate =
      rawMeetingDate && !Number.isNaN(Date.parse(rawMeetingDate))
        ? new Date(rawMeetingDate)
        : null;

    const title =
      item.EventItemTitle ??
      item.EventItemMatterName ??
      item.MatterName ??
      item.Title ??
      item.title ??
      'Untitled agenda item';

    const description =
      item.EventItemAgendaNote ?? item.AgendaNote ?? null;

    const itemText = [
      title,
      description,
      item.EventItemMinutesNote ?? item.MinutesNote,
      item.EventItemActionText,
    ]
      .filter((value) => value != null && String(value).trim() !== '')
      .join('\n');

    return [
      {
        sourceType: 'legistar',
        legistarItemId: legistarItemKey(source.legistarBaseUrl, itemId),
        legistarEventId: String(meetingId),
        legistarMatterId:
          item.EventItemMatterId != null
            ? String(item.EventItemMatterId)
            : item.MatterId != null
              ? String(item.MatterId)
              : null,
        cityName: source.cityName,
        cityId: source.id,
        title,
        description,
        itemText: itemText || null,
        sourceUrl:
          meeting.EventInSiteURL ?? meeting.EventAgendaFile ?? null,
        agendaNumber:
          item.EventItemAgendaNumber ?? item.AgendaNumber ?? null,
        bodyName: meeting.EventBodyName ?? meeting.bodyName ?? null,
        meetingDate,
        eventItemPassedFlag:
          item.EventItemPassedFlag == null
            ? null
            : Boolean(item.EventItemPassedFlag),
        legistarItemPayload: item,
      },
    ];
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

async function runApifySource(source, syncLogId, jobRunId) {
  if (!process.env.APIFY_TOKEN) {
    throw new Error(
      'Apify is not configured on the server (APIFY_TOKEN is missing).',
    );
  }

  const actorId = source.apifyActorId ?? process.env.APIFY_ACTOR_ID;

  if (!actorId) {
    throw new Error(
      'Apify is not configured on the server (APIFY_ACTOR_ID is missing).',
    );
  }

  const client = new ApifyClient({
    token: process.env.APIFY_TOKEN,
  });

  const run = await client
    .actor(actorId)
    .call(buildApifyActorInput(source), { timeout: 600 });

  if (run.status && run.status !== 'SUCCEEDED') {
    throw new Error(
      `Actor ${run.status}: ${
        run.statusMessage || 'Check the Apify run log.'
      }`,
    );
  }

  if (!run.defaultDatasetId) {
    throw new Error('Apify actor run did not return a dataset ID.');
  }

  const items = [];

  for (let offset = 0; ; offset += 1000) {
    const page = await client
      .dataset(run.defaultDatasetId)
      .listItems({ limit: 1000, offset });

    items.push(...(page.items ?? []));

    if ((page.items?.length ?? 0) < 1000) break;
  }

  const result = await ingestApifyAgendaItems({
    items,
    source: { ...source, apifyActorId: actorId },
    syncLogId,
    jobRunId,
    skipJobLock: true,
    log: console.log,
  });

  if (result.skippedRun) {
    throw new Error('Another sync for this city is already active.');
  }

  return result;
}

async function performSourceSync(source, syncLogId, options = {}) {
  try {
    await prisma.syncLog.update({
      where: { id: syncLogId },
      data: { jobRunId: options.jobRunId },
    });

    if (source.sourceType.toLowerCase() !== 'legistar') {
      const result = await runApifySource(
        source,
        syncLogId,
        options.jobRunId,
      );

      return {
        failed: result.errors?.length > 0,
      };
    }

    const result = await runLegistarSource(source, options);
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
        data: {
          lastSyncedAt: completedAt,
          lastError: null,
        },
      }),
    ]);

    return { failed: false };
  } catch (error) {
    const completedAt = new Date();

    await prisma.$transaction([
      prisma.syncLog.update({
        where: { id: syncLogId },
        data: {
          status: 'failed',
          completedAt,
          errors: [{ message: error.message }],
        },
      }),
      prisma.dataSource.update({
        where: { id: source.id },
        data: {
          lastError: error.message,
          lastDocumentsFound: 0,
          lastPdfsFetched: 0,
          lastItemsInserted: 0,
          lastItemsSkipped: 0,
          lastSyncErrors: [{ message: error.message }],
        },
      }),
    ]);

    return { failed: true };
  }
}

export async function executeSourceSync(source, syncLogId, options = {}) {
  const isLegistar = source.sourceType.toLowerCase() === 'legistar';
  const jobKey = isLegistar
    ? 'legistar'
    : `apify-city:${source.id}`;

  const outcome = await runSyncJob(
    jobKey,
    ({ runId }) =>
      performSourceSync(source, syncLogId, {
        ...options,
        jobRunId: runId,
      }),
    {
      prismaClient: prisma,
      hasErrors: (result) => result.failed,
    },
  );

  if (!outcome.skipped) return outcome.result;

  const message =
    'Another sync for this source is already active; this request was skipped.';
  const completedAt = new Date();

  await prisma.$transaction([
    prisma.syncLog.update({
      where: { id: syncLogId },
      data: {
        status: 'failed',
        completedAt,
        errors: [{ message }],
      },
    }),
    prisma.dataSource.update({
      where: { id: source.id },
      data: { lastError: message },
    }),
  ]);

  return {
    failed: true,
    skipped: true,
  };
}