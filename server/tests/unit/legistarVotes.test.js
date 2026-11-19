import { describe, expect, it, vi } from 'vitest';
import { matchVotesToPoliticians, persistLegistarVotes } from '../../src/ingestion/legistarVotes.js';
import { fetchLegistarAgendaItemsForDataSource } from '../../src/ingestion/legistar.js';
import { buildLegistarAgendaRow } from '../../src/ingestion/legistarAgendaRow.js';

const sonoma = [{ id: 'hopkins', fullName: 'Lynda Hopkins' }, { id: 'gore', fullName: 'James M Gore' }, { id: 'gorin', fullName: 'Susan K Gorin' }];

describe('Legistar roll-call votes', () => {
  it('matches roll-call names to filers despite middle initials', () => {
    const matched = matchVotesToPoliticians([
      { personName: 'Lynda Hopkins', value: 'Aye' }, { personName: 'James Gore', value: 'Aye' }, { personName: 'Shirlee Zane', value: 'Aye' },
    ], sonoma);
    expect(matched.map((vote) => vote.politicianId)).toEqual(['hopkins', 'gore', null]);
  });

  it('never guesses between two officials with the same first and last name', () => {
    const matched = matchVotesToPoliticians([{ personName: 'Pat Lee', value: 'Nay' }], [{ id: 'a', fullName: 'Pat A Lee' }, { id: 'b', fullName: 'Pat B Lee' }]);
    expect(matched[0].politicianId).toBeNull();
  });

  it('stores each matched vote once per item and official', async () => {
    const prisma = {
      politician: { findMany: vi.fn().mockResolvedValue(sonoma) },
      agendaItem: { findMany: vi.fn().mockResolvedValue([{ id: 'item-1709', legistarItemId: 'sonoma-county:28386' }]) },
      voteRecord: { upsert: vi.fn() },
    };
    const meetingDate = new Date('2019-12-17T00:00:00Z');
    const result = await persistLegistarVotes(prisma, { jurisdictionId: 'county', items: [{ legistarItemId: 'sonoma-county:28386', meetingDate,
      votes: [{ personName: 'Lynda Hopkins', value: 'Aye' }, { personName: 'David Rabbitt', value: 'Absent' }] }] });
    expect(result).toEqual({ votesStored: 1, votesUnmatched: 1 });
    expect(prisma.voteRecord.upsert).toHaveBeenCalledWith({
      where: { agendaItemId_politicianId: { agendaItemId: 'item-1709', politicianId: 'hopkins' } },
      create: { agendaItemId: 'item-1709', politicianId: 'hopkins', vote: 'Aye', voteDate: meetingDate },
      update: { vote: 'Aye', voteDate: meetingDate },
    });
  });

  it('does nothing without a jurisdiction link', async () => {
    expect(await persistLegistarVotes({}, { jurisdictionId: null, items: [{ votes: [{ personName: 'x', value: 'Aye' }] }] })).toEqual({ votesStored: 0, votesUnmatched: 0 });
  });
});

describe('Legistar votes and attachments in the fetch pipeline', () => {
  it('fetches the roll call per item and attachments per matter, and keeps them on the row', async () => {
    const deps = {
      startDate: '2019-12-17', endDate: '2019-12-17', includeMatterText: false,
      getVotes: vi.fn().mockResolvedValue([{ VotePersonName: 'Lynda Hopkins', VoteValueName: 'Aye', VotePersonId: 7 }]),
      getMatterAttachments: vi.fn().mockResolvedValue([{ MatterAttachmentName: 'Attachment A', MatterAttachmentHyperlink: 'https://sonoma-county.legistar1.com/a.pdf' }]),
    };
    vi.stubGlobal('fetch', vi.fn(async (url) => Response.json(String(url).includes('/EventItems')
      ? [{ EventItemId: 28386, EventItemMatterId: 5339, EventItemTitle: 'Tourism Impact Fund Awards' }]
      : [{ EventId: 2400, EventDate: '2019-12-17T00:00:00', EventAgendaStatusName: 'Final' }])));
    const { allItems } = await fetchLegistarAgendaItemsForDataSource({ legistarBaseUrl: 'https://webapi.legistar.com/v1/sonoma-county' }, deps);
    vi.unstubAllGlobals();
    expect(allItems[0].votes).toEqual([{ personName: 'Lynda Hopkins', value: 'Aye', legistarPersonId: 7 }]);
    const row = buildLegistarAgendaRow({ ...allItems[0], source: { cityName: 'Sonoma County', legistarBaseUrl: 'https://webapi.legistar.com/v1/sonoma-county' } });
    expect(row.itemText).toContain('Attachments: Attachment A');
    expect(row.legistarItemPayload.FairAttachments).toEqual([{ name: 'Attachment A', url: 'https://sonoma-county.legistar1.com/a.pdf' }]);
    expect(row.legistarItemPayload.FairVotes[0].value).toBe('Aye');
  });
});
