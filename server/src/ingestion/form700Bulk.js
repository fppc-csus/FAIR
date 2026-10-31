import { randomUUID } from 'node:crypto';
import { parseForm700Bulk } from '../parsers/form700Bulk.js';

const models = { A: 'scheduleAInvestment', B: 'scheduleBRealEstate', CDE: 'scheduleCdeIncome', A2: 'scheduleA2BusinessPosition' };
const camel = key => key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());

/** Exact, jurisdiction-scoped matching only; ambiguous identities require review. */
export async function previewForm700Bulk(buffer, prisma) {
  const parsed = parseForm700Bulk(buffer);
  const filings = [];
  for (const filing of parsed.filings) {
    const jurisdictions = await prisma.jurisdiction.findMany({ where: { name: { equals: filing.agency, mode: 'insensitive' } } });
    const jurisdiction = jurisdictions.length === 1 ? jurisdictions[0] : null;
    if (jurisdictions.length > 1) throw new Error(`Multiple jurisdictions named ${filing.agency}; resolve before importing.`);
    const candidates = jurisdiction ? await prisma.politician.findMany({ where: { jurisdictionId: jurisdiction.id, isDemo: false } }) : [];
    const normalize = name => name.toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
    const matches = candidates.filter(person => normalize(person.fullName) === normalize(filing.filer_name));
    if (matches.length > 1) throw new Error(`${filing.filer_name}: multiple exact profiles require reconciliation.`);
    const politician = matches[0];
    const existing = politician ? await prisma.form700Filing.findUnique({ where: { politicianId_filingYear: { politicianId: politician.id, filingYear: filing.filing_year } } }) : null;
    filings.push({ ...filing, jurisdiction_id: jurisdiction?.id ?? null, politician_id: politician?.id ?? null, status: existing ? 'skipped' : 'ready', existing_filing_id: existing?.id ?? null });
  }
  return { ...parsed, filings };
}

export async function importForm700Bulk(buffer, filename, preview, { prisma, archiveWorkbook, deleteWorkbook, redetect }) {
  const results = [];
  for (const filing of preview.filings) {
    if (filing.status === 'skipped') { results.push({ filer_name: filing.filer_name, status: 'skipped', filing_id: filing.existing_filing_id }); continue; }
    const filingId = randomUUID();
    const politicianId = filing.politician_id ?? randomUUID();
    let path;
    let committed = false;
    try {
      path = await archiveWorkbook(buffer, filename, { filingId, politicianId });
      const politician = await prisma.$transaction(async tx => {
        let jurisdictionId = filing.jurisdiction_id;
        if (!jurisdictionId) {
          const existing = await tx.jurisdiction.findFirst({ where: { name: { equals: filing.agency, mode: 'insensitive' } } });
          jurisdictionId = existing?.id ?? (await tx.jurisdiction.create({ data: { name: filing.agency, type: /^county/i.test(filing.agency) ? 'county' : 'agency' } })).id;
        }
        let person = filing.politician_id ? await tx.politician.findUnique({ where: { id: politicianId } }) : await tx.politician.create({ data: { id: politicianId, fullName: filing.filer_name, officeTitle: filing.office_title || 'Unknown', jurisdictionId, needsReview: true, slug: `${filing.filer_name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${politicianId.slice(0, 8)}` } });
        await tx.form700Filing.create({ data: { id: filingId, politicianId, filingYear: filing.filing_year, filerName: filing.filer_name, originalFilename: filename, filedAt: new Date(filing.filed_at), archivedPath: path, storagePath: path, importMetadata: { digest: preview.digest, filing_type: filing.filing_type, versions: filing.versions, selection: 'latest_submission_only', warnings: preview.warnings } } });
        for (const [schedule, rows] of Object.entries(filing.schedules)) {
          if (rows.length) await tx[models[schedule]].createMany({ data: rows.map(row => ({ ...Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'filing_id').map(([key, value]) => [camel(key), value])), filingId, politicianId })) });
        }
        return person;
      });
      committed = true;
      let detection;
      try { detection = await redetect({ politicianId, filingYear: filing.filing_year, prisma }); }
      catch { detection = { skippedReason: 'detection_failed_retry_required' }; }
      results.push({ filer_name: filing.filer_name, status: 'imported', filing_id: filingId, politician_id: politicianId, slug: politician.slug, schedules_parsed: filing.schedules_parsed, detection });
    } catch (error) {
      if (path && !committed) {
        try { await deleteWorkbook(path); } catch { console.error('[form700] archive cleanup failed', path); }
      }
      console.error('[form700] import failed', filing.filer_name, error.message);
      results.push({ filer_name: filing.filer_name, status: error.code === 'P2002' ? 'skipped' : 'failed', error: error.code === 'P2002' ? 'Duplicate filing or identity; refresh preview.' : 'Import failed; check server logs and storage before retrying.' });
    }
  }
  return { results, warnings: preview.warnings, imported: results.filter(r => r.status === 'imported').length, skipped: results.filter(r => r.status === 'skipped').length, failed: results.filter(r => r.status === 'failed').length };
}