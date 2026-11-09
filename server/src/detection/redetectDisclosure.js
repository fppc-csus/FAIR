import { detectAgendaConflictsSafely } from './detectAgendaConflictsSafely.js';
import { detectConflictsForAgendaItems } from './detectConflicts.js';

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

  const agendaItems = await prisma.agendaItem.findMany({
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