import { detectAgendaConflictsSafely } from './detectAgendaConflictsSafely.js';
import { detectConflictsForAgendaItems } from './detectConflicts.js';
import { eligibilityPolicy } from '../config/eligibilityPolicy.js';

/** Meetings a filing can apply to under the filing-period policy (default: filing year and the next). */
export function filingDecisionRange(filingYear, policy = eligibilityPolicy()) {
  const offsets = policy.period === 'YEAR_OFFSETS' && policy.offsets.length ? policy.offsets : [0];
  return {
    gte: new Date(Date.UTC(filingYear + Math.min(...offsets), 0, 1)),
    lt: new Date(Date.UTC(filingYear + Math.max(...offsets) + 1, 0, 1)),
  };
}

export async function redetectDisclosureAgendaItems({
  politicianId,
  filingYear,
  prisma,
  detect = detectConflictsForAgendaItems,
}) {
  const politician = await prisma.politician.findUnique({
    where: { id: politicianId },
    select: {
      jurisdictionId: true,
      jurisdiction: { select: { name: true } },
    },
  });
  const jurisdictionName = politician?.jurisdiction?.name?.trim();

  if (!politician?.jurisdictionId || !jurisdictionName) {
    return {
      agendaItemsProcessed: 0,
      conflictCandidates: 0,
      conflictsDetected: 0,
      conflictsSkipped: 0,
      detectionErrors: [],
      skippedReason: 'politician_jurisdiction_unresolved',
    };
  }

  const dateRange = filingDecisionRange(filingYear);
  // Agenda items carry the data source's name ("Sonoma County"), which need
  // not equal the Form 700 agency ("County of Sonoma"); use linked sources too.
  const sources = prisma.dataSource?.findMany
    ? await prisma.dataSource.findMany({ where: { jurisdictionId: politician.jurisdictionId }, select: { id: true, cityName: true } })
    : [];
  const cityNames = [...new Set([jurisdictionName, ...sources.map((source) => source.cityName)])];
  const agendaItems = await prisma.agendaItem.findMany({
    where: {
      OR: [
        { meetingDate: dateRange, cityName: { in: cityNames } },
        ...(sources.length ? [{ meetingDate: dateRange, cityId: { in: sources.map((source) => source.id) } }] : []),
        {
          meeting: {
            is: {
              jurisdictionId: politician.jurisdictionId,
              meetingDate: dateRange,
            },
          },
        },
      ],
    },
    select: { id: true },
  });
  const agendaItemIds = agendaItems.map(({ id }) => id);
  const detection = await detectAgendaConflictsSafely(
    agendaItemIds,
    detect,
    { prisma },
  );

  return {
    agendaItemsProcessed: agendaItemIds.length,
    ...detection,
    skippedReason: null,
  };
}

export default redetectDisclosureAgendaItems;