import express from 'express';
import { prisma } from '../../lib/prisma.js';

const router = express.Router();
const PAGE_SIZE = 20;

function textArray(value) {
  return Array.isArray(value) ? value.filter(item => typeof item === 'string') : [];
}

function resultArray(value) {
  return Array.isArray(value) ? value.filter(item => item && typeof item === 'object') : [];
}

function runRow(run) {
  return {
    id: run.id,
    source: 'import-run',
    filename: run.originalFilename,
    digest: run.sourceDigest,
    createdAt: run.createdAt,
    status: run.status,
    imported: run.importedCount,
    skipped: run.skippedCount,
    failed: run.failedCount,
    warnings: textArray(run.warnings),
    results: resultArray(run.results),
  };
}

function legacyRows(filings, recordedFilingIds) {
  const groups = new Map();
  for (const filing of filings) {
    const metadata = filing.importMetadata && typeof filing.importMetadata === 'object' ? filing.importMetadata : {};
    const digest = typeof metadata.digest === 'string' ? metadata.digest : `legacy:${filing.id}`;
    if (recordedFilingIds.has(filing.id)) continue;
    if (!groups.has(digest)) groups.set(digest, {
      id: digest,
      source: 'filing-metadata',
      filename: filing.originalFilename ?? 'Unknown workbook',
      digest,
      createdAt: filing.createdAt,
      status: 'completed',
      imported: 0,
      skipped: 0,
      failed: 0,
      warnings: new Set(),
      results: [],
    });
    const group = groups.get(digest);
    group.imported += 1;
    if (filing.createdAt < group.createdAt) group.createdAt = filing.createdAt;
    for (const warning of textArray(metadata.warnings)) group.warnings.add(warning);
    group.results.push({
      filer_name: filing.filerName ?? filing.politician.fullName,
      filing_year: filing.filingYear,
      status: 'imported',
      filing_id: filing.id,
      slug: filing.politician.slug,
      jurisdiction: filing.politician.jurisdiction?.name ?? null,
      filing_type: metadata.filing_type ?? null,
      versions: Array.isArray(metadata.versions) ? metadata.versions : [],
      selection: metadata.selection ?? null,
      schedules_parsed: {
        A: filing._count.scheduleAInvestments,
        B: filing._count.scheduleBRealEstate,
        CDE: filing._count.scheduleCdeIncome,
        A2: filing._count.scheduleA2Positions,
      },
    });
  }
  return [...groups.values()].map(group => ({ ...group, warnings: [...group.warnings] }));
}

router.get('/', async (req, res, next) => {
  try {
    const page = Math.max(1, Number.parseInt(String(req.query.page ?? '1'), 10) || 1);
    const warningOnly = req.query.warningOnly === 'true';
    const status = String(req.query.status ?? '');
    const year = String(req.query.year ?? '');
    if (status && !['running', 'completed', 'partial', 'failed'].includes(status)) return res.status(400).json({ error: 'Invalid import status.' });
    if (year && !/^(19|20)\d{2}$/.test(year)) return res.status(400).json({ error: 'Filing year must be between 1900 and 2099.' });
    const search = String(req.query.search ?? '').trim().toLowerCase().slice(0, 160);
    const [runs, filings] = await Promise.all([
      prisma.form700ImportRun.findMany({ orderBy: { createdAt: 'desc' } }),
      prisma.form700Filing.findMany({
        include: {
          politician: { select: { fullName: true, slug: true, jurisdiction: { select: { name: true } } } },
          _count: { select: { scheduleAInvestments: true, scheduleBRealEstate: true, scheduleCdeIncome: true, scheduleA2Positions: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    // A later skipped/retry run must not hide the original successful import.
    const recordedFilingIds = new Set(runs.flatMap(run => resultArray(run.results))
      .filter(result => result.status === 'imported').map(result => result.filing_id));
    let rows = [...runs.map(runRow), ...legacyRows(filings, recordedFilingIds)]
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
    if (warningOnly) rows = rows.filter(row => row.warnings.length > 0 || row.failed > 0);
    if (status) rows = rows.filter(row => row.status === status);
    if (year) rows = rows.filter(row => row.results.some(result => String(result.filing_year) === year));
    if (search) rows = rows.filter(row => `${row.filename} ${row.results.map(result => result.filer_name ?? '').join(' ')}`.toLowerCase().includes(search));
    const total = rows.length;
    const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const safePage = Math.min(page, pageCount);
    return res.json({ data: rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE), pagination: { page: safePage, pageSize: PAGE_SIZE, pageCount, total } });
  } catch (error) { return next(error); }
});

export default router;