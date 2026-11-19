/**
 * Schedule B — Interests in real property.
 *
 * Pure parser: `parseScheduleB(buffer, filingId)` returns snake_case rows for
 * `schedule_b_realestate` and performs no DB writes. Returns [] when the
 * workbook cannot be read or has no Schedule B sheet.
 *
 * `city` and `county` are title-cased. The FPPC export has no dedicated county
 * column for most filers, so `county` is null unless a COUNTY column exists
 * (the filer's "Agency" column is NOT the property county and is ignored).
 */
import { cleanText, getField, readScheduleRows, rowDetails, toTitleCase } from "./parserUtils.js";

const SHEET_KEYWORDS = ["schedule b", "real property"];
const HEADER_KEYWORDS = ["street address or precise location", "property description", "parcel"];

const ADDRESS_KEYS = [
  "STREET ADDRESS OR PRECISE LOCATION",
  "Street Address or Precise Location",
  "Property Description",
  "Parcel Description",
  "Precise Location",
];
const CITY_KEYS = ["CITY", "City"];
const COUNTY_KEYS = ["COUNTY", "County"];
const FMV_KEYS = ["FAIR MARKET VALUE", "Fair Market Value"];
const NATURE_KEYS = ["NATURE OF INTEREST", "Nature of Interest"];

/** "Healdsburg, CA 95448" → "Healdsburg" (title-cased). */
export function normalizeCity(value) {
  const text = cleanText(value);
  if (!text) return null;

  const cityOnly = text.split(",")[0].trim();
  return toTitleCase(cityOnly);
}

/** "SONOMA COUNTY" → "Sonoma" (title-cased, trailing "County" dropped). */
export function normalizeCounty(value) {
  const text = cleanText(value);
  if (!text) return null;

  return toTitleCase(text.replace(/\s+county$/i, "").trim());
}

function mapRow(row, filingId) {
  const propertyDescription = cleanText(getField(row, ADDRESS_KEYS));
  if (!propertyDescription) return null;

  return {
    property_description: propertyDescription,
    city: normalizeCity(getField(row, CITY_KEYS)),
    county: normalizeCounty(getField(row, COUNTY_KEYS)),
    fair_market_value: cleanText(getField(row, FMV_KEYS)),
    nature_of_interest: cleanText(getField(row, NATURE_KEYS)),
    filing_id: filingId ?? null,
    details: rowDetails(row),
  };
}

export function parseScheduleB(input, filingId = null) {
  try {
    const rows = readScheduleRows(input, SHEET_KEYWORDS, HEADER_KEYWORDS);
    return rows.map((row) => mapRow(row, filingId)).filter(Boolean);
  } catch {
    return [];
  }
}

export default parseScheduleB;
