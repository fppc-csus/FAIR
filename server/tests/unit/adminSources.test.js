import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/prisma.js', () => ({
  prisma: {
    jurisdiction: { findMany: vi.fn(async () => [{ id: 'county-sonoma', name: 'County of Sonoma' }]), create: vi.fn(async ({ data }) => ({ id: `new-${data.name}` })) },
    dataSource: { create: vi.fn(), update: vi.fn(), delete: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn() },
    agendaItem: { count: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn(), createMany: vi.fn() },
    syncLog: { create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findFirst: vi.fn() },
    syncJobRun: { findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    $transaction: vi.fn((operations) => Promise.all(operations)),
  },
}));

vi.mock('apify-client', () => ({ ApifyClient: vi.fn() }));
vi.mock('../../src/ingestion/legistarApi.js', () => ({
  getMeetings: vi.fn(),
  getAgendaItems: vi.fn(),
  getMatterVersions: vi.fn().mockResolvedValue([]),
  getMatterText: vi.fn(),
  getVotes: vi.fn(),
}));
vi.mock('../../src/ingestion/apifyAgenda.js', () => ({
  ingestApifyAgendaItems: vi.fn(),
}));
vi.mock('../../src/detection/detectConflicts.js', () => ({
  detectConflictsForAgendaItems: vi.fn(async () => ({ inserted: 1, skipped: 0, totalCandidates: 1 })),
}));

import { prisma } from '../../src/lib/prisma.js';
import { ApifyClient } from 'apify-client';
import { ingestApifyAgendaItems } from '../../src/ingestion/apifyAgenda.js';
import { getAgendaItems, getMeetings } from '../../src/ingestion/legistarApi.js';
import { detectConflictsForAgendaItems } from '../../src/detection/detectConflicts.js';
import sourcesRouter from '../../src/routes/admin/sources.js';

const app = express();
app.use(express.json());
app.use('/api/admin/sources', sourcesRouter);

const validSource = {
  cityName: 'Sacramento',
  sourceType: 'Legistar',
  legistarBaseUrl: 'https://webapi.legistar.com/v1/sacramento',
};
const validApifySource = {
  cityName: 'Elk Grove',
  sourceType: 'Apify',
  apifyActorId: '  fair/agenda-scraper  ',
  startUrl: 'https://www.elkgrovecity.org/city-government/city-council/meeting-agendas',
};

beforeEach(() => {
  vi.clearAllMocks();
  detectConflictsForAgendaItems.mockResolvedValue({ inserted: 1, skipped: 0, totalCandidates: 1 });
  vi.stubGlobal('fetch', vi.fn());
  prisma.dataSource.create.mockImplementation(async ({ data }) => ({ id: 'source-1', ...data }));
  prisma.dataSource.update.mockImplementation(async ({ where, data }) => ({ id: where.id, ...data }));
  prisma.dataSource.delete.mockResolvedValue({ id: 'source-1' });
  prisma.dataSource.findUnique.mockResolvedValue({
    id: 'source-1',
    cityName: 'Sacramento',
    sourceType: 'legistar',
    legistarBaseUrl: 'https://webapi.legistar.com/v1/sacramento',
    enabled: true,
  });
  prisma.agendaItem.count.mockResolvedValue(3);
  getMeetings.mockResolvedValue([{ EventId: 42, EventDate: '2026-10-01', EventBodyName: 'City Council' }]);
  getAgendaItems.mockResolvedValue([{
    EventItemId: 9001,
    MatterId: 900,
    EventItemTitle: 'Approve public works contract',
    EventItemAgendaNumber: '5.1',
  }]);
  prisma.agendaItem.createMany.mockResolvedValue({ count: 1 });
  prisma.agendaItem.findMany.mockResolvedValue([]);
  prisma.agendaItem.findUnique.mockResolvedValue(null);
  prisma.agendaItem.upsert.mockImplementation(async ({ create }) => ({ id: 'agenda-1', ...create }));
  prisma.syncLog.create.mockResolvedValue({ id: 'sync-1' });
  prisma.syncLog.update.mockImplementation(async ({ where, data }) => ({ id: where.id, ...data }));
  prisma.syncLog.updateMany.mockResolvedValue({ count: 0 });
  prisma.syncJobRun.findMany.mockResolvedValue([]);
  prisma.syncJobRun.create.mockResolvedValue({ id: 'job-run-1' });
  prisma.syncJobRun.updateMany.mockResolvedValue({ count: 0 });
  prisma.syncJobRun.update.mockResolvedValue({ id: 'job-run-1' });
  prisma.syncLog.findFirst.mockResolvedValue({
    id: 'sync-1',
    status: 'running',
    startedAt: new Date('2026-09-27T12:00:00.000Z'),
    completedAt: null,
    itemsFound: 0,
    documentsFound: 0,
    pdfsFetched: 0,
    documentsSkipped: 0,
    itemsInserted: 0,
    itemsSkipped: 0,
    errors: null,
  });
  ingestApifyAgendaItems.mockResolvedValue({
    cityName: 'Elk Grove',
    documentsFound: 1,
    pdfsFetched: 1,
    documentsSkipped: 0,
    itemsInserted: 2,
    itemsSkipped: 0,
    errors: [],
  });
  prisma.$transaction.mockImplementation((operations) => Promise.all(operations));
});

