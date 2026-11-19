/**
 * Shared helpers for the Form 700 XLSX parsers (Schedules A, A-2, B, C/D/E and
 * the cover page).
 *
 * Every parser is PURE: it accepts a Buffer (or an already-read SheetJS
 * workbook), never touches the database and never throws — bad input yields
 * `null` / `[]` so the upload route can decide how to respond.
 */
import * as XLSX from "xlsx";

/** Read a workbook from a Buffer, file path or pass through a workbook object. */
export function loadWorkbook(input) {
  try {
    if (!input) return null;

    if (Buffer.isBuffer(input)) {
      return XLSX.read(input, { type: "buffer" });
    }

    if (input instanceof Uint8Array) {
      return XLSX.read(Buffer.from(input), { type: "buffer" });
    }

    if (typeof input === "string") {
      return XLSX.readFile(input);
    }

    // Already-parsed workbook (e.g. the upload route reads it once and shares it).
    if (typeof input === "object" && Array.isArray(input.SheetNames) && input.Sheets) {
      return input;
    }

    return null;
  } catch {
    return null;
  }
}

export function normalizeCellValue(value) {
  if (value === undefined || value === null) {
    return "";
  }

  if (typeof value === "string") {
    return value.trim();
  }

  return String(value).trim();
}

/** `null` instead of "" for empty cells — used for nullable DB columns. */
export function cleanText(value) {
  const text = normalizeCellValue(value);
  return text === "" ? null : text;
}

/** "hello  WORLD" → "Hello World". Returns null for empty input. */
export function toTitleCase(value) {
  const text = cleanText(value);
  if (!text) return null;

  return text
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function normalizeHeader(value) {
  return normalizeCellValue(value)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\w\s/$()-]/g, "")
    .trim();
}

/** Find the first sheet whose name contains any keyword (case-insensitive). */
export function findSheetName(workbook, keywords = [], { exclude = [] } = {}) {
  if (!workbook || !Array.isArray(workbook.SheetNames)) {
    return null;
  }

  const loweredKeywords = keywords.map((keyword) => keyword.toLowerCase());
  const loweredExclude = exclude.map((keyword) => keyword.toLowerCase());

  const matched = workbook.SheetNames.find((sheetName) => {
    const lowered = normalizeHeader(sheetName);
    if (loweredExclude.some((keyword) => lowered.includes(keyword))) return false;
    return loweredKeywords.some((keyword) => lowered.includes(keyword));
  });

  return matched ?? null;
}

export function findSheetByName(workbook, keywords = [], options = {}) {
  const name = findSheetName(workbook, keywords, options);
  return name ? workbook.Sheets[name] : null;
}

/** Sheet → array of arrays (no header inference). */
export function sheetToRows(sheet) {
  if (!sheet) return [];
  try {
    return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: false });
  } catch {
    return [];
  }
}

/**
 * Locate the header row: the first row (within `maxScan`) containing a cell
 * whose normalized text starts with one of `keywords`. Real Form 700 exports put
 * section titles ("1. Business Entity or Trust…") above the column headers, so
 * the header is not always row 0.
 */
export function findHeaderRowIndex(sheet, keywords = [], maxScan = 15) {
  const rows = sheetToRows(sheet);
  const normalizedKeywords = keywords.map(normalizeHeader);

  for (let i = 0; i < Math.min(rows.length, maxScan); i += 1) {
    const cells = (rows[i] ?? []).map(normalizeHeader);
    const hit = cells.some((cell) =>
      cell !== "" && normalizedKeywords.some((keyword) => cell.startsWith(keyword)),
    );
    if (hit) return i;
  }

  return -1;
}

/** Sheet → array of objects keyed by the header row at `headerRowIndex`. */
export function sheetToObjects(sheet, headerRowIndex = 0) {
  if (!sheet || headerRowIndex < 0) {
    return [];
  }

  try {
    return XLSX.utils.sheet_to_json(sheet, {
      defval: "",
      raw: false,
      range: headerRowIndex,
    });
  } catch {
    return [];
  }
}

/**
 * Read a cell by header name. Headers in the FPPC exports carry line breaks and
 * hints ("FAIR MARKET VALUE\r\n(Select from drop down list)"), so we first try
 * an exact normalized match and then fall back to a prefix match, preserving
 * column order so the left-most matching column wins. Pass `{ exact: true }`
 * for short generic labels ("Name") that would otherwise prefix-match unrelated
 * columns ("NAME OF BUSINESS ENTITY").
 */
