import { describe, expect, it, vi } from 'vitest';

import { seedDatabase } from '../../prisma/seed.js';

function createPrismaSeedMock() {
  const log = vi.fn();
  const jurisdictions = new Map();
  const politicians = new Map();
  const dataSources = new Map();
  const jurisdictionUpsert = vi.fn(async ({ where, create }) => {
    if (!jurisdictions.has(where.legistarClientId)) {
      jurisdictions.set(where.legistarClientId, { id: 'jurisdiction-1', ...create });
    }
    return jurisdictions.get(where.legistarClientId);
  });
  const politicianUpsert = vi.fn(async ({ where, create, update }) => {
    const existing = politicians.get(where.slug);
    if (existing) {
      Object.assign(existing, update);
      return existing;
    }
    const record = { id: `politician-${politicians.size + 1}`, ...create };
    politicians.set(where.slug, record);
    return record;
  });
  const dataSourceFindFirst = vi.fn(async ({ where }) => [...dataSources.values()].find((source) =>
    source.cityName.toLowerCase() === where.cityName.equals.toLowerCase()
      && source.sourceType === where.sourceType) ?? null);
  const dataSourceCreate = vi.fn(async ({ data }) => {
    const record = { id: `source-${dataSources.size + 1}`, ...data };
    dataSources.set(record.id, record);
    return record;
  });
  const dataSourceUpdate = vi.fn(async ({ where, data }) => {
    const record = dataSources.get(where.id);
    Object.assign(record, data);
    return record;
  });

  return {
    prisma: {
      jurisdiction: { upsert: jurisdictionUpsert },
      politician: { upsert: politicianUpsert },
      dataSource: {
        findFirst: dataSourceFindFirst,
        create: dataSourceCreate,
        update: dataSourceUpdate,
      },
    },
    log,
    jurisdictions,
    politicians,
    dataSources,
    jurisdictionUpsert,
    politicianUpsert,
    dataSourceFindFirst,
    dataSourceCreate,
    dataSourceUpdate,
  };
}

describe('Prisma seed process', () => {
  it('creates the documented sample records and remains duplicate-free when rerun', async () => {
    const {
      prisma,
      log,
      jurisdictions,
      politicians,
      dataSources,
      jurisdictionUpsert,
      politicianUpsert,
      dataSourceFindFirst,
      dataSourceCreate,
      dataSourceUpdate,
    } = createPrismaSeedMock();

    await seedDatabase(prisma, log);
    await seedDatabase(prisma, log);

    expect(jurisdictions.size).toBe(1);
    expect(jurisdictions.get('ca-state')).toMatchObject({
      name: 'State of California',
      type: 'STATE',
    });
    expect(politicians.size).toBe(6);
    expect([...politicians.keys()].sort()).toEqual([
      'buffy-wicks',
      'eleni-kounalakis',
      'gavin-newsom',
      'rob-bonta',
      'scott-wiener',
      'shannon-grove',
    ]);
    expect(jurisdictionUpsert).toHaveBeenCalledTimes(2);
    expect(politicianUpsert).toHaveBeenCalledTimes(12);
    expect([...dataSources.values()]).toEqual([
      {
        id: 'source-1',
        cityName: 'Fresno',
        sourceType: 'legistar',
        legistarBaseUrl: 'https://webapi.legistar.com/v1/fresno',
        legistarClientId: 'fresno',
        apifyActorId: null,
        startUrl: null,
        enabled: false,
      },
      {
        id: 'source-2',
        cityName: 'Oakland',
        sourceType: 'legistar',
        legistarBaseUrl: 'https://webapi.legistar.com/v1/oakland',
        legistarClientId: 'oakland',
        apifyActorId: null,
        startUrl: null,
        enabled: false,
      },
      {
        id: 'source-3',
        cityName: 'San Jose',
        sourceType: 'legistar',
        legistarBaseUrl: 'https://webapi.legistar.com/v1/sanjose',
        legistarClientId: 'sanjose',
        apifyActorId: null,
        startUrl: null,
        enabled: false,
      },
    ]);
    expect(dataSourceFindFirst).toHaveBeenCalledTimes(6);
    expect(dataSourceCreate).toHaveBeenCalledTimes(3);
    expect(dataSourceUpdate).toHaveBeenCalledTimes(3);
    expect(log).toHaveBeenCalledTimes(2);
  });

  it('updates existing source URLs without changing their enabled state', async () => {
    const { prisma, dataSources } = createPrismaSeedMock();
    dataSources.set('existing-fresno', {
      id: 'existing-fresno',
      cityName: 'fReSnO',
      sourceType: 'legistar',
      enabled: true,
    });

    await seedDatabase(prisma, vi.fn());

    expect(dataSources.size).toBe(3);
    expect(dataSources.get('existing-fresno')).toMatchObject({
      cityName: 'Fresno',
      sourceType: 'legistar',
      legistarBaseUrl: 'https://webapi.legistar.com/v1/fresno',
      legistarClientId: 'fresno',
      enabled: true,
    });
  });
});
