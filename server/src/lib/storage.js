/**
 * Supabase Storage helpers for archiving raw Form 700 workbooks.
 *
 * Bucket: `form700-uploads` (private; see supabase/CONTEXT.md). Objects live at
 *   filings/<politicianId>/<filingId>/<timestamp>-<safe-filename>
 * so a filing's original XLSX can always be located from its DB row
 * (`form700_filings.archived_path`).
 */
import { supabase } from './supabase.js';

export const FORM700_BUCKET = 'form700-uploads';
export const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Strip path separators / odd characters so the filename is safe as an object key. */
export function sanitizeFilename(filename) {
  const base = String(filename ?? 'upload.xlsx')
    .split(/[\\/]/)
    .pop()
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 255);
  return base.length > 0 ? base : 'upload.xlsx';
}

export function buildWorkbookPath(filename, { filingId, politicianId }) {
  if (filingId === undefined || filingId === null || filingId === '') {
    throw new Error('[storage] archiveWorkbook requires filingId');
  }
  if (politicianId === undefined || politicianId === null || politicianId === '') {
    throw new Error('[storage] archiveWorkbook requires politicianId');
  }
  return `filings/${politicianId}/${filingId}/${Date.now()}-${sanitizeFilename(filename)}`;
}

/**
 * Upload a workbook buffer to the private bucket.
 * @param {Buffer} buffer raw XLSX bytes
 * @param {string} filename original filename (sanitized before use)
 * @param {{ filingId: number|string, politicianId: number|string }} ids
 * @returns {Promise<string>} the storage object path
 */
export async function archiveWorkbook(buffer, filename, { filingId, politicianId } = {}) {
  if (!Buffer.isBuffer(buffer)) {
    throw new Error('[storage] archiveWorkbook expects a Buffer');
  }

  const path = buildWorkbookPath(filename, { filingId, politicianId });

  const { error } = await supabase.storage.from(FORM700_BUCKET).upload(path, buffer, {
    contentType: /\.pdf$/i.test(filename) ? 'application/pdf' : XLSX_MIME,
    upsert: false,
  });

  if (error) {
    throw new Error(`[storage] upload failed for ${path}: ${error.message}`);
  }

  return path;
}

/**
 * Download a previously archived workbook.
 * @param {string} path storage object path returned by archiveWorkbook
 * @returns {Promise<Buffer>}
 */
export async function getWorkbook(path) {
  const { data, error } = await supabase.storage.from(FORM700_BUCKET).download(path);

  if (error || !data) {
    throw new Error(`[storage] download failed for ${path}: ${error?.message ?? 'no data'}`);
  }

  return Buffer.from(await data.arrayBuffer());
}

/**
 * Remove an archived workbook (e.g. to roll back after a failed DB transaction).
 * @param {string} path
 */
export async function deleteWorkbook(path) {
  const { error } = await supabase.storage.from(FORM700_BUCKET).remove([path]);

  if (error) {
    throw new Error(`[storage] delete failed for ${path}: ${error.message}`);
  }
}
