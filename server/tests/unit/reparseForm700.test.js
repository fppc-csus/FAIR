import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { groupArchivedWorkbooks, reparseWorkbook } from '../../scripts/reparse-form700-filings.mjs';

const workbook = readFileSync(new URL('../../../docs/County of Sonoma -- Form 700 (2019).xlsx', import.meta.url));

function prismaWithHopkins() {
  const tx = {
    scheduleAInvestment: { deleteMany: vi.fn(), createMany: vi.fn() },
    scheduleBRealEstate: { deleteMany: vi.fn(), createMany: vi.fn() },
    scheduleCdeIncome: { deleteMany: vi.fn(), createMany: vi.fn() },
    scheduleA2BusinessPosition: { deleteMany: vi.fn(), createMany: vi.fn() },
    form700Filing: { update: vi.fn() },
  };
  return {
    tx,
    jurisdiction: { findMany: vi.fn(async () => [{ id: 'county', name: 'County of Sonoma' }]) },
    politician: { findMany: vi.fn(async () => [{ id: 'hopkins', fullName: 'Lynda Hopkins' }]) },
    form700Filing: { findUnique: vi.fn(async ({ where }) => (where.politicianId_filingYear.politicianId === 'hopkins'
      ? { id: 'filing-hopkins', archivedPath: 'filings/hopkins/original.xlsx' } : null)) },
    $transaction: vi.fn(async (fn) => fn(tx)),
  };
}

describe('re-parsing archived Form 700 workbooks', () => {
  it('groups filings by their shared original workbook and skips PDFs', () => {
    expect(groupArchivedWorkbooks([
      { id: 'a', originalFilename: 'county.xlsx', archivedPath: 'p1' },
      { id: 'b', originalFilename: 'county.xlsx', archivedPath: 'p2' },
      { id: 'c', originalFilename: 'one.pdf', archivedPath: 'p3' },
    ])).toEqual([{ filename: 'county.xlsx', path: 'p1', filingIds: ['a', 'b'] }]);
  });

  it('dry run reports the plan without writing', async () => {
    const prisma = prismaWithHopkins();
    const log = vi.fn();
    const result = await reparseWorkbook(workbook, { filename: 'county.xlsx', filingIds: ['filing-hopkins'] }, { prisma, apply: false, log });
    expect(result).toEqual({ replaced: 0, planned: 1 });
    expect(log.mock.calls.flat().join('\n')).toContain('WOULD REPLACE Lynda Hopkins 2019: A=0 B=0 CDE=1 A2=1');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('replaces schedule rows in place, keeping the filing and its archive, with full row details', async () => {
    const prisma = prismaWithHopkins();
    const redetect = vi.fn(async () => ({ inserted: 1 }));
    const result = await reparseWorkbook(workbook, { filename: 'county.xlsx', filingIds: ['filing-hopkins'] }, { prisma, apply: true, redetect, log: () => {} });

    expect(result).toMatchObject({ replaced: 1, failed: 0, detectionPasses: 1 });
    expect(prisma.tx.scheduleCdeIncome.deleteMany).toHaveBeenCalledWith({ where: { filingId: 'filing-hopkins' } });
    const [income] = prisma.tx.scheduleCdeIncome.createMany.mock.calls[0][0].data;
    expect(income).toMatchObject({ filingId: 'filing-hopkins', politicianId: 'hopkins', sourceName: 'LandPaths', scheduleType: 'C' });
    expect(income.details.map(({ label }) => label)).toContain('YOUR BUSINESS POSITION');
    const [farm] = prisma.tx.scheduleA2BusinessPosition.createMany.mock.calls[0][0].data;
    expect(farm.entityName).toBe('Foggy River Farm');
    expect(prisma.tx.form700Filing.update.mock.calls[0][0].data).toMatchObject({ archivedPath: 'filings/hopkins/original.xlsx' });
    expect(redetect).toHaveBeenCalledWith(expect.objectContaining({ politicianId: 'hopkins', filingYear: 2019 }));
  });
});