describe('Legistar source validation on save', () => {
  it('tests the Legistar Events endpoint before creating the source', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => [] });

    const response = await request(app).post('/api/admin/sources').send(validSource);

    expect(response.status).toBe(201);
    expect(fetch).toHaveBeenCalledWith(
      'https://webapi.legistar.com/v1/sacramento/Events?$top=1',
      expect.objectContaining({ headers: { Accept: 'application/json' } }),
    );
    expect(prisma.dataSource.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        cityName: 'Sacramento',
        sourceType: 'legistar',
        legistarBaseUrl: 'https://webapi.legistar.com/v1/sacramento',
        jurisdictionId: 'new-Sacramento',
      }),
    });
  });

  it('links a "Sonoma County" source to the existing "County of Sonoma" jurisdiction', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => [] });
    const response = await request(app).post('/api/admin/sources')
      .send({ ...validSource, cityName: 'Sonoma County', legistarBaseUrl: 'https://webapi.legistar.com/v1/sonoma-county' });
    expect(response.status).toBe(201);
    expect(prisma.dataSource.create).toHaveBeenCalledWith({ data: expect.objectContaining({ jurisdictionId: 'county-sonoma' }) });
  });

  it('converts a public Legistar site address to its Web API URL and links the jurisdiction', async () => {
    const { parseLegistarBaseUrl } = await import('../../src/routes/admin/sources.js');
    expect(parseLegistarBaseUrl('https://oakland.legistar.com/Calendar.aspx')).toBe('https://webapi.legistar.com/v1/oakland');
    expect(parseLegistarBaseUrl('https://sonoma-county.legistar.com/LegislationDetail.aspx?ID=4283189')).toBe('https://webapi.legistar.com/v1/sonoma-county');
    expect(parseLegistarBaseUrl('https://webapi.legistar.com/v1/oakland/')).toBe('https://webapi.legistar.com/v1/oakland');
  });

  it('rejects a Legistar address submitted as an Apify start URL', async () => {
    const response = await request(app)
      .post('/api/admin/sources')
      .send({ cityName: 'Oakland', sourceType: 'Apify', startUrl: 'https://webapi.legistar.com/v1/oakland', apifyActorId: 'actor' });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/Choose the Legistar source type/);
  });

  it('rejects malformed base URLs without making a request or creating a source', async () => {
    const response = await request(app)
      .post('/api/admin/sources')
      .send({ ...validSource, legistarBaseUrl: 'https://example.com/not-legistar' });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/Use a Legistar URL/);
    expect(fetch).not.toHaveBeenCalled();
    expect(prisma.dataSource.create).not.toHaveBeenCalled();
  });

  it('returns an error and does not create a source when the test request fails', async () => {
    fetch.mockResolvedValue({ ok: false, status: 503, statusText: 'Unavailable' });

    const response = await request(app).post('/api/admin/sources').send(validSource);

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Legistar test request failed (503 Unavailable)');
    expect(prisma.dataSource.create).not.toHaveBeenCalled();
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('Apify actor validation on save', () => {
  beforeEach(() => {
    vi.stubEnv('APIFY_TOKEN', 'account-token');
  });

  it('checks the actor with the configured account before creating the source', async () => {
    const actorGet = vi.fn().mockResolvedValue({ id: 'fair/agenda-scraper' });
    const actor = vi.fn(() => ({ get: actorGet }));
    ApifyClient.mockImplementation(function MockApifyClient() {
      return { actor };
    });

    const response = await request(app).post('/api/admin/sources').send(validApifySource);

    expect(response.status).toBe(201);
    expect(ApifyClient).toHaveBeenCalledWith({ token: 'account-token' });
    expect(actor).toHaveBeenCalledWith('fair/agenda-scraper');
    expect(actorGet).toHaveBeenCalledTimes(1);
    expect(prisma.dataSource.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        cityName: 'Elk Grove',
        sourceType: 'apify',
        apifyActorId: 'fair/agenda-scraper',
        startUrl: 'https://www.elkgrovecity.org/city-government/city-council/meeting-agendas',
      }),
    });
  });

  it('rejects actors unavailable to the configured account without creating a source', async () => {
    const actorGet = vi.fn().mockRejectedValue(new Error('Actor not found or not accessible'));
    const actor = vi.fn(() => ({ get: actorGet }));
    ApifyClient.mockImplementation(function MockApifyClient() {
      return { actor };
    });

    const response = await request(app).post('/api/admin/sources').send(validApifySource);

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('configured Apify account');
    expect(response.body.error).toContain('Actor not found or not accessible');
    expect(prisma.dataSource.create).not.toHaveBeenCalled();
  });

  it('rejects a missing start URL before checking or invoking Apify', async () => {
    const response = await request(app).post('/api/admin/sources').send({
      cityName: 'Elk Grove', sourceType: 'Apify', apifyActorId: 'fair/agenda-scraper',
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('agenda archive URL');
    expect(ApifyClient).not.toHaveBeenCalled();
    expect(prisma.dataSource.create).not.toHaveBeenCalled();
  });
});

describe('source edit and delete', () => {
  it('updates a source after validating its new Legistar URL', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => [] });

    const response = await request(app)
      .put('/api/admin/sources/source-1')
      .send({ ...validSource, cityName: 'West Sacramento' });

    expect(response.status).toBe(200);
    expect(prisma.dataSource.update).toHaveBeenCalledWith({
      where: { id: 'source-1' },
      data: expect.objectContaining({ cityName: 'West Sacramento', sourceType: 'legistar' }),
    });
  });

  it('preserves an existing Apify start URL when an older client omits it', async () => {
    vi.stubEnv('APIFY_TOKEN', 'account-token');
    prisma.dataSource.findUnique.mockResolvedValue({
      id: 'source-1', sourceType: 'apify', startUrl: 'https://city.gov/agendas',
    });
    ApifyClient.mockImplementation(function () { return { actor: () => ({ get: async () => ({ id: 'actor' }) }) }; });

    const response = await request(app).put('/api/admin/sources/source-1').send({
      cityName: 'Example', sourceType: 'Apify', apifyActorId: 'fair/agenda-scraper',
    });

    expect(response.status).toBe(200);
    expect(prisma.dataSource.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ startUrl: 'https://city.gov/agendas' }),
    }));
  });

  it('deletes only the source configuration and leaves ingested agenda items untouched', async () => {
    const response = await request(app).delete('/api/admin/sources/source-1');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ deleted: true, sourceId: 'source-1', preservedAgendaItems: 3 });
    expect(prisma.dataSource.delete).toHaveBeenCalledWith({ where: { id: 'source-1' } });
    expect(prisma.agendaItem.deleteMany).not.toHaveBeenCalled();
  });

  it('enables and disables a source with a boolean value', async () => {
    prisma.dataSource.update.mockResolvedValue({ id: 'source-1', enabled: false });
    const response = await request(app).patch('/api/admin/sources/source-1/enabled').send({ enabled: false });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ id: 'source-1', enabled: false });
    expect(prisma.dataSource.update).toHaveBeenCalledWith({ where: { id: 'source-1' }, data: { enabled: false } });
  });

  it('rejects sync attempts while a source is disabled', async () => {
    prisma.dataSource.findUnique.mockResolvedValue({ id: 'source-1', sourceType: 'legistar', enabled: false });
    const response = await request(app).post('/api/admin/sources/source-1/sync');
    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/Enable this source/);
    expect(prisma.syncLog.create).not.toHaveBeenCalled();
  });
});

