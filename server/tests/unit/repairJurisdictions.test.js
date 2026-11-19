import { describe, expect, it, vi } from 'vitest';
import { applyJurisdictionRepair, planJurisdictionRepair } from '../../scripts/repair-jurisdictions.mjs';

const jurisdictions = [
  { id: 'fresno-city', name: 'Fresno', politicianCount: 0, createdAt: '2026-01-02', legistarClientId: 'fresno' },
  { id: 'fresno-agency', name: 'City of Fresno', politicianCount: 7, createdAt: '2026-01-03', legistarClientId: null },
  { id: 'sonoma', name: 'County of Sonoma', politicianCount: 13, createdAt: '2026-01-01' },
];
const dataSources = [
  { id: 's1', cityName: 'Sonoma County', sourceType: 'legistar', jurisdictionId: null },
  { id: 's2', cityName: 'Fresno', sourceType: 'legistar', jurisdictionId: 'fresno-city' },
  { id: 's3', cityName: 'oakland', sourceType: 'apify', startUrl: 'https://webapi.legistar.com/v1/oakland', jurisdictionId: null },
  { id: 's4', cityName: 'City of Calexico', sourceType: 'apify', startUrl: 'https://www.calexico.ca.gov/councilagendas', jurisdictionId: null },
];

describe('jurisdiction repair plan', () => {
  it('merges spellings into the record holding the filers and links sources to it', () => {
    const plan = planJurisdictionRepair({ jurisdictions, dataSources });
    expect(plan.merges).toEqual([{ keep: jurisdictions[1], remove: jurisdictions[0] }]);
    expect(plan.links.map(({ source, jurisdiction }) => [source.id, jurisdiction.id])).toEqual([
      ['s1', 'sonoma'], ['s2', 'fresno-agency'],
    ]);
    expect(plan.creates.map((source) => source.id)).toEqual(['s4']);
    expect(plan.brokenSources.map((source) => source.id)).toEqual(['s3']);
  });

  it('applies the plan in one transaction and carries the Legistar client id over', async () => {
    const tx = Object.fromEntries(['politician', 'meeting', 'dataSource', 'detectionRun', 'conflict', 'jurisdiction']
      .map((model) => [model, { updateMany: vi.fn(), update: vi.fn(), delete: vi.fn(), create: vi.fn(async () => ({ id: 'new' })) }]));
    const prisma = { $transaction: vi.fn(async (fn) => fn(tx)) };
    await applyJurisdictionRepair(prisma, planJurisdictionRepair({ jurisdictions, dataSources }));
    expect(tx.politician.updateMany).toHaveBeenCalledWith({ where: { jurisdictionId: 'fresno-city' }, data: { jurisdictionId: 'fresno-agency' } });
    expect(tx.jurisdiction.update).toHaveBeenCalledWith({ where: { id: 'fresno-agency' }, data: { legistarClientId: 'fresno' } });
    expect(tx.jurisdiction.delete).toHaveBeenCalledWith({ where: { id: 'fresno-city' } });
    expect(tx.dataSource.delete).toHaveBeenCalledWith({ where: { id: 's3' } });
    expect(tx.dataSource.update).toHaveBeenCalledWith({ where: { id: 's4' }, data: { jurisdictionId: 'new' } });
  });
});
