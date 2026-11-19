/**
 * Agenda items per detection transaction. Each batch locks its rows and runs
 * inside one interactive transaction; large syncs (thousands of items) in a
 * single transaction exceeded Prisma's timeout and failed with
 * "Transaction not found". A failing batch is reported and the rest continue.
 */
export const DETECTION_BATCH_SIZE = 50;

export async function detectAgendaConflictsSafely(
  agendaItemIds,
  detector,
  dependencies,
  { batchSize = DETECTION_BATCH_SIZE } = {},
) {
  const totals = {
    conflictCandidates: 0,
    conflictsDetected: 0,
    conflictsSkipped: 0,
    detectionErrors: [],
  };
  const ids = [...new Set(agendaItemIds ?? [])];

  for (let index = 0; index < ids.length; index += batchSize) {
    const batch = ids.slice(index, index + batchSize);
    try {
      const result = await detector(batch, dependencies);
      totals.conflictCandidates += result.totalCandidates ?? 0;
      totals.conflictsDetected += result.inserted ?? 0;
      totals.conflictsSkipped += result.skipped ?? 0;
    } catch (error) {
      const detail = {
        agendaItemIds: batch,
        message: error instanceof Error ? error.message : String(error),
      };
      console.error('[conflicts] agenda detection failed:', detail);
      totals.detectionErrors.push(detail);
    }
  }

  return totals;
}

export function getRetryableAgendaItemIds(detectionErrors) {
  if (!Array.isArray(detectionErrors)) return [];
  return [...new Set(detectionErrors.flatMap((error) => (
    Array.isArray(error?.agendaItemIds)
      ? error.agendaItemIds.filter((id) => typeof id === 'string' && id.length > 0)
      : []
  )))];
}
