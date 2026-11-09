// Verified jurisdiction and year are prerequisites, never comparison boundaries.
export function eligibilityPolicy() {
  return { jurisdiction: "ALL_VERIFIED", period: "ALL_VERIFIED" };
}