import * as XLSX from 'xlsx';
import { parseForm700Bulk } from '../parsers/form700Bulk.js';
import { normalizeHeader } from '../parsers/parserUtils.js';

// Independent, direct-column projection for the NetFile export used in this
// pilot. Unknown layouts fail visibly instead of silently validating themselves.
const FIELDS = {
  A: { entity_name: 'name of business entity', fair_market_value: 'fair market value', nature_of_investment: 'nature of investment' },
  A2: { entity_name: 'name of business entity or trust', fair_market_value: 'fair market value', nature_of_investment: 'nature of investment', business_position: 'your business position', gross_income_range: 'include your pro rata share of gross income to entity/trust' },
  B: { property_description: 'street address or precise location', city: 'city', fair_market_value: 'fair market value', nature_of_interest: 'nature of interest' },
  CDE: { source_name: 'name of source', amount: null },
};
const clean = value => String(value ?? '').trim() || null;
// `details` (the full labelled source row) is verified separately; this audit
// independently re-derives only the structured columns.
const canonical = row => JSON.stringify(Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'details').sort(([a], [b]) => a.localeCompare(b))));

export function compareScheduleRows(expected, actual) {
  const remaining = actual.map(row => canonical(row));
  const missing = [];
  for (const row of expected) {
    const index = remaining.indexOf(canonical(row));
    if (index < 0) missing.push(row);
    else remaining.splice(index, 1);
  }
  return { expected: expected.length, actual: actual.length, missing, unexpected: remaining.map(row => JSON.parse(row)), equal: !missing.length && !remaining.length };
}

export function auditForm700Workbook(buffer) {
  const parsed = parseForm700Bulk(buffer);
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const source = [];
  const unsupported = [];
  for (const name of workbook.SheetNames) {
    const match = name.match(/^schedule\s+(a-?2|a1?|b|c|d|e)\b/i);
    if (!match) { unsupported.push(name); continue; }
    const code = match[1].toUpperCase();
    const schedule = code.startsWith('A') ? (code.includes('2') ? 'A2' : 'A') : code === 'B' ? 'B' : 'CDE';
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: null });
    const headerIndex = rows.findIndex(row => row.some(cell => normalizeHeader(cell) === 'last name'));
    if (headerIndex < 0) throw new Error(`${name}: audit needs NetFile filer headers`);
    const headers = rows[headerIndex].map(normalizeHeader);
    const get = (row, key) => clean(row[headers.indexOf(key)]);
    const value = (row, key) => {
      const index = headers.findIndex(header => header === key || header.startsWith(`${key} `));
      if (index < 0) throw new Error(`${name}: audit does not support missing column ${key}`);
      return clean(row[index]);
    };
    for (let index = headerIndex + 1; index < rows.length; index++) {
      const row = rows[index];
      if (!get(row, 'last name') && !get(row, 'first name')) continue;
      const filer = [get(row, 'first name'), get(row, 'middle name'), get(row, 'last name')].filter(Boolean).join(' ');
      const data = {};
      for (const [field, column] of Object.entries(FIELDS[schedule])) {
        data[field] = value(row, column ?? (code === 'C' ? 'gross income received' : code === 'D' ? 'value' : 'amount'));
      }
      if (schedule === 'B') {
        data.city = data.city?.split(',')[0].trim().toLowerCase().replace(/\b\w/g, char => char.toUpperCase()) ?? null;
        data.county = get(row, 'county');
      }
      if (schedule === 'CDE') data.schedule_type = code;
      data.filing_id = null;
      source.push({ sheet: name, row: index + 1, filer, agency: get(row, 'agency'), year: Number(get(row, 'filing year')), filed: Number(get(row, 'filed date')), type: get(row, 'filing type'), schedule, data,
        uncoveredA2: schedule === 'A2' ? { incomeSources: get(row, 'list single sources of income of $10000 or more (separated by semicolon)'), investment: get(row, 'investment'), property: get(row, 'real property') } : null });
    }
  }
  const filings = parsed.filings.map(filing => {
    const owned = source.filter(row => row.filer === filing.filer_name && row.agency === filing.agency && row.year === filing.filing_year);
    const selected = owned.filter(row => filing.schedule_sources.some(source => source.sheet === row.sheet
      && source.filed_serial === row.filed && source.filing_type === row.type));
    const schedules = Object.fromEntries(Object.keys(FIELDS).map(schedule => [schedule, compareScheduleRows(selected.filter(row => row.schedule === schedule).map(row => row.data), filing.schedules[schedule])]));
    return { filer: filing.filer_name, agency: filing.agency, year: filing.filing_year, office: filing.office_title, filedAt: filing.filed_at, filingType: filing.filing_type,
      schedules, selectedSourceRows: selected.map(({ sheet, row, schedule }) => ({ sheet, row, schedule })),
      olderRowsNotActive: owned.filter(row => !selected.includes(row)).map(({ sheet, row, schedule, data }) => ({ sheet, row, schedule, data })),
      amendmentReviewRequired: filing.versions.length > 1,
      a2Coverage: selected.filter(row => row.schedule === 'A2').map(row => ({ sheet: row.sheet, row: row.row, ...row.uncoveredA2 })) };
  });
  return { digest: parsed.digest, warnings: parsed.warnings, unsupportedSheets: unsupported, filings, parsed,
    supportedFieldsReconcile: !unsupported.length && filings.every(filing => Object.values(filing.schedules).every(result => result.equal)),
    limitations: ['Compares supported columns only; not a completeness certification of the original disclosure.', 'Amendments apply per schedule: each schedule comes from the newest submission that contains it; rows in a schedule that an amendment replaced are listed as olderRowsNotActive.', 'Every non-empty source cell is retained in each row\'s details; this audit compares the structured columns only.', 'Filing year is not treated as a verified legal reporting period.'] };
}