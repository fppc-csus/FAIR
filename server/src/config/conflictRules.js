/**
 * Conflict-of-interest matching rules for Form 700 vs agenda items.
 *
 * Cite: Cal. Gov. Code §87100 (no participation in a decision in which the
 * official has a financial interest) and §87103 (what counts as a financial
 * interest: investments, real property, sources of income, gifts, business positions).
 *
 * This file is the single source of thresholds, fuse/Gemini bands, land-use
 * keywords, and the severity bands. Detectors import from here rather than
 * hard-coding dollar cutoffs.
 */

import { normalizeEntityName } from "../utils/entityNorm.js";

export const GOV_CODE = {
  PARTICIPATION: "Cal. Gov. Code §87100",
  FINANCIAL_INTEREST: "Cal. Gov. Code §87103",
};

export const MATCH_BANDS = {
  AUTO_MATCH: 0.9,
  GEMINI_MIN: 0.7,
};

export const ENTITY_RESOLUTION = {
  GEMINI_MODEL: "gemini-1.5-flash",
  REQUEST_TIMEOUT_MS: 5000,
  MAX_AGENDA_TEXT_CHARS: 2000,
};

/**
 * Public agencies and similar generic entities that can appear in disclosures
 * but must never create a named-entity conflict by themselves. Keep this list
 * as display names; matching is normalized so casing, punctuation, and legal
 * suffix differences do not bypass an exclusion.
 */
export const ENTITY_EXCLUSION_LIST = [
  "City of Los Angeles",
];

const NORMALIZED_ENTITY_EXCLUSIONS = new Set(
  ENTITY_EXCLUSION_LIST.map(normalizeEntityName).filter(Boolean),
);

export function isExcludedEntity(entityName) {
  return NORMALIZED_ENTITY_EXCLUSIONS.has(normalizeEntityName(entityName));
}

export const AMOUNT_THRESHOLDS = {
  INVESTMENT: 2000,
  INCOME: 500,
  // Form 700 reporting thresholds; disqualification uses giftLimitForYear().
  GIFT: 50,
  TRAVEL: 50,
};

/**
 * Salary, per diem and expense reimbursement from a government agency are not
 * "income" (Gov. Code §82030(b)(2)), so a government source of income cannot
 * create a §87103(c) interest. Gifts from agencies are still evaluated.
 */
const GOVERNMENT_SOURCE = /\b(county of|city of|town of|city and county|state of california|commission|authority|district|unified school|department of|board of supervisors|council of governments|association of bay area governments|rail transit|transit district|joint powers|university of california|california state university|superior court|united states)\b/i;

export function isGovernmentSource(name) {
  return GOVERNMENT_SOURCE.test(String(name ?? ""));
}

export const SEVERITY_AMOUNT = {
  HIGH: 10000,
  MEDIUM: 1000,
};

export const SEVERITY = {
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
};

export const CONFLICT_TYPES = {
  INVESTMENT: "INVESTMENT",
  REAL_ESTATE: "REAL_ESTATE",
  INCOME: "INCOME",
  GIFT: "GIFT",
  TRAVEL: "TRAVEL",
  BUSINESS_POSITION: "BUSINESS_POSITION",
};

export const RULE_REFERENCE = {
  INVESTMENT: "Cal. Gov. Code §87100, §87103(a)",
  REAL_ESTATE: "Cal. Gov. Code §87100, §87103(b)",
  INCOME: "Cal. Gov. Code §87100, §87103(c)",
  GIFT: "Cal. Gov. Code §87100, §87103(e)",
  TRAVEL: "Cal. Gov. Code §87100, §87103(c)",
  BUSINESS_POSITION: "Cal. Gov. Code §87100, §87103(d)",
};

export const LAND_USE_KEYWORDS = [
  "zoning",
  "variance",
  "cup",
  "conditional use",
  "development",
  "parcel",
  "apn",
];

export function parseAmount(amount) {
  if (amount == null || amount === "") return null;
  if (typeof amount === "number") {
    return Number.isFinite(amount) ? amount : null;
  }
  const matches = String(amount).replace(/,/g, "").match(/\d+(?:\.\d+)?/g);
  if (!matches?.length) return null;
  return Math.min(...matches.map(Number));
}

export function conflictTypeForSchedule(scheduleType) {
  const type = String(scheduleType || "").toUpperCase();
  if (type === "C") return CONFLICT_TYPES.INCOME;
  if (type === "D") return CONFLICT_TYPES.GIFT;
  if (type === "E") return CONFLICT_TYPES.TRAVEL;
  return null;
}

/**
 * Gift limit by first calendar year of each two-year period (Gov. Code
 * §89503(f), 2 CCR §18940.2). A donor of gifts totalling at least this amount
 * in the 12 months before a decision is a disqualifying interest
 * (§87103(e)). $520 (2022), $590 (2023-24) and $630 (2025-26) are confirmed
 * against FPPC guidance; earlier periods are from FPPC historical limits.
 */
export const GIFT_LIMITS = [
  [2015, 460],
  [2017, 470],
  [2019, 500],
  [2021, 520],
  [2023, 590],
  [2025, 630],
];

export function giftLimitForYear(year) {
  const numeric = Number(year);
  if (!Number.isInteger(numeric)) return GIFT_LIMITS.at(-1)[1];
  let limit = GIFT_LIMITS[0][1];
  for (const [start, amount] of GIFT_LIMITS) if (numeric >= start) limit = amount;
  return limit;
}

/**
 * Disqualification thresholds (not the lower Form 700 *reporting* thresholds):
 * income $500 (§87103(c)); gifts and gift-type travel at the gift limit for
 * the decision year (§87103(e)). Pass the aggregate from one source when known.
 */
export function meetsAmountThreshold(scheduleType, amount, { year } = {}) {
  const type = String(scheduleType || "").toUpperCase();
  const threshold =
    type === "C"
      ? AMOUNT_THRESHOLDS.INCOME
      : type === "D"
        ? giftLimitForYear(year)
        : type === "E"
          ? Math.min(AMOUNT_THRESHOLDS.INCOME, giftLimitForYear(year))
          : null;
  if (threshold == null) return false;
  const dollars = parseAmount(amount);
  if (dollars == null) return true;
  return dollars >= threshold;
}

export function meetsInvestmentThreshold(amount) {
  const dollars = parseAmount(amount);

  if (dollars == null) return true; // If the value cannot be parsed, let the detector continue.

  return dollars >= AMOUNT_THRESHOLDS.INVESTMENT;
}

export function hasLandUseKeyword(text) {
  const n = String(text || "").toLowerCase();
  if (!n) return false;
  if (/\bconditional\s+use\b/.test(n)) return true;
  return LAND_USE_KEYWORDS.some((kw) => {
    const k = kw.toLowerCase();
    if (k === "cup") return /\bcup\b/.test(n);
    if (k === "apn") return /\bapn\b/.test(n);
    if (k === "conditional use") return false;
    return n.includes(k);
  });
}

export function calculateSeverity({ conflictType, amount } = {}) {
  if (conflictType === CONFLICT_TYPES.BUSINESS_POSITION) {
  return SEVERITY.MEDIUM;
}
  
  const dollars = parseAmount(amount);
  if (dollars == null) return SEVERITY.MEDIUM;
  if (dollars >= SEVERITY_AMOUNT.HIGH) return SEVERITY.HIGH;
  if (dollars >= SEVERITY_AMOUNT.MEDIUM) return SEVERITY.MEDIUM;
  return SEVERITY.LOW;
}
