import { describe, expect, it, vi } from 'vitest';
import { redetectDisclosureAgendaItems } from '../../src/detection/redetectDisclosure.js';

describe('redetectDisclosureAgendaItems', () => {
  it('rechecks agenda items across jurisdictions and years', async () => {
    const prisma = {
      politician: { findUnique: vi.fn().mockResolvedValue({ jurisdictionId: 'jurisdiction-1', jurisdiction: { name: 'Test City' } }) },
      agendaItem: { findMany: vi.fn().mockResolvedValue([{ id: 'agenda-1' }, { id: 'agenda-2' }]) },
    };
    const detect = vi.fn().mockResolvedValue({ inserted: 1, skipped: 1, totalCandidates: 2 });

    const result = await redetectDisclosureAgendaItems({ politicianId: 'politician-1', filingYear: 2026, prisma, detect });

    expect(prisma.agendaItem.findMany).toHaveBeenCalledWith({ select: { id: true } });
    expect(detect).toHaveBeenCalledWith(['agenda-1', 'agenda-2'], { prisma });
    expect(result).toMatchObject({ agendaItemsProcessed: 2, conflictCandidates: 2, conflictsDetected: 1, conflictsSkipped: 1 });
  });

  it('still rechecks agendas when politician jurisdiction is unresolved, so stale matches are inactivated', async () => {
    const prisma = {
      politician: { findUnique: vi.fn().mockResolvedValue({ jurisdictionId: null, jurisdiction: null }) },
      agendaItem: { findMany: vi.fn().mockResolvedValue([{ id: 'agenda-1' }]) },
    };
    const detect = vi.fn().mockResolvedValue({ inserted: 0, skipped: 0, totalCandidates: 0 });

    const result = await redetectDisclosureAgendaItems({ politicianId: 'politician-1', filingYear: 2026, prisma, detect });

    expect(prisma.agendaItem.findMany).toHaveBeenCalledWith({ select: { id: true } });
    expect(detect).toHaveBeenCalledWith(['agenda-1'], { prisma });
    expect(result.skippedReason).toBeNull();
  });

  it('returns retryable failure details without throwing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const prisma = {
      politician: { findUnique: vi.fn().mockResolvedValue({ jurisdictionId: 'jurisdiction-1', jurisdiction: { name: 'Test City' } }) },
      agendaItem: { findMany: vi.fn().mockResolvedValue([{ id: 'agenda-1' }]) },
    };
    const result = await redetectDisclosureAgendaItems({
      politicianId: 'politician-1', filingYear: 2026, prisma,
      detect: vi.fn().mockRejectedValue(new Error('temporary detector failure')),
    });
    expect(result.detectionErrors).toEqual([{ agendaItemIds: ['agenda-1'], message: 'temporary detector failure' }]);
  });
});