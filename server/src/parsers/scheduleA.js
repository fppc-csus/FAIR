/**
 * Schedule A — Investments (stocks, bonds, business interests).
 *
 * Pure parser: `parseScheduleA(buffer, filingId)` returns snake_case rows for
 * `schedule_a_investments` and performs no DB writes. Returns [] when the
 * workbook cannot be read or has no Schedule A sheet.
 */
import { cleanText, getField, readScheduleRows, rowDetails } from "./parserUtils.js";

const SHEET_KEYWORDS = ["schedule a", "schedule a1", "schedule a-1", "investments"];
// "Schedule A-2" also contains "schedule a" — never treat it as Schedule A.
const SHEET_EXCLUDE = ["a-2", "a2", "a 2"];
const HEADER_KEYWORDS = ["name of business entity", "business entity"];

const ENTITY_KEYS = ["NAME OF BUSINESS ENTITY", "Name of Business Entity", "Business Entity", "Entity Name"];
const FMV_KEYS = ["FAIR MARKET VALUE", "Fair Market Value"];
const NATURE_KEYS = ["NATURE OF INVESTMENT", "Nature of Investment"];

function mapRow(row, filingId) {
  const entityName = cleanText(getField(row, ENTITY_KEYS));
  if (!entityName) return null;

  return {
    entity_name: entityName,
    fair_market_value: cleanText(getField(row, FMV_KEYS)),
    nature_of_investment: cleanText(getField(row, NATURE_KEYS)),
    filing_id: filingId ?? null,
    details: rowDetails(row),
  };
}

export function parseScheduleA(input, filingId = null) {
  try {
    const rows = readScheduleRows(input, SHEET_KEYWORDS, HEADER_KEYWORDS, {
      exclude: SHEET_EXCLUDE,
    });

    return rows.map((row) => mapRow(row, filingId)).filter(Boolean);
  } catch {
    return [];
  }
}

export default parseScheduleA;
