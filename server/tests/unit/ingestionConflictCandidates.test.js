import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => {
  const state = {
    agendaItems: [],
    conflicts: [],
    syncLogs: [],
    scheduleCde: [{
      politicianId: 'politician-1',
      sourceName: 'Acme Builders',
      amount: '$2,500',
      scheduleType: 'C',
    }],
    actorItems: [{
      pdf_url: 'https://city.test/agenda.pdf',
      meeting_date: '2026-10-01',
      city_name: 'Test City',
    }],
  };
  let agendaId = 0;
  let syncLogId = 0;

  const prisma = {
    agendaItem: {
      findMany: vi.fn(async ({ where }) => {
        if (where?.id?.in) {
          return state.agendaItems.filter((row) => where.id.in.includes(row.id));
        }
        if (where?.legistarItemId?.in) {
          return state.agendaItems
            .filter((row) => where.legistarItemId.in.includes(row.legistarItemId))
            .map(({ id, legistarItemId }) => ({ id, legistarItemId }));
        }
        return [];
      }),
      findUnique: vi.fn(async ({ where }) => {
        if (where.legistarItemId) return state.agendaItems.find((row) => row.legistarItemId === where.legistarItemId) ?? null;
        const key = where.cityId_meetingDate_itemNumber;
        return state.agendaItems.find((row) => (
          row.cityId === key.cityId
          && new Date(row.meetingDate).getTime() === new Date(key.meetingDate).getTime()
          && row.itemNumber === key.itemNumber
        )) ?? null;
      }),
      createMany: vi.fn(async ({ data }) => {
        for (const row of data) {
          if (!state.agendaItems.some((existing) => existing.legistarItemId === row.legistarItemId)) {
            state.agendaItems.push({ id: `agenda-${++agendaId}`, ...row });
          }
        }
        return { count: data.length };
      }),
      upsert: vi.fn(async ({ where, create, update }) => {
        if (where.legistarItemId) {
          const existing = state.agendaItems.find((row) => row.legistarItemId === where.legistarItemId);
          if (existing) return Object.assign(existing, update);
          const row = { id: `agenda-${++agendaId}`, ...create };
          state.agendaItems.push(row);
          return row;
        }
        const key = where.cityId_meetingDate_itemNumber;
        const existing = state.agendaItems.find((row) => (
          row.cityId === key.cityId
          && new Date(row.meetingDate).getTime() === new Date(key.meetingDate).getTime()
          && row.itemNumber === key.itemNumber
        ));
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const row = { id: `agenda-${++agendaId}`, ...create };
        state.agendaItems.push(row);
        return row;
      }),
    },
    scheduleAInvestment: { findMany: vi.fn(async () => []) },
    scheduleBRealEstate: { findMany: vi.fn(async () => []) },
    scheduleCdeIncome: { findMany: vi.fn(async () => state.scheduleCde) },
    scheduleA2BusinessPosition: { findMany: vi.fn(async () => []) },
    conflict: {
      createMany: vi.fn(async ({ data, skipDuplicates }) => {
        let count = 0;
        for (const row of data) {
          const duplicate = state.conflicts.some((existing) => (
            existing.politicianId === row.politicianId
            && existing.agendaItemId === row.agendaItemId
            && existing.conflictType === row.conflictType
            && existing.sourceKey === row.sourceKey
          ));
          if (duplicate && skipDuplicates) continue;
          state.conflicts.push({ reviewStatus: 'pending', ...row });
          count += 1;
        }
        return { count };
      }),
    },
    dataSource: {
      findFirst: vi.fn(async () => null),
      findUnique: vi.fn(async () => ({
        id: 'source-1',
        cityName: 'Test City',
        sourceType: 'legistar',
        legistarBaseUrl: 'https://webapi.legistar.com/v1/test',
        apifyActorId: 'test/actor',
        startUrl: 'https://city.test/agendas',
      })),
      create: vi.fn(async ({ data }) => ({ id: 'source-1', ...data })),
      update: vi.fn(async ({ where, data }) => ({ id: where.id, ...data })),
    },
    syncLog: {
      create: vi.fn(async ({ data }) => {
        const row = { id: `sync-${++syncLogId}`, ...data };
        state.syncLogs.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }) => {
        const row = state.syncLogs.find((entry) => entry.id === where.id);
        Object.assign(row, data);
        return row;
      }),
    },
    $transaction: vi.fn(async (operations) => Promise.all(operations)),
  };

  return { state, prisma };
});

const mockApis = vi.hoisted(() => ({
  getMeetings: vi.fn(),
  getAgendaItems: vi.fn(),
  fetchLegistarAgendaItemsForDataSource: vi.fn(),
  apifyClient: {
    actor: vi.fn(() => ({
      call: vi.fn(async () => ({ defaultDatasetId: 'dataset-1' })),
    })),
    dataset: vi.fn(() => ({
      listItems: vi.fn(async () => ({ items: testState.state.actorItems })),
    })),
  },
}));

