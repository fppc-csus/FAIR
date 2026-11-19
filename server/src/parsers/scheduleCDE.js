/**
 * Schedules C (income), D (gifts) and E (travel payments).
 *
 * Pure parser: `parseScheduleCDE(buffer, filingId)` returns snake_case rows for
 * `schedule_cde_income` with `schedule_type` = "C" | "D" | "E" and performs no
 * DB writes. Missing sheets simply contribute no rows; unreadable input → [].
 */
import { cleanText, getField, readScheduleRows, rowDetails } from "./parserUtils.js";

const SOURCE_KEYS = [
  "NAME OF SOURCE",
  "Name of Source",
  "SOURCE OF INCOME",
  "SOURCE OF GIFT",
  "SOURCE OF PAYMENT",
  "SOURCE",
  "Source",
];

// Column holding the dollar figure differs per schedule:
//   C: GROSS INCOME RECEIVED   D: VALUE   E: AMOUNT
const AMOUNT_KEYS = [
  "GROSS INCOME RECEIVED",
  "Gross Income Received",
  "VALUE",
  "Value",
  "AMOUNT",
  "Amount",
];

const HEADER_KEYWORDS = ["name of source", "source of income", "source of gift", "source"];

const SCHEDULES = [
  { type: "C", sheetKeywords: ["schedule c", "income"] },
  { type: "D", sheetKeywords: ["schedule d", "gifts"] },
  { type: "E", sheetKeywords: ["schedule e", "travel"] },
];

function mapRow(row, scheduleType, filingId) {
  const sourceName = cleanText(getField(row, SOURCE_KEYS));
  if (!sourceName) return null;

  return {
    source_name: sourceName,
    amount: cleanText(getField(row, AMOUNT_KEYS)),
    schedule_type: scheduleType,
    filing_id: filingId ?? null,
    details: rowDetails(row),
  };
}

export function parseScheduleCDE(input, filingId = null) {
  try {
    const results = [];

    for (const { type, sheetKeywords } of SCHEDULES) {
      const rows = readScheduleRows(input, sheetKeywords, HEADER_KEYWORDS);
      for (const row of rows) {
        const mapped = mapRow(row, type, filingId);
        if (mapped) results.push(mapped);
      }
    }

    return results;
  } catch {
    return [];
  }
}

export default parseScheduleCDE;
