// Re-parse every Form 700 workbook already archived in Supabase Storage with
// the current parsers, replacing each filing's schedule rows in place (filing
// ids, politicians and conflict review history are kept), then re-run
// conflict detection. Use after parser improvements, e.g. full-row details and
// per-schedule amendment carry-forward.
//
//   node scripts/reparse-form700-filings.mjs           # dry run: shows the change per filing
//   node scripts/reparse-form700-filings.mjs --apply   # writes
//
// Requires migration 20261116000000_schedule_row_details.
import { pathToFileURL } from 'node:url';
import { importForm700Bulk, previewForm700Bulk } from '../src/ingestion/form700Bulk.js';

/** One archived workbook per original upload; every filing shares it. */
export function groupArchivedWorkbooks(filings) {
  const groups = new Map();
  for (const filing of filings) {
    if (!/\.xlsx$/i.test(filing.originalFilename ?? '') || !filing.archivedPath) continue;
    if (!groups.has(filing.originalFilename)) groups.set(filing.originalFilename, { filename: filing.originalFilename, path: filing.archivedPath, filingIds: [] });
    groups.get(filing.originalFilename).filingIds.push(filing.id);
  }
  return [...groups.values()];
}

export async function reparseWorkbook(buffer, group, { prisma, apply, redetect, log = console.log }) {
  const preview = await previewForm700Bulk(buffer, prisma);
  const targets = preview.filings.filter((filing) => group.filingIds.includes(filing.existing_filing_id));
  for (const filing of targets) {
    const counts = Object.entries(filing.schedules_parsed).map(([key, count]) => `${key}=${count}`).join(' ');
    log(`${apply ? 'REPLACE' : 'WOULD REPLACE'} ${filing.filer_name} ${filing.filing_year}: ${counts}`);
  }
  for (const warning of preview.warnings) log(`  note: ${warning}`);
  if (!apply) return { replaced: 0, planned: targets.length };
  const result = await importForm700Bulk(buffer, group.filename, { ...preview, filings: targets }, {
    prisma, replaceExisting: true,
    // Detection runs once per jurisdiction/year below, not once per filer.
    redetect: async () => ({ deferred: true }),
    // Keep each filing's existing archive; the workbook bytes are unchanged.
    archiveWorkbook: async (_buffer, _name, { existingPath }) => existingPath,
    deleteWorkbook: async () => {},
  });
  const scopes = new Map();
  for (const filing of targets) scopes.set(`${filing.jurisdiction_id}|${filing.filing_year}`, filing);
  const detection = [];
  for (const filing of scopes.values()) {
    detection.push(await redetect({ politicianId: filing.politician_id, filingYear: filing.filing_year, prisma }));
  }
  return { replaced: result.replaced, failed: result.failed, planned: targets.length, detectionPasses: detection.length };
}

async function main() {
  await import('../src/lib/env.js');
  const { prisma } = await import('../src/lib/prisma.js');
  const { getWorkbook } = await import('../src/lib/storage.js');
  const { redetectDisclosureAgendaItems } = await import('../src/detection/redetectDisclosure.js');
  const apply = process.argv.includes('--apply');
  try {
    const filings = await prisma.form700Filing.findMany({ select: { id: true, originalFilename: true, archivedPath: true } });
    for (const group of groupArchivedWorkbooks(filings)) {
      console.log(`\n== ${group.filename} (${group.filingIds.length} filings)`);
      const buffer = await getWorkbook(group.path);
      const result = await reparseWorkbook(buffer, group, { prisma, apply, redetect: redetectDisclosureAgendaItems });
      console.log(`   ${JSON.stringify(result)}`);
    }
    if (!apply) console.log('\nDry run only. Re-run with --apply to replace schedule rows.');
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}
