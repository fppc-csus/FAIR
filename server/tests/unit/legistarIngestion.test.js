import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/ingestion/legistarApi.js', () => ({
  getMeetings: vi.fn(),
  getAgendaItems: vi.fn(),
}));

import { getAgendaItems, getMeetings } from '../../src/ingestion/legistarApi.js';
import { fetchLegistarAgendaItemsForDataSource } from '../../src/ingestion/legistar.js';

afterEach(() => vi.clearAllMocks());

describe('fetchLegistarAgendaItemsForDataSource', () => {
  it('passes a historical window through and excludes hidden/test meetings', async () => {
    getMeetings.mockResolvedValue([
      { EventId: 1, EventDate: '2025-11-04', EventAgendaStatusName: 'Final' },
      { EventId: 2, EventDate: '2025-11-07', EventAgendaStatusName: 'Hidden' },
      { EventId: 3, EventDate: '2025-11-08', EventComment: 'TEST migration' },
    ]);
    getAgendaItems.mockResolvedValue([{ EventItemId: 100 }]);

    const result = await fetchLegistarAgendaItemsForDataSource(
      { legistarBaseUrl: 'https://webapi.legistar.com/v1/example' },
      { startDate: '2025-11-01', endDate: '2025-11-30' },
    );

    expect(getMeetings).toHaveBeenCalledWith(
      'https://webapi.legistar.com/v1/example',
      expect.objectContaining({ startDate: '2025-11-01', endDate: '2025-11-30' }),
    );
    expect(getAgendaItems).toHaveBeenCalledTimes(1);
    expect(getAgendaItems).toHaveBeenCalledWith('https://webapi.legistar.com/v1/example', 1);
    expect(result.meetings).toHaveLength(1);
    expect(result.allItems).toEqual([
      expect.objectContaining({ meetingId: 1, item: { EventItemId: 100 } }),
    ]);
  });

  it('limits concurrent event-item requests in batches', async () => {
    getMeetings.mockResolvedValue(Array.from({ length: 5 }, (_, index) => ({ EventId: index + 1 })));
    let active = 0;
    let maximumActive = 0;
    getAgendaItems.mockImplementation(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      return [];
    });

    await fetchLegistarAgendaItemsForDataSource(
      { baseUrl: 'https://webapi.legistar.com/v1/example' },
      { lookbackDays: 30, concurrency: 2 },
    );

    expect(maximumActive).toBe(2);
  });
});