import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/auth.js', () => ({
  requireAdmin: (_req, _res, next) => next(),
}));

vi.mock('../../src/lib/prisma.js', () => ({
  prisma: {
    dataSource: { create: vi.fn(), update: vi.fn(), delete: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn() },
    agendaItem: { deleteMany: vi.fn(), findMany: vi.fn(), createMany: vi.fn() },
    syncLog: { create: vi.fn(), update: vi.fn(), findFirst: vi.fn() },
    $transaction: vi.fn((operations) => Promise.all(operations)),
  },
}));

vi.mock('apify-client', () => ({ ApifyClient: vi.fn() }));
vi.mock('../../src/ingestion/legistarApi.js', () => ({
  getMeetings: vi.fn(),
  getAgendaItems: vi.fn(),
  getVotes: vi.fn(),
}));

import { prisma } from '../../src/lib/prisma.js';
import { ApifyClient } from 'apify-client';
import { getAgendaItems, getMeetings } from '../../src/ingestion/legistarApi.js';
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
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn());
  prisma.dataSource.create.mockImplementation(async ({ data }) => ({ id: 'source-1', ...data }));
  prisma.dataSource.update.mockImplementation(async ({ where, data }) => ({ id: where.id, ...data }));
  prisma.dataSource.delete.mockResolvedValue({ id: 'source-1' });
  prisma.dataSource.findUnique.mockResolvedValue({
    id: 'source-1',
    cityName: 'Sacramento',
    sourceType: 'legistar',
    legistarBaseUrl: 'https://webapi.legistar.com/v1/sacramento',
  });
  getMeetings.mockResolvedValue([{ EventId: 42, EventDate: '2026-10-01', EventBodyName: 'City Council' }]);
  getAgendaItems.mockResolvedValue([{
    EventItemId: 9001,
    MatterId: 900,
    EventItemTitle: 'Approve public works contract',
    EventItemAgendaNumber: '5.1',
  }]);
  prisma.agendaItem.createMany.mockResolvedValue({ count: 1 });
  prisma.syncLog.create.mockResolvedValue({ id: 'sync-1' });
  prisma.syncLog.update.mockResolvedValue({ id: 'sync-1' });
  prisma.syncLog.findFirst.mockResolvedValue({
    id: 'sync-1',
    status: 'running',
    startedAt: new Date('2026-09-27T12:00:00.000Z'),
    completedAt: null,
    itemsFound: 0,
    itemsInserted: 0,
    itemsSkipped: 0,
    errors: null,
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
      }),
    });
  });

  it('rejects malformed base URLs without making a request or creating a source', async () => {
    const response = await request(app)
      .post('/api/admin/sources')
      .send({ ...validSource, legistarBaseUrl: 'https://example.com/not-legistar' });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/Legistar API URL/);
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

  it('deletes only the source configuration and leaves ingested agenda items untouched', async () => {
    const response = await request(app).delete('/api/admin/sources/source-1');

    expect(response.status).toBe(204);
    expect(prisma.dataSource.delete).toHaveBeenCalledWith({ where: { id: 'source-1' } });
    expect(prisma.agendaItem.deleteMany).not.toHaveBeenCalled();
  });
});

