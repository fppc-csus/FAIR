import { expect, it, vi } from 'vitest';
import { scheduleEligibilityReprocessing, dispatchEligibilityReprocessing } from '../../src/detection/scheduleEligibilityReprocessing.js';

function database(filings = []) {
  let index = 0;
  return {
    form700Filing: { findMany: vi.fn().mockResolvedValue(filings) },
    detectionRun: { create: vi.fn(async () => ({ id: `run-${++index}` })) },
  };
}

it('queues all filings after a politician jurisdiction is confirmed, not only the first year', async () => {
  const tx = database([{ id: 'filing-1', filingYear: 2024 }, { id: 'filing-2', filingYear: 2025 }]);
  expect(await scheduleEligibilityReprocessing(tx, { kind: 'politician', id: 'politician' })).toEqual(['run-1', 'run-2']);
  expect(tx.detectionRun.create.mock.calls.map(([call]) => call.data.filingId)).toEqual(['filing-1', 'filing-2']);
});

it('creates one rerun per affected agenda item and deduplicates linked item IDs', async () => {
  const tx = database();
  expect(await scheduleEligibilityReprocessing(tx, { kind: 'agenda', id: 'a', agendaItemIds: ['a', 'b', 'a'] })).toEqual(['run-1', 'run-2']);
  expect(tx.detectionRun.create.mock.calls.map(([call]) => call.data.agendaItemId)).toEqual(['a', 'b']);
});

it('dispatches only after the caller commits its transaction', () => {
  const queue = vi.fn();
  dispatchEligibilityReprocessing(['run-1', 'run-2'], queue);
  expect(queue.mock.calls).toEqual([['run-1'], ['run-2']]);
});