export function getField(row, possibleKeys = [], { exact = false } = {}) {
  if (!row || typeof row !== "object") return "";

  const normalizedEntries = Object.entries(row).map(([key, value]) => [
    normalizeHeader(key),
    value,
  ]);

  for (const possibleKey of possibleKeys) {
    const normalizedPossibleKey = normalizeHeader(possibleKey);
    if (!normalizedPossibleKey) continue;

    const exact = normalizedEntries.find(([key]) => key === normalizedPossibleKey);
    if (exact) {
      return normalizeCellValue(exact[1]);
    }
  }

  if (exact) return "";

  for (const possibleKey of possibleKeys) {
    const normalizedPossibleKey = normalizeHeader(possibleKey);
    if (!normalizedPossibleKey) continue;

    const prefixed = normalizedEntries.find(([key]) => key.startsWith(normalizedPossibleKey));
    if (prefixed) {
      return normalizeCellValue(prefixed[1]);
    }
  }

  return "";
}

export function isMeaningfulRow(values = []) {
  return values.some((value) => normalizeCellValue(value) !== "");
}

/** Filer metadata columns repeated on every NetFile schedule row; stored on the filing, not per disclosure. */
const FILER_COLUMNS = new Set([
  "last name", "first name", "middle name", "agency", "position", "employer name",
  "work email address", "filing type", "filing year", "due date", "filed date",
]);

const DETAILS = Symbol("form700RowDetails");

const HINT = /select|describe|mm\/dd|acceptable|separated|if trust|if gift|go to/i;

function headerLabel(value) {
  // FPPC headers wrap and carry form hints ("FAIR MARKET VALUE\r\n(Select from
  // drop down list)"). Drop the hints, keep meaningful parentheticals such as
  // "(Gift or Income)" or "(Real property, car, boat, etc.)".
  return normalizeCellValue(value)
    .replace(/\(([^()]*)\)/g, (match, inner) => (HINT.test(inner) ? " " : match))
    .replace(/\s+/g, " ")
    .replace(/\s+([,.])/g, "$1")
    .trim();
}

/**
 * Build human-readable column labels from a header row plus the optional
 * sub-header row FPPC exports put beneath grouped columns, e.g.
 * "IF APPLICABLE, LIST DATE" / "ACQUIRED" → "IF APPLICABLE, LIST DATE — ACQUIRED",
 * and "INVESTMENT" spanning "BUSINESS ENTITY/NAME" and the blank-headed
 * "DESCRIPTION OF BUSINESS ACTIVITY" column beside it.
 */
export function buildColumnLabels(header = [], subheader = null) {
  const labels = [];
  const seen = new Set();
  let groupTop = "";
  let lastGroup = "";
  const width = Math.max(header.length, subheader?.length ?? 0);
  for (let index = 0; index < width; index += 1) {
    const top = headerLabel(header[index]);
    const sub = subheader ? headerLabel(subheader[index]) : "";
    if (top) groupTop = top;
    const parent = top || (sub ? groupTop : "");
    if (top && sub && normalizeHeader(sub) !== normalizeHeader(top)
      && !normalizeHeader(sub).startsWith(normalizeHeader(top))) {
      lastGroup = top;
    }
    const related = parent && sub && (normalizeHeader(sub).startsWith(normalizeHeader(parent))
      || normalizeHeader(parent).startsWith(normalizeHeader(sub)));
    let label = parent && sub && !related ? `${parent} — ${sub}` : related && !top ? sub : parent || sub;
    if (label && seen.has(label)) label = lastGroup ? `${label} (${lastGroup})` : `${label} (${index + 1})`;
    if (label) seen.add(label);
    labels.push(label);
  }
  return labels;
}

function isSubheaderRow(row = [], header = []) {
  const filerIndexes = header.map((cell, index) => (FILER_COLUMNS.has(normalizeHeader(cell)) ? index : -1))
    .filter((index) => index >= 0);
  return filerIndexes.length > 0
    && filerIndexes.every((index) => normalizeCellValue(row[index]) === "")
    && isMeaningfulRow(row)
    && row.every((cell) => typeof cell !== "number");
}

function objectKeys(header) {
  const counts = new Map();
  return header.map((cell) => {
    const base = normalizeCellValue(cell) || "__EMPTY";
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    return count === 0 ? base : `${base}_${count}`;
  });
}

/**
 * Every non-empty, non-filer cell of a parsed schedule row as ordered
 * `{ label, value }` pairs, so nothing on the original disclosure is lost
 * (addresses, business activity, dates, lenders, A-2 income sources, …).
 */
export function rowDetails(row) {
  return row?.[DETAILS] ?? [];
}

const NOT_A_NAME = /^(none|n\/?a|not applicable|na|-+|0|see attached)$/i;

const LEGAL_SUFFIX = /^(llc|l\.l\.c\.|inc\.?|co\.?|corp\.?|ltd\.?|lp|llp|pc)$/i;

