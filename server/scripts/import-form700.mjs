import '../src/lib/env.js';
import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { prisma } from '../src/lib/prisma.js';
import { archiveWorkbook, deleteWorkbook } from '../src/lib/storage.js';
import { redetectDisclosureAgendaItems } from '../src/detection/redetectDisclosure.js';
import { previewForm700Bulk, importForm700Bulk } from '../src/ingestion/form700Bulk.js';

// Safe default: preview only. An explicit digest confirms the reviewed snapshot.
const [filename, digest] = process.argv.slice(2);
try {
  if (!filename) throw new Error('Usage: node scripts/import-form700.mjs /absolute/path/workbook.xlsx [confirmed-preview-digest]');
  const buffer = await readFile(resolve(filename));
  if (!filename.toLowerCase().endsWith('.xlsx') || buffer.length > 10 * 1024 * 1024) throw new Error('Expected an XLSX workbook no larger than 10 MB.');
  const preview = await previewForm700Bulk(buffer, prisma);
  if (!digest) console.log(JSON.stringify({ ...preview, filings: preview.filings.map(({ schedules, ...filing }) => filing) }, null, 2));
  else {
    if (digest !== preview.digest) throw new Error('Digest mismatch. Preview again before importing.');
    const result = await importForm700Bulk(buffer, basename(filename), preview, { prisma, archiveWorkbook, deleteWorkbook, redetect: redetectDisclosureAgendaItems });
    console.log(JSON.stringify(result, null, 2));
    if (result.failed) process.exitCode = 1;
  }
} catch (error) {
  console.error(error.message); process.exitCode = 1;
} finally { await prisma.$disconnect(); }