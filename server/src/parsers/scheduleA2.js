/**
 * Schedule A-2 — Investments, income and assets of business entities / trusts
 * in which the filer holds a business position.
 *
 * Pure parser: `parseScheduleA2(buffer, filingId)` returns snake_case rows for
 * `schedule_a2_business_positions` and performs no DB writes. Returns [] when
 * the workbook cannot be read or has no A-2 sheet.
 *
 * Column mapping (see docs/fair/form700-ingestion/CONTEXT.md):
 *   entity_name          ← NAME OF BUSINESS ENTITY OR TRUST
 *   business_position    ← YOUR BUSINESS POSITION
 *   fair_market_value    ← FAIR MARKET VALUE (first / entity-level column)
 *   nature_of_investment ← NATURE OF INVESTMENT
 *   gross_income_range   ← INCLUDE YOUR PRO RATA SHARE OF GROSS INCOME TO ENTITY/TRUST
 */
import { cleanText, getField, readScheduleRows, rowDetails } from "./parserUtils.js";

const SHEET_KEYWORDS = ["schedule a-2", "schedule a2", "schedule a 2", "a-2", "business position"];
const HEADER_KEYWORDS = ["name of business entity or trust", "name of business entity"];

const ENTITY_KEYS = [
  "NAME OF BUSINESS ENTITY OR TRUST",
  "Name of Business Entity or Trust",
  "NAME OF BUSINESS ENTITY",
  "Business Entity",
];
const POSITION_KEYS = ["YOUR BUSINESS POSITION", "Your Business Position", "BUSINESS POSITION", "Position Held"];
const FMV_KEYS = ["FAIR MARKET VALUE", "Fair Market Value"];
const NATURE_KEYS = ["NATURE OF INVESTMENT", "Nature of Investment"];
const GROSS_INCOME_KEYS = [
  "INCLUDE YOUR PRO RATA SHARE OF GROSS INCOME TO ENTITY/TRUST",
  "GROSS INCOME RECEIVED",
  "Gross Income Received",
  "GROSS INCOME",
  "Gross Income",
];

function mapRow(row, filingId) {
  const entityName = cleanText(getField(row, ENTITY_KEYS));
  if (!entityName) return null;

  return {
    entity_name: entityName,
    business_position: cleanText(getField(row, POSITION_KEYS)),
    fair_market_value: cleanText(getField(row, FMV_KEYS)),
    nature_of_investment: cleanText(getField(row, NATURE_KEYS)),
    gross_income_range: cleanText(getField(row, GROSS_INCOME_KEYS)),
    filing_id: filingId ?? null,
    details: rowDetails(row),
  };
}

export function parseScheduleA2(input, filingId = null) {
  try {
    const rows = readScheduleRows(input, SHEET_KEYWORDS, HEADER_KEYWORDS);
    return rows.map((row) => mapRow(row, filingId)).filter(Boolean);
  } catch {
    return [];
  }
}

export default parseScheduleA2;
