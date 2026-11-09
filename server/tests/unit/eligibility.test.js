import { describe, expect, it } from "vitest";
import { eligibilityPolicy } from "../../src/config/eligibilityPolicy.js";
import { disclosureEligibility, resolveAgendaScope } from "../../src/detection/eligibility.js";

const cities = [{ id: "city-a", name: "Sacramento" }, { id: "city-b", name: "Davis" }];
const scope = { jurisdictionId: "city-a", meetingDate: new Date("2026-01-01T00:00:00Z"),
  meetingDateVerifiedValue: new Date("2026-01-01T00:00:00Z"), meetingDateVerifiedAt: new Date(), meetingDateVerifiedBy: "admin" };
const row = { filingId: "filing", disclosureId: "disclosure", filing: {
  filingYear: 2025, filingYearVerifiedValue: 2025, filingYearVerifiedAt: new Date(), filingYearVerifiedBy: "admin",
  politician: { jurisdictionId: "city-a", jurisdictionVerifiedId: "city-a", jurisdictionVerifiedAt: new Date(), jurisdictionVerifiedBy: "admin" },
} };

describe("verified all-jurisdiction and all-period eligibility", () => {
  it("never uses jurisdiction or filing year as a comparison boundary", () => {
    expect(eligibilityPolicy()).toEqual({ jurisdiction: "ALL_VERIFIED", period: "ALL_VERIFIED" });
  });
  it("resolves meeting and raw city mappings without guessing ambiguous cities", () => {
    expect(resolveAgendaScope({ cityName: "sacramento", meetingDate: "2026-01-01" }, cities).jurisdictionId).toBe("city-a");
    expect(resolveAgendaScope({ cityId: "external-source", cityName: "Sacramento", meetingDate: "2026-01-01" }, cities).jurisdictionId).toBe("city-a");
    expect(resolveAgendaScope({ meeting: { jurisdictionId: "city-b", meetingDate: "2026-01-01" }, cityName: "Sacramento" }, cities).reason).toBe("AMBIGUOUS_JURISDICTION");
    expect(resolveAgendaScope({ meeting: { jurisdictionId: "city-b", meetingDate: "2026-01-01" }, cityName: "Unknown" }, cities).reason).toBe("UNRESOLVED_JURISDICTION");
    expect(resolveAgendaScope({ cityName: "unknown" }, cities).reason).toBe("UNRESOLVED_JURISDICTION");
    expect(resolveAgendaScope({ cityId: "city-b", cityName: "Sacramento" }, cities).reason).toBe("AMBIGUOUS_JURISDICTION");
    expect(resolveAgendaScope({ cityName: "Sacramento" }, [...cities, { id: "duplicate", name: "Sacramento" }]).reason).toBe("AMBIGUOUS_JURISDICTION");
    expect(resolveAgendaScope({ meetingDate: "2026-01-02", meeting: { jurisdictionId: "city-a", meetingDate: "2026-01-01" } }, cities).reason).toBe("AMBIGUOUS_MEETING_DATE");
    expect(resolveAgendaScope({ cityName: "Unknown", meetingDate: "2026-01-02", meeting: { meetingDate: "2026-01-01" } }, cities).reason).toBe("AMBIGUOUS_MEETING_DATE");
  });
  it("includes same-city, cross-city, and historical filings when verified", () => {
    const policy = eligibilityPolicy();
    expect(disclosureEligibility(scope, row, policy).status).toBe("ELIGIBLE");
    expect(disclosureEligibility(scope, { ...row, filing: { ...row.filing, filingYear: 1999, filingYearVerifiedValue: 1999,
      politician: { ...row.filing.politician, jurisdictionId: "city-b", jurisdictionVerifiedId: "city-b" } } }, policy).status).toBe("ELIGIBLE");
  });
  it("requires missing identity, date, and year to be reviewed", () => {
    const policy = eligibilityPolicy();
    expect(disclosureEligibility(scope, { filing: { filingYear: 2025, politician: {} } }, policy).reason).toBe("UNRESOLVED_POLITICIAN_JURISDICTION");
    expect(disclosureEligibility({ ...scope, meetingDate: null }, row, policy).reason).toBe("MISSING_MEETING_DATE");
    expect(disclosureEligibility(scope, { ...row, filing: { ...row.filing, filingYear: null } }, policy).reason).toBe("MISSING_FILING_YEAR");
    expect(disclosureEligibility(scope, { ...row, disclosureId: null }, policy).reason).toBe("MISSING_DISCLOSURE_ID");
    expect(disclosureEligibility(scope, { ...row, filingId: null, filing: { ...row.filing, id: null } }, policy).reason).toBe("MISSING_FILING_ID");
    expect(disclosureEligibility(scope, { ...row, schedulePoliticianId: "other", filing: { ...row.filing, politicianId: "owner" } }, policy).reason).toBe("CONFLICTING_POLITICIAN_ID");
    expect(disclosureEligibility(scope, { ...row, filing: { ...row.filing, politician: { ...row.filing.politician, needsReview: true } } }, policy).reason).toBe("POLITICIAN_IDENTITY_REVIEW");
    expect(disclosureEligibility(scope, { ...row, filing: { ...row.filing, filingYearVerifiedValue: 2024 } }, policy).reason).toBe("UNVERIFIED_FILING_YEAR");
    expect(disclosureEligibility(scope, { ...row, filing: { ...row.filing, politician: { ...row.filing.politician, jurisdictionVerifiedId: "city-b" } } }, policy).reason).toBe("UNVERIFIED_POLITICIAN_JURISDICTION");
    expect(disclosureEligibility({ ...scope, meetingDateVerifiedValue: new Date("2025-01-01") }, row, policy).reason).toBe("UNVERIFIED_MEETING_DATE");
  });
});