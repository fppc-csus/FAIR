import { describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parseForm700Bulk } from '../../src/parsers/form700Bulk.js';
import { previewForm700Bulk, importForm700Bulk } from '../../src/ingestion/form700Bulk.js';

function fixture(rows = [
  ['One', 'Alice', 'County Test', 'Supervisor', 2019, 44000, 'Annual', 'Alice Corp'],
  ['Two', 'Bob', 'County Test', 'Treasurer', 2019, 44000, 'Annual', 'Bob Corp'],
  ['One', 'Alice', 'County Test', 'Supervisor', 2019, 44001, 'Amendment - Annual', 'New Corp'],
]) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Last Name', 'First Name', 'Agency', 'Position', 'Filing Year', 'Filed Date', 'Filing Type', 'NAME OF BUSINESS ENTITY'], ...rows]), 'Schedule A1');
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
}

function dependencies() {
  const prisma = {
    jurisdiction: { findMany: vi.fn().mockResolvedValue([{ id: 'county' }]), findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: 'new-county' }) },
    politician: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockImplementation(async ({ data }) => data), findUnique: vi.fn().mockResolvedValue({ id: 'person', slug: 'alice' }) },
    form700Filing: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}) },
    scheduleAInvestment: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
  prisma.$transaction = vi.fn(fn => fn(prisma));
  return { prisma, archiveWorkbook: vi.fn().mockResolvedValue('archive.xlsx'), deleteWorkbook: vi.fn().mockResolvedValue(undefined), redetect: vi.fn().mockResolvedValue({ skippedReason: null }) };
}

