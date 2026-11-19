// Filing-period rule: which Form 700 filing years apply to a meeting.
//
// Offsets are "meeting year minus filing year". The default (0,1) follows the
// 12-month look-back for sources of income in Cal. Gov. Code §87103(c): an
// annual statement covering calendar year N is relevant to decisions made in
// year N and in year N+1. Override with FAIR_FILING_PERIOD_OFFSETS (for example
// "0") or set it to "pending" to pause automatic detection entirely.
export const DEFAULT_FILING_PERIOD_OFFSETS = [0, 1];

export function eligibilityPolicy(env = process.env) {
  const raw = env.FAIR_FILING_PERIOD_OFFSETS;
  if (raw == null || raw === "") return { period: "YEAR_OFFSETS", offsets: [...DEFAULT_FILING_PERIOD_OFFSETS] };
  if (typeof raw !== "string") throw new Error("FAIR_FILING_PERIOD_OFFSETS must be a string");
  if (raw.trim().toLowerCase() === "pending") return { period: "PENDING", offsets: [] };
  if (!/^\d+(?:\s*,\s*\d+)*$/.test(raw.trim())) {
    throw new Error("FAIR_FILING_PERIOD_OFFSETS must be comma-separated nonnegative integers or \"pending\"");
  }
  const offsets = [...new Set(raw.split(",").map(Number))];
  if (offsets.some((offset) => !Number.isSafeInteger(offset) || offset > 9999)) {
    throw new Error("FAIR_FILING_PERIOD_OFFSETS contains an invalid year offset");
  }
  return { period: "YEAR_OFFSETS", offsets };
}
