import * as XLSX from 'xlsx';
import { createHash } from 'node:crypto';
import { loadWorkbook, normalizeHeader } from './parserUtils.js';
import { parseScheduleA } from './scheduleA.js';
import { parseScheduleA2 } from './scheduleA2.js';
import { parseScheduleB } from './scheduleB.js';
import { parseScheduleCDE } from './scheduleCDE.js';

/**
 * Split NetFile exports by filer/agency/year before invoking the schedule
 * parsers. Amendments are applied per schedule (see `schedule_sources`). No writes.
 */
export function parseForm700Bulk(input) {
  const workbook = loadWorkbook(input);
  if (!workbook) throw new Error('Uploaded file is not a readable XLSX workbook.');
  const groups = new Map();
  const warnings = [];
  for (const name of workbook.SheetNames) {
    if (!/^schedule\s+[abcde]/i.test(name.trim())) continue;
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: null });
    const headerIndex = rows.findIndex(row => row.some(cell => normalizeHeader(cell) === 'last name'));
    if (headerIndex < 0) throw new Error(`${name}: bulk exports require filer columns on every schedule.`);
    const headers = rows[headerIndex].map(normalizeHeader);
    // Grouped columns carry a second header row (ACQUIRED / DISPOSED, A-2
    // investment and real-property columns). Keep it with every filer's slice.
    const next = rows[headerIndex + 1] ?? [];
    const subheader = !String(next[headers.indexOf('last name')] ?? '').trim() && next.some(Boolean) ? next : null;
    const field = (row, key) => String(row[headers.indexOf(key)] ?? '').trim();
    for (const [offset, row] of rows.slice(headerIndex + 1).entries()) {
      const first = field(row, 'first name');
      const last = field(row, 'last name');
      if (!first && !last) {
        const subheaders = ['acquired', 'disposed', 'business entity/name', 'description of business activity', 'street address or precise location', 'city', 'nature of interest (if other describe)', 'years remaining if leasehold', 'consideration (if other describe)', 'sale of (real property car boat etc)', 'name of the source (comission or rental income)', '(mm/dd/yyyy)'];
        if (row.filter(Boolean).every(cell => subheaders.includes(normalizeHeader(cell).replace(/\s+/g, ' ')))) continue;
        if (row.some(Boolean)) warnings.push(`${name}, row ${headerIndex + offset + 2}: no filer; row not imported.`);
        continue;
      }
      const agency = field(row, 'agency');
      const year = Number(field(row, 'filing year'));
      const filed = Number(field(row, 'filed date'));
      if (!first || !last || !agency || !Number.isInteger(year) || year < 1900 || year > 2100 || !Number.isFinite(filed) || filed < 1) {
        throw new Error(`${name}, row ${headerIndex + offset + 2}: missing or invalid filer, agency, year or filed date.`);
      }
      const filerName = [first, field(row, 'middle name'), last].filter(Boolean).join(' ');
      const key = JSON.stringify([filerName.toLowerCase(), agency.toLowerCase(), year]);
      if (!groups.has(key)) groups.set(key, { filer_name: filerName, agency, filing_year: year, office_title: field(row, 'position'), versions: new Map() });
      const group = groups.get(key);
      const versionKey = JSON.stringify([filed, field(row, 'filing type')]);
      if (!group.versions.has(versionKey)) group.versions.set(versionKey, { filed, filing_type: field(row, 'filing type'), sheets: new Map(), rowsBySheet: new Map(), source_rows: 0 });
      const version = group.versions.get(versionKey);
      if (!version.sheets.has(name)) version.sheets.set(name, subheader ? [rows[headerIndex], subheader] : [rows[headerIndex]]);
      version.sheets.get(name).push(row);
      version.rowsBySheet.set(name, (version.rowsBySheet.get(name) ?? 0) + 1);
      version.source_rows++;
    }
  }
  if (!groups.size) throw new Error('No filer-tagged Form 700 schedule rows found. Use the single-filing uploader for cover-page workbooks.');
  const filings = [...groups.values()].map(group => {
    const versions = [...group.versions.values()].sort((a, b) => b.filed - a.filed);
    if (versions.length > 1 && versions[0].filed === versions[1].filed) throw new Error(`${group.filer_name}: conflicting filing types at the same timestamp require review.`);
    // NetFile amendment exports contain only the schedules that were amended.
    // Take each schedule from the newest submission that includes it so an
    // amendment to Schedule A does not erase the original A-2, B, C, D or E.
    const sheetSources = new Map();
    for (const version of versions) {
      for (const [name, rows] of version.sheets) if (!sheetSources.has(name)) sheetSources.set(name, { version, rows });
    }
    const isolated = XLSX.utils.book_new();
    for (const [name, { rows }] of sheetSources) XLSX.utils.book_append_sheet(isolated, XLSX.utils.aoa_to_sheet(rows), name);
    const schedules = { A: parseScheduleA(isolated), B: parseScheduleB(isolated), CDE: parseScheduleCDE(isolated), A2: parseScheduleA2(isolated) };
    const parsed = Object.values(schedules).reduce((sum, rows) => sum + rows.length, 0);
    const sourceRows = [...sheetSources].reduce((sum, [name, { version }]) => sum + version.rowsBySheet.get(name), 0);
    if (parsed !== sourceRows) warnings.push(`${group.filer_name}: ${sourceRows - parsed} selected rows lack supported schedule data and were not imported.`);
    const scheduleSources = [...sheetSources].map(([sheet, { version }]) => ({ sheet, filed_serial: version.filed, filing_type: version.filing_type }));
    if (versions.length > 1) {
      const latest = scheduleSources.filter(source => source.filed_serial === versions[0].filed).map(source => source.sheet);
      const carried = scheduleSources.filter(source => source.filed_serial !== versions[0].filed).map(source => source.sheet);
      warnings.push(`${group.filer_name}: ${versions.length} submissions. Latest (${versions[0].filing_type}) supplies ${latest.join(', ') || 'no schedules'}${carried.length ? `; carried forward from earlier submissions: ${carried.join(', ')}` : ''}. Confirm no carried-forward interest was disposed of in the amendment.`);
    }
    const selected = versions[0];
    const { versions: ignored, ...metadata } = group;
    return { ...metadata, filed_at: new Date(Math.round((selected.filed - 25569) * 86400000)).toISOString(), filing_type: selected.filing_type, schedules, schedule_sources: scheduleSources, schedules_parsed: Object.fromEntries(Object.entries(schedules).map(([key, rows]) => [key, rows.length])), versions: versions.map(v => ({ filed_serial: v.filed, filing_type: v.filing_type, source_rows: v.source_rows })) };
  });
  const digest = createHash('sha256').update(Buffer.isBuffer(input) ? input : JSON.stringify(workbook)).digest('hex');
  return { digest, filings, warnings };
}