describe('bulk Form 700 parser', () => {
  it('separates filers and selects one latest submission without mixing versions', () => {
    const parsed = parseForm700Bulk(fixture());
    expect(parsed.filings).toHaveLength(2);
    expect(parsed.filings[0].schedules.A.map(row => row.entity_name)).toEqual(['New Corp']);
    expect(parsed.filings[1].schedules.A.map(row => row.entity_name)).toEqual(['Bob Corp']);
    expect(parsed.filings[0].versions).toHaveLength(2);
    expect(parsed.warnings.join(' ')).toContain('Missing schedules');
    expect(parseForm700Bulk(fixture()).digest).toBe(parsed.digest);
  });
  it('rejects malformed identity metadata and unreadable or unsupported input', () => {
    expect(() => parseForm700Bulk(fixture([['One', 'Alice', '', '', 2019, 44000, 'Annual', 'Corp']]))).toThrow('missing or invalid');
    expect(() => parseForm700Bulk(Buffer.from('bad'))).toThrow();
    expect(() => parseForm700Bulk(null)).toThrow('readable');
  });
  it('rejects two submission types at the same latest timestamp', () => {
    expect(() => parseForm700Bulk(fixture([
      ['One', 'Alice', 'County Test', '', 2019, 44000, 'Annual', 'Corp'],
      ['One', 'Alice', 'County Test', '', 2019, 44000, 'Amendment', 'Corp'],
    ]))).toThrow('conflicting filing types');
  });
  it('reports unowned rows instead of silently dropping them', () => {
    const parsed = parseForm700Bulk(fixture([['One', 'Alice', 'County Test', '', 2019, 44000, 'Annual', 'Corp'], [null, null, null, null, null, null, null, 'Orphan Corp']]));
    expect(parsed.warnings.join(' ')).toContain('no filer');
  });
  it('parses the Sonoma workbook into 13 distinct filer/year groups', () => {
    const parsed = parseForm700Bulk(readFileSync(new URL('../../../docs/County of Sonoma -- Form 700 (2019).xlsx', import.meta.url)));
    expect(parsed.filings).toHaveLength(13);
    expect(parsed.filings.reduce((sum, filing) => sum + filing.versions.length, 0)).toBe(20);
    expect(parsed.filings.every(filing => filing.filing_year === 2019)).toBe(true);
    expect(parsed.warnings).toHaveLength(2);
  });
  it('requires a file argument in the trusted CLI without importing anything', () => {
    const result = spawnSync(process.execPath, ['scripts/import-form700.mjs'], { cwd: process.cwd(), encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Usage:');
  });
});

describe('bulk Form 700 persistence', () => {
  it('previews without writes and only matches exact names in the source jurisdiction', async () => {
    const deps = dependencies();
    deps.prisma.politician.findMany.mockResolvedValue([{ id: 'alice', fullName: 'Alice One' }]);
    deps.prisma.form700Filing.findUnique.mockResolvedValue({ id: 'existing' });
    const preview = await previewForm700Bulk(fixture(), deps.prisma);
    expect(preview.filings[0]).toMatchObject({ politician_id: 'alice', status: 'skipped' });
    expect(preview.filings[1]).toMatchObject({ politician_id: null, status: 'ready' });
    expect(deps.prisma.politician.findMany).toHaveBeenCalledWith({ where: { jurisdictionId: 'county', isDemo: false } });
    expect(deps.prisma.$transaction).not.toHaveBeenCalled();
  });
  it('rejects ambiguous jurisdictions and duplicate exact identities', async () => {
    const deps = dependencies();
    deps.prisma.jurisdiction.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    await expect(previewForm700Bulk(fixture(), deps.prisma)).rejects.toThrow('Multiple jurisdictions');
    deps.prisma.jurisdiction.findMany.mockResolvedValue([{ id: 'a' }]);
    deps.prisma.politician.findMany.mockResolvedValue([{ fullName: 'Alice One' }, { fullName: 'Alice One' }]);
    await expect(previewForm700Bulk(fixture(), deps.prisma)).rejects.toThrow('multiple exact');
  });
  it('archives, imports scoped rows and metadata, then runs detection per filer', async () => {
    const deps = dependencies(); const buffer = fixture();
    const preview = await previewForm700Bulk(buffer, deps.prisma);
    const result = await importForm700Bulk(buffer, 'county.xlsx', preview, deps);
    expect(result).toMatchObject({ imported: 2, skipped: 0, failed: 0 });
    expect(deps.prisma.form700Filing.create.mock.calls[0][0].data.importMetadata.versions).toHaveLength(2);
    const first = deps.prisma.scheduleAInvestment.createMany.mock.calls[0][0].data[0];
    const second = deps.prisma.scheduleAInvestment.createMany.mock.calls[1][0].data[0];
    expect(first.entityName).toBe('New Corp'); expect(second.entityName).toBe('Bob Corp');
    expect(first.politicianId).not.toBe(second.politicianId);
    expect(deps.prisma.politician.create.mock.calls[0][0].data).toMatchObject({ needsReview: true, jurisdictionId: 'county' });
    expect(deps.redetect).toHaveBeenCalledTimes(2);
  });
  it('skips existing filings without writing or archiving', async () => {
    const deps = dependencies(); const preview = await previewForm700Bulk(fixture(), deps.prisma);
    preview.filings.forEach(f => { f.status = 'skipped'; f.existing_filing_id = 'existing'; });
    expect(await importForm700Bulk(fixture(), 'county.xlsx', preview, deps)).toMatchObject({ skipped: 2, imported: 0 });
    expect(deps.archiveWorkbook).not.toHaveBeenCalled();
  });
  it('cleans archives after failed transactions and reports failures independently', async () => {
    const deps = dependencies(); const preview = await previewForm700Bulk(fixture(), deps.prisma);
    deps.prisma.$transaction.mockRejectedValueOnce(new Error('DB failed'));
    const result = await importForm700Bulk(fixture(), 'county.xlsx', preview, deps);
    expect(result).toMatchObject({ imported: 1, failed: 1 });
    expect(deps.deleteWorkbook).toHaveBeenCalledWith('archive.xlsx');
  });
  it('does not delete committed data when detection fails', async () => {
    const deps = dependencies(); const preview = await previewForm700Bulk(fixture(), deps.prisma);
    deps.redetect.mockRejectedValue(new Error('detection failed'));
    const result = await importForm700Bulk(fixture(), 'county.xlsx', preview, deps);
    expect(result.imported).toBe(2);
    expect(result.results[0].detection.skippedReason).toContain('retry');
    expect(deps.deleteWorkbook).not.toHaveBeenCalled();
  });
  it('creates missing jurisdictions and reports archive failures without DB writes', async () => {
    const deps = dependencies(); deps.prisma.jurisdiction.findMany.mockResolvedValue([]);
    const preview = await previewForm700Bulk(fixture(), deps.prisma);
    deps.archiveWorkbook.mockRejectedValueOnce(new Error('Storage unavailable'));
    const result = await importForm700Bulk(fixture(), 'county.xlsx', preview, deps);
    expect(result).toMatchObject({ imported: 1, failed: 1 });
    expect(deps.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(deps.prisma.jurisdiction.create).toHaveBeenCalled();
  });
});