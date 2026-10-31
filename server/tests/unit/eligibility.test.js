import { describe, expect, it } from "vitest";
import { eligibilityPolicy } from "../../src/config/eligibilityPolicy.js";
import { disclosureEligibility, resolveAgendaScope } from "../../src/detection/eligibility.js";

const cities = [{ id: "city-a", name: "Sacramento" }, { id: "city-b", name: "Davis" }];
const scope = { jurisdictionId: "city-a", meetingDate: new Date("2026-01-01T00:00:00Z") };
const row = { filingId: "filing", disclosureId: "disclosure", filing: { filingYear: 2025, politician: { jurisdictionId: "city-a" } } };

describe("provisional eligibility", () => {
  it("fails closed by default and validates offsets", () => {
    expect(eligibilityPolicy({}).period).toBe("PENDING");
    expect(eligibilityPolicy({ FAIR_FILING_PERIOD_OFFSETS: "0, 1" }).offsets).toEqual([0, 1]);
    expect(() => eligibilityPolicy({ FAIR_FILING_PERIOD_OFFSETS: "-1" })).toThrow();
    expect(() => eligibilityPolicy({ FAIR_FILING_PERIOD_OFFSETS: " " })).toThrow();
    expect(() => eligibilityPolicy({ FAIR_FILING_PERIOD_OFFSETS: "9999999999999999999" })).toThrow();
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
  });
  it("excludes cross-city and out-of-period and includes configured boundaries", () => {
    const policy = { period: "YEAR_OFFSETS", offsets: [1] };
    expect(disclosureEligibility(scope, row, policy).status).toBe("ELIGIBLE");
    expect(disclosureEligibility({ ...scope, meetingDate: new Date("2025-12-31") }, row, policy).reason).toBe("OUT_OF_PERIOD");
    expect(disclosureEligibility(scope, { ...row, filing: { ...row.filing, politician: { jurisdictionId: "city-b" } } }, policy).reason).toBe("CROSS_JURISDICTION");
    expect(disclosureEligibility(scope, row, { period: "PENDING" }).status).toBe("POLICY_PENDING");
  });
  it("requires missing identity, date, and year to be reviewed", () => {
    const policy = { period: "YEAR_OFFSETS", offsets: [1] };
    expect(disclosureEligibility(scope, { filing: { filingYear: 2025, politician: {} } }, policy).reason).toBe("UNRESOLVED_POLITICIAN_JURISDICTION");
    expect(disclosureEligibility({ ...scope, meetingDate: null }, row, policy).reason).toBe("MISSING_MEETING_DATE");
    expect(disclosureEligibility(scope, { ...row, filing: { politician: { jurisdictionId: "city-a" } } }, policy).reason).toBe("MISSING_FILING_YEAR");
    expect(disclosureEligibility(scope, { ...row, disclosureId: null }, policy).reason).toBe("MISSING_DISCLOSURE_ID");
    expect(disclosureEligibility(scope, { ...row, filingId: null, filing: { ...row.filing, id: null } }, policy).reason).toBe("MISSING_FILING_ID");
    expect(disclosureEligibility(scope, { ...row, schedulePoliticianId: "other", filing: { ...row.filing, politicianId: "owner" } }, policy).reason).toBe("CONFLICTING_POLITICIAN_ID");
    expect(disclosureEligibility(scope, { ...row, filing: { ...row.filing, politician: { jurisdictionId: "city-a", needsReview: true } } }, policy).reason).toBe("POLITICIAN_IDENTITY_REVIEW");
  });
});