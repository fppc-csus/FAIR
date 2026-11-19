import { describe, expect, it } from 'vitest';
import { apifySourceDiagnostic, buildApifyActorInput } from '../../src/ingestion/apifyActorInput.js';

describe('buildApifyActorInput', () => {
  it('builds the shared manual and scheduled Actor input', () => {
    expect(buildApifyActorInput({ cityName: 'City of Calexico', startUrl: 'https://www.calexico.ca.gov/councilagendas' }, { lookbackDays: 14 })).toEqual({
      cityName: 'City of Calexico',
      startUrl: 'https://www.calexico.ca.gov/councilagendas',
      maxDepth: 2,
      maxPages: 200,
      sameDomainOnly: true,
      lookbackDays: 14,
    });
  });

  it('passes an inclusive historical date range to the Actor', () => {
    expect(buildApifyActorInput(
      { cityName: 'City of Calexico', startUrl: 'https://www.calexico.ca.gov/councilagendas' },
      { startDate: '2024-01-01', endDate: '2025-12-31' },
    )).toMatchObject({
      startDate: '2024-01-01',
      endDate: '2025-12-31',
    });
  });

  it('rejects a missing URL before an Actor can be invoked', () => {
    expect(() => buildApifyActorInput({ cityName: 'City of Calexico', startUrl: null }))
      .toThrow('Agenda archive URL is required for City of Calexico before running Apify.');
  });
});

describe('apifySourceDiagnostic', () => {
  it('logs only safe source metadata and the URL hostname', () => {
    expect(apifySourceDiagnostic({
      cityName: 'Example', apifyActorId: 'actor-id', startUrl: 'https://city.gov/private/path?token=secret',
    })).toEqual({ actorId: 'actor-id', cityName: 'Example', hasStartUrl: true, startUrlHostname: 'city.gov' });
  });
});