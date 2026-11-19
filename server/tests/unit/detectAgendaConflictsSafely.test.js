import { describe, expect, it, vi } from 'vitest';
import { detectAgendaConflictsSafely } from '../../src/detection/detectAgendaConflictsSafely.js';

describe('detectAgendaConflictsSafely', () => {
  it('splits large syncs into separate transactions and sums the results', async () => {
    const detector = vi.fn(async (ids) => ({ totalCandidates: ids.length, inserted: 1, skipped: 0 }));
    const ids = Array.from({ length: 120 }, (_, index) => `item-${index}`);
    const result = await detectAgendaConflictsSafely(ids, detector, {}, { batchSize: 50 });
    expect(detector.mock.calls.map(([batch]) => batch.length)).toEqual([50, 50, 20]);
    expect(result).toMatchObject({ conflictCandidates: 120, conflictsDetected: 3, detectionErrors: [] });
  });

  it('keeps going after a failed batch and reports only that batch for retry', async () => {
    const detector = vi.fn()
      .mockRejectedValueOnce(new Error('Transaction not found'))
      .mockResolvedValueOnce({ totalCandidates: 2, inserted: 2, skipped: 0 });
    const result = await detectAgendaConflictsSafely(['a', 'b', 'c', 'd'], detector, {}, { batchSize: 2 });
    expect(result.conflictsDetected).toBe(2);
    expect(result.detectionErrors).toEqual([{ agendaItemIds: ['a', 'b'], message: 'Transaction not found' }]);
  });

  it('does nothing for an empty list', async () => {
    const detector = vi.fn();
    expect((await detectAgendaConflictsSafely([], detector)).conflictsDetected).toBe(0);
    expect(detector).not.toHaveBeenCalled();
  });
});
