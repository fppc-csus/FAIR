/**
 * Persist Legistar roll-call votes as vote_records so investigators can see
 * whether an official with a disclosed interest voted on (or recused from) an
 * item. Legistar names ("Lynda Hopkins") are matched to politicians in the
 * source's jurisdiction by first and last name, which tolerates middle names
 * and initials on Form 700 filings ("James M Gore" ↔ "James Gore").
 * Unmatched names (e.g. members with no Form 700 in FAIR) are counted, not stored.
 */
import { normalizeEntityName } from '../utils/entityNorm.js';

function nameKey(fullName) {
  const words = normalizeEntityName(fullName).split(' ')
    .filter((word) => word && !['jr', 'sr', 'ii', 'iii', 'iv'].includes(word));
  return words.length >= 2 ? `${words[0]}|${words.at(-1)}` : null;
}

export function matchVotesToPoliticians(votes, politicians) {
  const byKey = new Map();
  for (const politician of politicians) {
    const key = nameKey(politician.fullName);
    if (!key) continue;
    // Two officials sharing first+last name in one jurisdiction are ambiguous.
    byKey.set(key, byKey.has(key) ? null : politician.id);
  }
  return votes.map((vote) => ({ ...vote, politicianId: byKey.get(nameKey(vote.personName)) ?? null }));
}

/**
 * @param prisma Prisma client
 * @param {{ jurisdictionId: string|null, items: { legistarItemId: string, meetingDate: Date|null, votes: {personName: string, value: string}[] }[] }} input
 */
export async function persistLegistarVotes(prisma, { jurisdictionId, items }) {
  const withVotes = items.filter((item) => item.votes?.length);
  if (!jurisdictionId || !withVotes.length || !prisma?.voteRecord?.upsert) {
    return { votesStored: 0, votesUnmatched: 0 };
  }
  const [politicians, agendaItems] = await Promise.all([
    prisma.politician.findMany({ where: { jurisdictionId, isDemo: false }, select: { id: true, fullName: true } }),
    prisma.agendaItem.findMany({
      where: { legistarItemId: { in: withVotes.map((item) => item.legistarItemId) } },
      select: { id: true, legistarItemId: true },
    }),
  ]);
  const agendaIds = new Map(agendaItems.map((row) => [row.legistarItemId, row.id]));
  let votesStored = 0;
  let votesUnmatched = 0;
  for (const item of withVotes) {
    const agendaItemId = agendaIds.get(item.legistarItemId);
    if (!agendaItemId) continue;
    for (const vote of matchVotesToPoliticians(item.votes, politicians)) {
      if (!vote.politicianId) { votesUnmatched += 1; continue; }
      await prisma.voteRecord.upsert({
        where: { agendaItemId_politicianId: { agendaItemId, politicianId: vote.politicianId } },
        create: { agendaItemId, politicianId: vote.politicianId, vote: vote.value, voteDate: item.meetingDate ?? null },
        update: { vote: vote.value, voteDate: item.meetingDate ?? null },
      });
      votesStored += 1;
    }
  }
  return { votesStored, votesUnmatched };
}