describe('on-demand source sync', () => {
  it('creates a city-only discovery source and starts a run', async () => {
    vi.stubEnv('APIFY_TOKEN', 'token');
    vi.stubEnv('APIFY_ACTOR_ID', 'fair/finder');
    prisma.dataSource.findFirst.mockResolvedValue(null);
    const call = vi.fn().mockResolvedValue({ status: 'SUCCEEDED', defaultDatasetId: 'dataset' });
    ApifyClient.mockImplementation(function () { return {
      actor: () => ({ get: async () => ({ id: 'fair/finder' }), call }),
      dataset: () => ({ listItems: async () => ({ items: [] }) }),
    }; });
    prisma.agendaItem.findMany.mockResolvedValue([]);
    const response = await request(app).post('/api/admin/sources/discover').send({ cityName: ' Example ' });
    expect(response.status).toBe(202);
    expect(response.body.sourceId).toBe('source-1');
    await vi.waitFor(() => expect(call).toHaveBeenCalledWith({ cityName: 'Example' }, { timeout: 600 }));
    expect(prisma.dataSource.create).toHaveBeenCalledWith({ data: expect.objectContaining({ cityName: 'Example', apifyActorId: 'fair/finder', startUrl: null }) });
  });

  it('rejects invalid city discovery input before creating sources', async () => {
    expect((await request(app).post('/api/admin/sources/discover').send({ cityName: ' ' })).status).toBe(400);
    expect(prisma.dataSource.create).not.toHaveBeenCalled();
  });

  it('returns document links without exposing non-URL content', async () => {
    prisma.agendaItem.findMany.mockResolvedValue([
      { id: 'pdf', title: 'Agenda', itemText: 'https://city.gov/a.pdf', meetingDate: null },
      { id: 'text', itemText: 'not a URL' },
    ]);
    const response = await request(app).get('/api/admin/sources/source-1/documents');
    expect(response.body).toEqual([{ id: 'pdf', title: 'Agenda', pdfUrl: 'https://city.gov/a.pdf', meetingDate: null }]);
  });

  it('records failed Actor runs rather than importing partial datasets', async () => {
    vi.stubEnv('APIFY_TOKEN', 'token');
    prisma.dataSource.findUnique.mockResolvedValue({ id: 'source-1', cityName: 'Example', sourceType: 'apify', apifyActorId: 'finder' });
    ApifyClient.mockImplementation(function () { return { actor: () => ({ call: async () => ({ status: 'FAILED', statusMessage: 'No unique official website' }) }) }; });
    await request(app).post('/api/admin/sources/source-1/sync');
    await vi.waitFor(() => expect(prisma.syncLog.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'failed', errors: { message: 'Actor FAILED: No unique official website' } }) })));
    expect(prisma.agendaItem.createMany).not.toHaveBeenCalled();
  });

  it('starts a Legistar ingestion and returns a running sync-log ID', async () => {
    const response = await request(app).post('/api/admin/sources/source-1/sync');

    expect(response.status).toBe(202);
    expect(response.body).toEqual({ syncLogId: 'sync-1', status: 'running' });
    expect(prisma.syncLog.create).toHaveBeenCalledWith({
      data: { dataSourceId: 'source-1', sourceType: 'legistar', status: 'running' },
    });
    await vi.waitFor(() => expect(getMeetings).toHaveBeenCalledWith(
      'https://webapi.legistar.com/v1/sacramento',
      50,
    ));
    expect(getAgendaItems).toHaveBeenCalledWith('https://webapi.legistar.com/v1/sacramento', 42);
    await vi.waitFor(() => expect(prisma.agendaItem.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        sourceType: 'legistar',
        legistarItemId: '9001',
        cityName: 'Sacramento',
        title: 'Approve public works contract',
      })],
      skipDuplicates: true,
    }));
  });

  it('returns the persisted status and result counts for a sync run', async () => {
    prisma.syncLog.findFirst.mockResolvedValue({
      id: 'sync-1',
      status: 'success',
      startedAt: new Date('2026-09-27T12:00:00.000Z'),
      completedAt: new Date('2026-09-27T12:01:00.000Z'),
      itemsFound: 5,
      itemsInserted: 3,
      itemsSkipped: 2,
      errors: null,
    });

    const response = await request(app).get('/api/admin/sources/source-1/sync/sync-1');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: 'sync-1',
      status: 'success',
      itemsFound: 5,
      itemsInserted: 3,
      itemsSkipped: 2,
      error: null,
    });
    expect(prisma.syncLog.findFirst).toHaveBeenCalledWith({
      where: { id: 'sync-1', dataSourceId: 'source-1' },
    });
  });

  it('runs the configured Apify actor and persists its agenda items', async () => {
    vi.stubEnv('APIFY_TOKEN', 'account-token');
    prisma.dataSource.findUnique.mockResolvedValue({
      id: 'source-1',
      cityName: 'Elk Grove',
      sourceType: 'apify',
      apifyActorId: 'fair/agenda-scraper',
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
    expect(actorCall).toHaveBeenCalledWith({ cityName: 'Elk Grove' }, { timeout: 600 });
    await vi.waitFor(() => expect(prisma.agendaItem.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        sourceType: 'apify',
        cityId: 'source-1',
        cityName: 'Elk Grove',
        title: 'Council agenda',
        itemText: 'https://city.gov/agenda.pdf',
      })],
    }));
  });
});