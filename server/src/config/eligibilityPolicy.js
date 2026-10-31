// PROVISIONAL — CLIENT APPROVAL PENDING. Never enable a period rule implicitly.
// Set FAIR_FILING_PERIOD_OFFSETS to comma-separated meeting-year minus filing-year
// offsets only after a documented operational decision (e.g. "0,1").
export function eligibilityPolicy(env = process.env) {
  const raw = env.FAIR_FILING_PERIOD_OFFSETS;
  if (raw == null || raw === "") return { period: "PENDING", offsets: [] };
  if (typeof raw !== "string") throw new Error("FAIR_FILING_PERIOD_OFFSETS must be a string");
  if (!/^\d+(?:\s*,\s*\d+)*$/.test(raw.trim())) {
    throw new Error("FAIR_FILING_PERIOD_OFFSETS must be comma-separated nonnegative integers");
  }
  const offsets = [...new Set(raw.split(",").map(Number))];
  if (offsets.some((offset) => !Number.isSafeInteger(offset) || offset > 9999)) {
    throw new Error("FAIR_FILING_PERIOD_OFFSETS contains an invalid year offset");
  }
  return { period: "YEAR_OFFSETS", offsets };
}