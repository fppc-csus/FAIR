import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAgendaItems, getMeetings } from '../../src/ingestion/legistarApi.js';

afterEach(() => vi.unstubAllGlobals());

describe('Legistar API requests', () => {
  it('uses an AbortSignal so stalled upstream requests have a real deadline', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json([]));
    vi.stubGlobal('fetch', fetchMock);

    await getMeetings('https://webapi.legistar.com/v1/example', 1);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/Events?'),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('requests an inclusive historical date range and paginates all meeting pages', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json([
        { EventId: 1, EventDate: '2025-11-01T00:00:00' },
        { EventId: 2, EventDate: '2025-11-02T00:00:00' },
      ]))
      .mockResolvedValueOnce(Response.json([
        { EventId: 3, EventDate: '2025-11-30T00:00:00' },
      ]));
    vi.stubGlobal('fetch', fetchMock);

    const meetings = await getMeetings('https://webapi.legistar.com/v1/example', {
      startDate: '2025-11-01',
      endDate: '2025-11-30',
      pageSize: 2,
    });

    expect(meetings.map((meeting) => meeting.id)).toEqual([1, 2, 3]);
    const firstUrl = new URL(fetchMock.mock.calls[0][0]);
    expect(firstUrl.searchParams.get('$filter')).toBe(
      "EventDate ge datetime'2025-11-01' and EventDate lt datetime'2025-12-01'",
    );
    expect(firstUrl.searchParams.get('$skip')).toBe('0');
    expect(new URL(fetchMock.mock.calls[1][0]).searchParams.get('$skip')).toBe('2');
  });

  it('normalizes common EventItem-prefixed matter fields', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json([{
      EventItemId: 10,
      EventItemEventId: 20,
      EventItemMatterId: 30,
      EventItemMatterName: 'Public works agreement',
      EventItemMatterType: 'Consent Calendar Item',
      EventItemAgendaNumber: '4.',
      EventItemAgendaNote: 'Authorize the agreement.',
    }])));

    await expect(getAgendaItems('https://webapi.legistar.com/v1/example', 20)).resolves.toEqual([
      expect.objectContaining({
        id: 10,
        eventId: 20,
        matterId: 30,
        matterName: 'Public works agreement',
        matterType: 'Consent Calendar Item',
        agendaNumber: '4.',
        agendaNote: 'Authorize the agreement.',
      }),
    ]);
  });
});