function splitNames(value) {
  const names = [];
  for (const raw of String(value).split(/;|\n/)) {
    // Strip "- Fair Market Value - 10,001 - 100,000" before splitting on commas,
    // otherwise the dollar figures become fragments such as "000".
    const line = raw.replace(/\s+-\s+fair market value\b.*$/i, "");
    const parts = line.split(",").map((part) => part.trim()).filter(Boolean);
    // Only long comma lists are lists of entities; "KSH Architects, San
    // Francisco" or "Swallowfork, LLC" stay whole.
    const pieces = parts.length >= 3 ? parts.reduce((list, part) => {
      if (LEGAL_SUFFIX.test(part) && list.length) list[list.length - 1] += `, ${part}`;
      else list.push(part);
      return list;
    }, []) : [line];
    for (const piece of pieces) {
      const name = piece
        .replace(/\((?:tenant|tenants|lessee)\)/gi, "")
        .replace(/\s+-\s+fair market value\b.*$/i, "")
        .trim();
      if ((name.match(/\p{L}/gu)?.length ?? 0) >= 3 && !NOT_A_NAME.test(name)) names.push(name);
    }
  }
  return names;
}

const RELATED_NAME_COLUMNS = [
  // A-2 section 3: sources of income to the business entity of $10,000 or more.
  { pattern: /sources? of income of \$?10000/, kind: "INCOME" },
  // Schedule B: tenants / sources of rental income of $10,000 or more.
  { pattern: /sources? of rental income of \$?10000/, kind: "INCOME" },
  // Schedule C: name of the source of commission or rental income.
  { pattern: /name of the source/, kind: "INCOME" },
  // A-2 section 4: investments held by the business entity or trust.
  { pattern: /^investment .*business entity\/name/, kind: "INVESTMENT" },
];

/**
 * Additional named parties inside a disclosure that can independently create
 * a financial interest (Gov. Code §87103): A-2 sources of income ≥ $10,000 and
 * entity-held investments, Schedule B tenants, and Schedule C commission or
 * rental sources. Lenders are deliberately excluded: loans from commercial
 * lenders on regular terms are not income (§82030(b)(10)).
 * @returns {{ name: string, kind: "INCOME" | "INVESTMENT", label: string }[]}
 */
export function relatedNamesFromDetails(details = []) {
  const seen = new Set();
  const related = [];
  for (const { label, value } of details ?? []) {
    const normalized = normalizeHeader(label).replace(/,/g, "");
    const column = RELATED_NAME_COLUMNS.find(({ pattern }) => pattern.test(normalized));
    if (!column) continue;
    for (const name of splitNames(value)) {
      const key = `${column.kind}:${name.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      related.push({ name, kind: column.kind, label });
    }
  }
  return related;
}

/**
 * Generic "find the sheet, find the header row, return row objects" helper used
 * by every schedule parser. Each returned object is keyed by the raw header
 * text (duplicates suffixed `_1`, blanks `__EMPTY`, matching SheetJS) and
 * carries the complete labelled row, readable with `rowDetails(row)`.
 * @param {Buffer|object} input buffer or workbook
 * @param {string[]} sheetKeywords sheet-name keywords (see findSheetName)
 * @param {string[]} headerKeywords header-cell keywords (see findHeaderRowIndex)
 * @param {{ exclude?: string[] }} options
 */
export function readScheduleRows(input, sheetKeywords, headerKeywords, options = {}) {
  const workbook = loadWorkbook(input);
  if (!workbook) return [];

  const sheet = findSheetByName(workbook, sheetKeywords, options);
  if (!sheet) return [];

  const headerRowIndex = findHeaderRowIndex(sheet, headerKeywords);
  if (headerRowIndex < 0) return [];

  const rows = sheetToRows(sheet);
  const header = rows[headerRowIndex] ?? [];
  const next = rows[headerRowIndex + 1];
  const subheader = next && isSubheaderRow(next, header) ? next : null;
  const labels = buildColumnLabels(header, subheader);
  const keys = objectKeys(header);
  const width = Math.max(header.length, labels.length);

  return rows.slice(headerRowIndex + (subheader ? 2 : 1))
    .filter((row) => Array.isArray(row) && isMeaningfulRow(row))
    .map((row) => {
      const object = {};
      const details = [];
      for (let index = 0; index < width; index += 1) {
        const value = normalizeCellValue(row[index]);
        if (index < keys.length) object[keys[index]] = value;
        const label = labels[index];
        if (value && label && !FILER_COLUMNS.has(normalizeHeader(label))) details.push({ label, value });
        else if (value && !label) details.push({ label: `Column ${index + 1}`, value });
      }
      Object.defineProperty(object, DETAILS, { value: details, enumerable: false });
      return object;
    });
}