describe('on-demand source sync', () => {
  it('rejects invalid backfill dates before creating a job', async () => {
    const response = await request(app).post('/api/admin/sources/source-1/sync')
      .send({ startDate: '2025-02-31' });
    expect(response.status).toBe(400);
    expect(prisma.syncLog.create).not.toHaveBeenCalled();
  });

  it('passes an explicit historical range to the shared fetcher', async () => {
    await request(app).post('/api/admin/sources/source-1/sync')
      .send({ startDate: '2025-11-01', endDate: '2025-11-30' });
    await vi.waitFor(() => expect(getMeetings).toHaveBeenCalledWith(
      validSource.legistarBaseUrl,
      expect.objectContaining({ startDate: '2025-11-01', endDate: '2025-11-30' }),
    ));
  });
  it('creates a URL-backed discovery source and starts a run', async () => {
    vi.stubEnv('APIFY_TOKEN', 'token');
    vi.stubEnv('APIFY_ACTOR_ID', 'fair/finder');
    prisma.dataSource.findFirst.mockResolvedValue(null);
    const call = vi.fn().mockResolvedValue({ status: 'SUCCEEDED', defaultDatasetId: 'dataset' });
    ApifyClient.mockImplementation(function () { return {
      actor: () => ({ get: async () => ({ id: 'fair/finder' }), call }),
      dataset: () => ({ listItems: async () => ({ items: [] }) }),
    }; });
    prisma.agendaItem.findMany.mockResolvedValue([]);
    const response = await request(app).post('/api/admin/sources/discover').send({ cityName: ' Example ', startUrl: 'https://example.gov/agendas' });
    expect(response.status).toBe(202);
    expect(response.body.sourceId).toBe('source-1');
    await vi.waitFor(() => expect(call).toHaveBeenCalledWith({
      cityName: 'Example', startUrl: 'https://example.gov/agendas', maxDepth: 2, maxPages: 200, sameDomainOnly: true,
    }, { timeout: 600 }));
    expect(prisma.dataSource.create).toHaveBeenCalledWith({ data: expect.objectContaining({ cityName: 'Example', apifyActorId: 'fair/finder', startUrl: 'https://example.gov/agendas' }) });
  });

  it('rejects invalid city discovery input before creating sources', async () => {
    expect((await request(app).post('/api/admin/sources/discover').send({ cityName: ' ' })).status).toBe(400);
    expect(prisma.dataSource.create).not.toHaveBeenCalled();
  });

  it('returns document links without exposing non-URL content', async () => {
    prisma.agendaItem.findMany.mockResolvedValue([
      { id: 'pdf', title: 'Agenda', itemText: 'Parsed council agenda text', sourceUrl: 'https://city.gov/a.pdf', meetingDate: null },
      { id: 'text', itemText: 'not a URL' },
    ]);
    const response = await request(app).get('/api/admin/sources/source-1/documents');
    expect(response.body).toEqual([{ id: 'pdf', title: 'Agenda', pdfUrl: 'https://city.gov/a.pdf', meetingDate: null }]);
  });

  it('records failed Actor runs rather than importing partial datasets', async () => {
    vi.stubEnv('APIFY_TOKEN', 'token');
    prisma.dataSource.findUnique.mockResolvedValue({
      id: 'source-1', cityName: 'Example', sourceType: 'apify', apifyActorId: 'finder', startUrl: 'https://example.gov/agendas',
    });
    ApifyClient.mockImplementation(function () { return { actor: () => ({ call: async () => ({ status: 'FAILED', statusMessage: 'No unique official website' }) }) }; });
    await request(app).post('/api/admin/sources/source-1/sync');
    await vi.waitFor(() => expect(prisma.syncLog.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'failed',
        errors: [{ message: 'Actor FAILED: No unique official website' }],
      }),
    })));
    expect(prisma.agendaItem.createMany).not.toHaveBeenCalled();
    expect(ingestApifyAgendaItems).not.toHaveBeenCalled();
  });

  it('starts a Legistar ingestion and returns a running sync-log ID', async () => {
    prisma.agendaItem.findMany
      .mockReset()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'agenda-1' }]);
    const response = await request(app).post('/api/admin/sources/source-1/sync');

    expect(response.status).toBe(202);
    expect(response.body).toEqual({ syncLogId: 'sync-1', status: 'running' });
    expect(prisma.syncLog.create).toHaveBeenCalledWith({
      data: { dataSourceId: 'source-1', sourceType: 'legistar', status: 'running' },
    });
    await vi.waitFor(() => expect(getMeetings).toHaveBeenCalledWith(
      'https://webapi.legistar.com/v1/sacramento',
      expect.objectContaining({ startDate: expect.any(Date) }),
    ));
    expect(getAgendaItems).toHaveBeenCalledWith('https://webapi.legistar.com/v1/sacramento', 42);
    await vi.waitFor(() => expect(prisma.agendaItem.upsert).toHaveBeenCalledWith({
      where: { legistarItemId: 'sacramento:9001' },
      create: expect.objectContaining({
        sourceType: 'legistar',
        legistarItemId: 'sacramento:9001',
        cityName: 'Sacramento',
        title: 'Approve public works contract',
        itemText: 'Approve public works contract',
      }),
      update: expect.objectContaining({ legistarItemId: 'sacramento:9001' }),
    }));
    await vi.waitFor(() => expect(detectConflictsForAgendaItems).toHaveBeenCalledWith(
      ['agenda-1'],
      { prisma },
    ));
    await vi.waitFor(() => expect(prisma.syncLog.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        conflictCandidates: 1,
        conflictsDetected: 1,
        conflictsSkipped: 0,
        detectionErrors: [],
      }),
    })));
  });

  it('returns the persisted status and result counts for a sync run', async () => {
    prisma.syncLog.findFirst.mockResolvedValue({
      id: 'sync-1',
      status: 'success',
      startedAt: new Date('2026-09-27T12:00:00.000Z'),
      completedAt: new Date('2026-09-27T12:01:00.000Z'),
      itemsFound: 5,
      documentsFound: 5,
      pdfsFetched: 4,
      documentsSkipped: 1,
      itemsInserted: 3,
      itemsSkipped: 2,
      conflictCandidates: 4,
      conflictsDetected: 3,
      conflictsSkipped: 1,
      detectionErrors: [],
      detectionFailures: 0,
      errors: null,
    });

    const response = await request(app).get('/api/admin/sources/source-1/sync/sync-1');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: 'sync-1',
      status: 'success',
      itemsFound: 5,
      documentsFound: 5,
      pdfsFetched: 4,
      documentsSkipped: 1,
      itemsInserted: 3,
      itemsSkipped: 2,
      conflictCandidates: 4,
      conflictsDetected: 3,
      conflictsSkipped: 1,
      detectionErrors: [],
      error: null,
    });
    expect(prisma.syncLog.findFirst).toHaveBeenCalledWith({
      where: { id: 'sync-1', dataSourceId: 'source-1' },
    });
  });

  it('retries stored detection failures without rerunning agenda ingestion', async () => {
    prisma.syncLog.findFirst.mockResolvedValue({
      id: 'sync-1',
      dataSourceId: 'source-1',
      conflictCandidates: 0,
      conflictsDetected: 0,
      conflictsSkipped: 0,
      detectionErrors: [{
        agendaItemIds: ['agenda-1', 'agenda-2'],
        message: 'detector unavailable',
      }],
    });
    detectConflictsForAgendaItems.mockResolvedValue({
      totalCandidates: 2,
      inserted: 1,
      skipped: 1,
    });

    const response = await request(app)
      .post('/api/admin/sources/source-1/sync/sync-1/retry-detection');

    expect(response.status).toBe(200);
    expect(detectConflictsForAgendaItems).toHaveBeenCalledWith(
      ['agenda-1', 'agenda-2'],
      { prisma },
    );
    expect(prisma.syncLog.update).toHaveBeenCalledWith({
      where: { id: 'sync-1' },
      data: {
        conflictCandidates: 2,
        conflictsDetected: 1,
        conflictsSkipped: 1,
        detectionErrors: [],
      },
    });
  });

  it('keeps failed detection IDs available for another retry attempt', async () => {
    prisma.syncLog.findFirst.mockResolvedValue({
      id: 'sync-1',
      dataSourceId: 'source-1',
      conflictCandidates: 0,
      conflictsDetected: 0,
      conflictsSkipped: 0,
      detectionErrors: [{ agendaItemIds: ['agenda-1'], message: 'first failure' }],
    });
    detectConflictsForAgendaItems.mockRejectedValue(new Error('still unavailable'));

    const response = await request(app)
      .post('/api/admin/sources/source-1/sync/sync-1/retry-detection');

    expect(response.status).toBe(200);
    expect(response.body.detectionErrors).toEqual([{
      agendaItemIds: ['agenda-1'],
      message: 'still unavailable',
    }]);
    expect(prisma.syncLog.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        detectionErrors: [expect.objectContaining({ agendaItemIds: ['agenda-1'] })],
      }),
    }));
  });

  it('passes actor documents and the existing sync log to shared Apify ingestion', async () => {
    vi.stubEnv('APIFY_TOKEN', 'account-token');
    prisma.dataSource.findUnique.mockResolvedValue({
      id: 'source-1',
      cityName: 'Elk Grove',
      sourceType: 'apify',
      apifyActorId: 'fair/agenda-scraper',
      startUrl: 'https://city.gov/agendas',
    });
    const actorCall = vi.fn().mockResolvedValue({ defaultDatasetId: 'dataset-1' });
    const actor = vi.fn(() => ({ call: actorCall }));
    const datasetListItems = vi.fn().mockResolvedValue({
      items: [{ pdf_url: 'https://city.gov/agenda.pdf', title: 'Council agenda', meeting_date: '2026-10-01' }],
    });
    const dataset = vi.fn(() => ({ listItems: datasetListItems }));
    ApifyClient.mockImplementation(function MockApifyClient() {
      return { actor, dataset };
    });
    prisma.agendaItem.findMany.mockResolvedValue([]);

    const response = await request(app).post('/api/admin/sources/source-1/sync');

    expect(response.status).toBe(202);
    await vi.waitFor(() => expect(datasetListItems).toHaveBeenCalledWith({ limit: 1000, offset: 0 }));
    expect(actor).toHaveBeenCalledWith('fair/agenda-scraper');
    expect(actorCall).toHaveBeenCalledWith({
      cityName: 'Elk Grove', startUrl: 'https://city.gov/agendas', maxDepth: 2, maxPages: 200, sameDomainOnly: true,
    }, { timeout: 600 });
    await vi.waitFor(() => expect(ingestApifyAgendaItems).toHaveBeenCalledWith({
      items: [{ pdf_url: 'https://city.gov/agenda.pdf', title: 'Council agenda', meeting_date: '2026-10-01' }],
      source: {
        id: 'source-1', cityName: 'Elk Grove', sourceType: 'apify',
        apifyActorId: 'fair/agenda-scraper', startUrl: 'https://city.gov/agendas',
      },
      syncLogId: 'sync-1',
      jobRunId: 'job-run-1',
      skipJobLock: true,
      log: expect.any(Function),
    }));
    expect(prisma.syncLog.update).toHaveBeenCalledWith({
      where: { id: 'sync-1' },
      data: { jobRunId: 'job-run-1' },
    });
    // The ingestion service owns final status and metrics, including skipped PDFs.
    expect(prisma.dataSource.update).not.toHaveBeenCalled();
    expect(prisma.agendaItem.upsert).not.toHaveBeenCalled();
  });

  it('collects every dataset page and records shared ingestion failures on the original run', async () => {
    vi.stubEnv('APIFY_TOKEN', 'account-token');
    prisma.dataSource.findUnique.mockResolvedValue({
      id: 'source-1', cityName: 'Elk Grove', sourceType: 'apify',
      apifyActorId: 'fair/agenda-scraper', startUrl: 'https://city.gov/agendas',
    });
    const firstPage = Array.from({ length: 1000 }, (_, index) => ({ pdf_url: `https://city.gov/${index}.pdf` }));
    const lastPage = [{ pdf_url: 'https://city.gov/last.pdf' }];
    const listItems = vi.fn()
      .mockResolvedValueOnce({ items: firstPage })
      .mockResolvedValueOnce({ items: lastPage });
    ApifyClient.mockImplementation(function () {
      return {
        actor: () => ({ call: async () => ({ status: 'SUCCEEDED', defaultDatasetId: 'dataset-1' }) }),
        dataset: () => ({ listItems }),
      };
    });
    ingestApifyAgendaItems.mockRejectedValueOnce(new Error('Database unavailable'));

    const response = await request(app).post('/api/admin/sources/source-1/sync');

    expect(response.status).toBe(202);
    await vi.waitFor(() => expect(prisma.syncLog.update).toHaveBeenCalledWith({
      where: { id: 'sync-1' },
      data: expect.objectContaining({ status: 'failed', errors: [{ message: 'Database unavailable' }] }),
    }));
    expect(listItems).toHaveBeenNthCalledWith(1, { limit: 1000, offset: 0 });
    expect(listItems).toHaveBeenNthCalledWith(2, { limit: 1000, offset: 1000 });
    expect(ingestApifyAgendaItems).toHaveBeenCalledWith(expect.objectContaining({
      items: [...firstPage, ...lastPage], syncLogId: 'sync-1',
    }));
    expect(prisma.syncLog.create).toHaveBeenCalledTimes(1);
  });
});