vi.mock('../../src/lib/prisma.js', () => ({ prisma: testState.prisma }));
vi.mock('apify-client', () => ({
  ApifyClient: vi.fn(function ApifyClient() {
    return mockApis.apifyClient;
  }),
}));
vi.mock('../../src/ingestion/legistarApi.js', () => ({
  getMeetings: mockApis.getMeetings,
  getAgendaItems: mockApis.getAgendaItems,
  getVotes: vi.fn(),
}));
vi.mock('../../src/ingestion/legistar.js', () => ({
  fetchLegistarAgendaItemsForDataSource: mockApis.fetchLegistarAgendaItemsForDataSource,
}));
vi.mock('../../src/ingestion/pdfParser.js', () => ({
  parsePdfAgenda: vi.fn(async (_buffer, cityId, meetingDate) => [{
    cityId,
    meetingDate,
    itemNumber: '1',
    itemText: 'Approve a contract with Acme Builders.',
    sourceType: 'pdf',
  }]),
}));
vi.mock('../../src/jobs/runApifyAgendaScrape.js', async (importOriginal) => ({
  ...(await importOriginal()),
  downloadPdf: vi.fn(async () => Buffer.from('pdf')),
}));

import { runLegistarSyncForCity } from '../../src/jobs/nightlySync.js';
import { runApifyAgendaScrape } from '../../src/jobs/runApifyAgendaScrape.js';
import adminSourcesRouter from '../../src/routes/admin/sources.js';

const app = express();
app.use(express.json());
app.use('/api/admin/sources', adminSourcesRouter);

function createSql(insertedIds) {
  const sql = () => Promise.resolve(insertedIds.map((id) => ({ id })));
  sql.unsafe = vi.fn();
  return sql;
}

function expectVisibleIncomeConflict() {
  expect(testState.state.conflicts).toHaveLength(1);
  expect(testState.state.conflicts[0]).toMatchObject({
    politicianId: 'politician-1',
    conflictType: 'INCOME',
    entityName: 'Acme Builders',
    reviewStatus: 'pending',
  });
}

describe('agenda ingestion creates visible conflict candidates from matching disclosures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    testState.state.agendaItems.length = 0;
    testState.state.conflicts.length = 0;
    testState.state.syncLogs.length = 0;
    testState.state.scheduleCde = [{
      politicianId: 'politician-1',
      sourceName: 'Acme Builders',
      amount: '$2,500',
      scheduleType: 'C',
    }];
    mockApis.getMeetings.mockResolvedValue([{
      EventId: 42,
      EventDate: '2026-10-01',
      EventBodyName: 'City Council',
    }]);
    mockApis.getAgendaItems.mockResolvedValue([{
      EventItemId: 9001,
      EventItemTitle: 'Approve a contract with Acme Builders.',
    }]);
    mockApis.fetchLegistarAgendaItemsForDataSource.mockResolvedValue({
      meetings: [{ EventId: 42 }],
      allItems: [{
        meetingId: 42,
        meeting: { EventBodyName: 'City Council', EventDate: '2026-10-01' },
        item: { EventItemId: 9001, EventItemTitle: 'Approve a contract with Acme Builders.' },
      }],
    });
    vi.stubEnv('APIFY_TOKEN', 'test-token');
  });

  it('creates a conflict from matching Legistar data in the scheduled sync worker', async () => {
    const id = 'agenda-legistar';
    testState.state.agendaItems.push({
      id,
      sourceType: 'legistar',
      title: 'Approve a contract with Acme Builders.',
      itemText: 'Approve a contract with Acme Builders.',
    });

    const result = await runLegistarSyncForCity(
      createSql([id]),
      { id: 'source-1', city_name: 'Test City', legistar_base_url: 'https://webapi.legistar.com/v1/test' },
      new Set(['legistar_item_id', 'source_type']),
      { detectionDependencies: { prisma: testState.prisma } },
    );

    expect(result.conflictsDetected).toBe(1);
    expectVisibleIncomeConflict();
  });

  it('creates a conflict from matching Apify/PDF data in the scheduled scraper', async () => {
    const result = await runApifyAgendaScrape({
      prismaClient: testState.prisma,
      scrapeAgendaPDFs: vi.fn().mockResolvedValue(testState.state.actorItems),
      fetchImpl: vi.fn(async () => new Response('pdf')),
      log: vi.fn(),
    });

    expect(result.conflictsDetected).toBe(1);
    expectVisibleIncomeConflict();
  });

  it('creates a conflict from matching data during an admin-triggered Legistar sync', async () => {
    const response = await request(app).post('/api/admin/sources/source-1/sync');

    expect(response.status).toBe(202);
    await vi.waitFor(() => expect(testState.state.syncLogs[0]?.status).toBe('success'));
    expectVisibleIncomeConflict();
  });

  it('creates a conflict from matching data during an admin-triggered Apify/PDF sync', async () => {
    testState.prisma.dataSource.findUnique.mockResolvedValue({
      id: 'source-1',
      cityName: 'Test City',
      sourceType: 'apify',
      apifyActorId: 'test/actor',
      startUrl: 'https://city.test/agendas',
    });

    const response = await request(app).post('/api/admin/sources/source-1/sync');

    expect(response.status).toBe(202);
    await vi.waitFor(() => expect(testState.state.syncLogs[0]?.status).toBe('success'));
    expectVisibleIncomeConflict();
  });
});
