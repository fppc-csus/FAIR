import { randomUUID } from 'node:crypto';
import { parseForm700Bulk } from '../parsers/form700Bulk.js';
import { findJurisdictionsByName } from '../utils/jurisdictionName.js';
import { createScheduleRows, deleteScheduleRows } from './scheduleRows.js';

/** Exact, jurisdiction-scoped matching only; ambiguous identities require review. */
export async function previewForm700Bulk(buffer, prisma) {
  const parsed = parseForm700Bulk(buffer);
  const filings = [];
  // Match "County of Sonoma" to an existing "Sonoma County" (etc.) rather than
  // creating a duplicate jurisdiction that agenda items can never resolve to.
  const allJurisdictions = await prisma.jurisdiction.findMany({ select: { id: true, name: true } });
  for (const filing of parsed.filings) {
    const jurisdictions = findJurisdictionsByName(allJurisdictions, filing.agency);
    const jurisdiction = jurisdictions.length === 1 ? jurisdictions[0] : null;
    if (jurisdictions.length > 1) throw new Error(`Multiple jurisdictions named ${filing.agency}; resolve before importing.`);
    const candidates = jurisdiction ? await prisma.politician.findMany({ where: { jurisdictionId: jurisdiction.id, isDemo: false } }) : [];
    const normalize = name => name.toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
    const matches = candidates.filter(person => normalize(person.fullName) === normalize(filing.filer_name));
    if (matches.length > 1) throw new Error(`${filing.filer_name}: multiple exact profiles require reconciliation.`);
    const politician = matches[0];
    const existing = politician ? await prisma.form700Filing.findUnique({ where: { politicianId_filingYear: { politicianId: politician.id, filingYear: filing.filing_year } } }) : null;
    filings.push({ ...filing, jurisdiction_id: jurisdiction?.id ?? null, politician_id: politician?.id ?? null, status: existing ? 'skipped' : 'ready', existing_filing_id: existing?.id ?? null, existing_archived_path: existing?.archivedPath ?? null });
  }
  return { ...parsed, filings };
}

function importMetadata(preview, filing) {
  return { digest: preview.digest, filing_type: filing.filing_type, versions: filing.versions, schedule_sources: filing.schedule_sources, selection: 'latest_per_schedule', warnings: preview.warnings };
}

/**
 * Replace an existing filing's schedule rows with a fresh parse (corrected
 * workbook, or re-parsing after parser improvements). The filing id is kept so
 * review history stays attached; conflict detection reconciles afterwards.
 */
async function replaceExistingFiling(buffer, filename, preview, filing, { prisma, archiveWorkbook, redetect }) {
  const filingId = filing.existing_filing_id;
  const politicianId = filing.politician_id;
  const path = await archiveWorkbook(buffer, filename, { filingId, politicianId, existingPath: filing.existing_archived_path });
  await prisma.$transaction(async tx => {
    await deleteScheduleRows(tx, filingId);
    await createScheduleRows(tx, filing.schedules, { filingId, politicianId });
    await tx.form700Filing.update({ where: { id: filingId }, data: {
      filerName: filing.filer_name, originalFilename: filename, filedAt: new Date(filing.filed_at),
      archivedPath: path, storagePath: path, importMetadata: importMetadata(preview, filing),
    } });
  });
  let detection;
  try { detection = await redetect({ politicianId, filingYear: filing.filing_year, prisma }); }
  catch { detection = { skippedReason: 'detection_failed_retry_required' }; }
  return { filing_id: filingId, politician_id: politicianId, schedules_parsed: filing.schedules_parsed, detection };
}

export async function importForm700Bulk(buffer, filename, preview, { prisma, archiveWorkbook, deleteWorkbook, redetect, replaceExisting = false }) {
  const results = [];
  for (const filing of preview.filings) {
    const details = { filer_name: filing.filer_name, filing_year: filing.filing_year, jurisdiction: filing.agency, filing_type: filing.filing_type, filed_at: filing.filed_at, versions: filing.versions, selection: 'latest_per_schedule', schedule_sources: filing.schedule_sources };
    if (filing.status === 'skipped' && replaceExisting && filing.existing_filing_id && filing.politician_id) {
      try {
        results.push({ ...details, status: 'replaced', ...(await replaceExistingFiling(buffer, filename, preview, filing, { prisma, archiveWorkbook, redetect })) });
      } catch (error) {
        console.error('[form700] replace failed', filing.filer_name, error.message);
        results.push({ ...details, status: 'failed', filing_id: filing.existing_filing_id, error: 'Replacement failed; the original filing data is unchanged.' });
      }
      continue;
    }
    if (filing.status === 'skipped') { results.push({ ...details, status: 'skipped', filing_id: filing.existing_filing_id }); continue; }
    const filingId = randomUUID();
    const politicianId = filing.politician_id ?? randomUUID();
    let path;
    let committed = false;
    try {
      path = await archiveWorkbook(buffer, filename, { filingId, politicianId });
      const politician = await prisma.$transaction(async tx => {
        let jurisdictionId = filing.jurisdiction_id;
        if (!jurisdictionId) {
          const [existing] = findJurisdictionsByName(await tx.jurisdiction.findMany({ select: { id: true, name: true } }), filing.agency);
          jurisdictionId = existing?.id ?? (await tx.jurisdiction.create({ data: { name: filing.agency, type: /^county/i.test(filing.agency) ? 'county' : 'agency' } })).id;
        }
        let person = filing.politician_id ? await tx.politician.findUnique({ where: { id: politicianId } }) : await tx.politician.create({ data: { id: politicianId, fullName: filing.filer_name, officeTitle: filing.office_title || 'Unknown', jurisdictionId, needsReview: true, slug: `${filing.filer_name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${politicianId.slice(0, 8)}` } });
        await tx.form700Filing.create({ data: { id: filingId, politicianId, filingYear: filing.filing_year, filerName: filing.filer_name, originalFilename: filename, filedAt: new Date(filing.filed_at), archivedPath: path, storagePath: path, importMetadata: importMetadata(preview, filing) } });
        await createScheduleRows(tx, filing.schedules, { filingId, politicianId });
        return person;
      });
      committed = true;
      let detection;
      try { detection = await redetect({ politicianId, filingYear: filing.filing_year, prisma }); }
      catch { detection = { skippedReason: 'detection_failed_retry_required' }; }
      results.push({ ...details, status: 'imported', filing_id: filingId, politician_id: politicianId, slug: politician.slug, schedules_parsed: filing.schedules_parsed, detection });
    } catch (error) {
      if (path && !committed) {
        try { await deleteWorkbook(path); } catch { console.error('[form700] archive cleanup failed', path); }
      }
      console.error('[form700] import failed', filing.filer_name, error.message);
      results.push({ ...details, status: error.code === 'P2002' ? 'skipped' : 'failed', error: error.code === 'P2002' ? 'Duplicate filing or identity; refresh preview.' : 'Import failed; check server logs and storage before retrying.' });
    }
  }
  return { results, warnings: preview.warnings, replaced: results.filter(r => r.status === 'replaced').length, imported: results.filter(r => r.status === 'imported').length, skipped: results.filter(r => r.status === 'skipped').length, failed: results.filter(r => r.status === 'failed').length };
}