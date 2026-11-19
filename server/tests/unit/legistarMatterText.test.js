import { describe, expect, it, vi } from 'vitest';
import { buildLegistarAgendaRow, cleanMatterText, MAX_MATTER_TEXT_CHARS } from '../../src/ingestion/legistarAgendaRow.js';
import { fetchMatterTexts } from '../../src/ingestion/legistar.js';
import { matchNamedEntity, scoreEntityInText } from '../../src/detection/matchEntity.js';

const SONOMA_MATTER_TEXT = `To: Board of Supervisors
Title:
..Title
Fiscal Year 2019-2020 Tourism Impact Fund Awards
..End

Recommended Action:
..Recommended action
A) Authorize the County Administrator, or designee, to execute agreements for a total of $102,000 with grantees: Boys and Girls Club of Sonoma Valley, $30,000; Sonoma Ecology Center, $10,000; LandPaths, $20,000; Pacific Coast Air Museum, $2,000;
..end`;

describe('Legistar matter text', () => {
  it('stores the recommended action so grantees named only there are searchable', async () => {
    const row = buildLegistarAgendaRow({
      source: { id: 'src', cityName: 'Sonoma County', legistarBaseUrl: 'https://webapi.legistar.com/v1/sonoma-county' },
      meeting: { EventDate: '2019-12-17T00:00:00', EventBodyName: 'Board of Supervisors' },
      meetingId: 2400,
      item: { EventItemId: 28386, EventItemMatterId: 5339, EventItemTitle: 'Fiscal Year 2019-2020 Tourism Impact Fund Awards', EventItemAgendaNumber: '15.' },
      matterText: SONOMA_MATTER_TEXT,
    });

    expect(row).toMatchObject({ legistarItemId: 'sonoma-county:28386', legistarMatterId: '5339', cityName: 'Sonoma County', agendaNumber: '15.' });
    expect(row.itemText).toContain('LandPaths, $20,000');
    expect(row.itemText).not.toMatch(/^\.\.Title$/m);
    expect((await matchNamedEntity('LandPaths', row.itemText)).matched).toBe(true);
  });

  it('falls back to the title when no matter text exists and caps oversized text', () => {
    const row = buildLegistarAgendaRow({ source: { legistarBaseUrl: 'https://webapi.legistar.com/v1/x' }, meetingId: 1, item: { EventItemId: 1, EventItemTitle: 'Consent' } });
    expect(row.itemText).toBe('Consent');
    expect(cleanMatterText('x'.repeat(MAX_MATTER_TEXT_CHARS + 50))).toHaveLength(MAX_MATTER_TEXT_CHARS);
    expect(cleanMatterText('  ')).toBeNull();
  });

  it('fetches the latest text once per matter and tolerates failures', async () => {
    const getVersions = vi.fn(async (_base, id) => {
      if (id === '9') throw new Error('timeout');
      return [{ Key: '10', Value: '1' }, { Key: '11', Value: '2' }];
    });
    const getText = vi.fn(async (_base, id, textId) => ({ MatterTextPlain: `matter ${id} text ${textId}` }));
    const result = await fetchMatterTexts('https://webapi.legistar.com/v1/x', [5, 5, null, 9], { getVersions, getText });

    expect(getVersions).toHaveBeenCalledTimes(2);
    expect(result.texts.get('5')).toBe('matter 5 text 11');
    expect(result.failures).toBe(1);
  });

  it('still finds an exact name deep inside a long staff report', () => {
    const filler = Array.from({ length: 2000 }, (_, index) => `word${index}`).join(' ');
    expect(scoreEntityInText('LandPaths', `${filler} LandPaths grant`)).toBe(1);
  });
});
