import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  actorCall: vi.fn(),
  actor: vi.fn(),
  dataset: vi.fn(),
  keyValueStore: vi.fn(),
  getRecord: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock('apify-client', () => ({
  ApifyClient: vi.fn(function MockApifyClient() {
    return {
      actor: mocks.actor,
      dataset: mocks.dataset,
      keyValueStore: mocks.keyValueStore,
    };
  }),
}));
vi.mock('../../src/lib/prisma.js', () => ({
  prisma: { dataSource: { findMany: mocks.findMany } },
}));

import { scrapeAgendaPDFs } from '../../services/apifyscraper.js';

describe('scrapeAgendaPDFs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.actor.mockReturnValue({ call: mocks.actorCall });
    mocks.actorCall.mockResolvedValue({ defaultDatasetId: 'dataset-1' });
    mocks.dataset.mockReturnValue({ listItems: vi.fn().mockResolvedValue({ items: [] }) });
    mocks.keyValueStore.mockReturnValue({ getRecord: mocks.getRecord });
  });

  it('uses the shared required Actor input for scheduled source runs', async () => {
    mocks.findMany.mockResolvedValue([{
      cityName: 'City of Calexico',
      startUrl: 'https://www.calexico.ca.gov/councilagendas',
      apifyActorId: 'actor-id',
    }]);
    const onSourceComplete = vi.fn();
    await scrapeAgendaPDFs({ lookbackDays: 14, onSourceComplete });

    expect(mocks.actor).toHaveBeenCalledWith('actor-id');
    expect(mocks.actorCall).toHaveBeenCalledWith({
      cityName: 'City of Calexico',
      startUrl: 'https://www.calexico.ca.gov/councilagendas',
      maxDepth: 2,
      maxPages: 200,
      sameDomainOnly: true,
      lookbackDays: 14,
    });
    expect(onSourceComplete).toHaveBeenCalledWith(expect.objectContaining({ cityName: 'City of Calexico' }));
  });

  it('restricts historical backfills to the requested enabled city and date range', async () => {
    mocks.findMany.mockResolvedValue([{
      cityName: 'City of Calexico',
      startUrl: 'https://www.calexico.ca.gov/councilagendas',
      apifyActorId: 'actor-id',
    }]);
    mocks.actorCall.mockResolvedValue({
      defaultDatasetId: 'dataset-1',
      defaultKeyValueStoreId: 'store-1',
    });
    mocks.getRecord.mockResolvedValue({ value: { errors: 0, remaining: 0 } });

    await scrapeAgendaPDFs({
      city: 'City of Calexico',
      startDate: '2024-01-01',
      endDate: '2025-12-31',
    });

    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        sourceType: 'apify',
        enabled: true,
        cityName: { equals: 'City of Calexico', mode: 'insensitive' },
      },
    }));
    expect(mocks.actorCall).toHaveBeenCalledWith(expect.objectContaining({
      startDate: '2024-01-01',
      endDate: '2025-12-31',
    }));
    expect(mocks.getRecord).toHaveBeenCalledWith('SUMMARY');
  });

  it('reports an incomplete historical crawl but still returns collected documents', async () => {
    mocks.findMany.mockResolvedValue([{
      cityName: 'City of Calexico',
      startUrl: 'https://www.calexico.ca.gov/councilagendas',
      apifyActorId: 'actor-id',
    }]);
    mocks.actorCall.mockResolvedValue({
      defaultDatasetId: 'dataset-1',
      defaultKeyValueStoreId: 'store-1',
    });
    mocks.getRecord.mockResolvedValue({ value: { errors: 1, remaining: 2 } });
    mocks.dataset.mockReturnValue({ listItems: vi.fn().mockResolvedValue({ items: [
      { pdf_url: 'https://city.gov/agenda.pdf' },
    ] }) });
    const onSourceError = vi.fn();

    const items = await scrapeAgendaPDFs({
      startDate: '2024-01-01',
      endDate: '2024-12-31',
      onSourceError,
    });

    expect(items).toHaveLength(1);
    expect(onSourceError).toHaveBeenCalledWith(
      expect.objectContaining({ cityName: 'City of Calexico' }),
      expect.objectContaining({ message: expect.stringContaining('errors=1, remaining=2') }),
    );
  });

  it('rejects missing source URLs before invoking the Actor', async () => {
    mocks.findMany.mockResolvedValue([{
      cityName: 'City of Calexico', startUrl: null, apifyActorId: 'actor-id',
    }]);

    await expect(scrapeAgendaPDFs()).rejects.toThrow('Agenda archive URL is required for City of Calexico');
    expect(mocks.actorCall).not.toHaveBeenCalled();
  });

  it('attributes documents to the configured source when the actor omits or mislabels the city', async () => {
    mocks.findMany.mockResolvedValue([{
      cityName: 'Configured City', startUrl: 'https://city.test/agendas', apifyActorId: 'actor-id',
    }]);
    mocks.dataset.mockReturnValue({ listItems: vi.fn().mockResolvedValue({ items: [
      { pdf_url: 'https://city.test/agenda.pdf' },
      { pdf_url: 'https://city.test/other.pdf', city_name: 'Wrong City' },
    ] }) });

    const items = await scrapeAgendaPDFs();

    expect(items.map((item) => item.city_name)).toEqual(['Configured City', 'Configured City']);
  });

  it.each([
    [{ status: 'FAILED', statusMessage: 'Provider unavailable' }, 'Provider unavailable'],
    [{ status: 'SUCCEEDED' }, 'did not return a dataset ID'],
  ])('continues with remaining sources after an actor failure: %j', async (failedRun, message) => {
    mocks.findMany.mockResolvedValue(['Failed City', 'Healthy City'].map((cityName) => ({
      cityName, startUrl: 'https://city.test/agendas', apifyActorId: 'actor-id',
    })));
    mocks.actorCall.mockResolvedValueOnce(failedRun);
    const onSourceError = vi.fn();

    await scrapeAgendaPDFs({ onSourceError });

    expect(mocks.actorCall).toHaveBeenCalledTimes(2);
    expect(onSourceError).toHaveBeenCalledWith(
      expect.objectContaining({ cityName: 'Failed City' }),
      expect.objectContaining({ message: expect.stringContaining(message) }),
    );
  });

  it('reports invalid dataset results without a city reference error', async () => {
    mocks.findMany.mockResolvedValue([{
      cityName: 'Test City', startUrl: 'https://city.test/agendas', apifyActorId: 'actor-id',
    }]);
    mocks.dataset.mockReturnValue({ listItems: vi.fn().mockResolvedValue({ items: null }) });

    await expect(scrapeAgendaPDFs()).rejects.toThrow('Apify dataset for Test City returned invalid results.');
  });
});