import { queueDetectionRun } from './detectionRuns.js';

// Create durable work in the metadata transaction. No detection may race ahead
// of commit; callers dispatch the returned IDs only after it succeeds.
export async function scheduleEligibilityReprocessing(tx, { kind, id, row, agendaItemIds, correctedFilingYear }) {
  if (kind === 'agenda') {
    const ids = [...new Set(agendaItemIds ?? [id])];
    const runs = [];
    for (const agendaItemId of ids) {
      runs.push((await tx.detectionRun.create({
        data: { trigger: 'eligibility_correction', status: 'queued', agendaItemId, filingYear: 1900 },
        select: { id: true },
      })).id);
    }
    return runs;
  }
  const filings = kind === 'filing' ? [row] : await tx.form700Filing.findMany({
    where: { politicianId: id }, select: { id: true, filingYear: true, politicianId: true },
  });
  const runs = [];
  for (const filing of filings) {
    runs.push((await tx.detectionRun.create({
      data: { trigger: 'eligibility_correction', status: 'queued', filingId: filing.id,
        filingYear: kind === 'filing' ? correctedFilingYear ?? filing.filingYear : filing.filingYear,
        politicianId: kind === 'filing' ? row.politicianId : id },
      select: { id: true },
    })).id);
  }
  return runs;
}

export function dispatchEligibilityReprocessing(ids, queue = queueDetectionRun) {
  for (const id of ids) queue(id);
}