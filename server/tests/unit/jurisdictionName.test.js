import { describe, expect, it } from "vitest";
import { findJurisdictionsByName, jurisdictionKey, sameJurisdictionName } from "../../src/utils/jurisdictionName.js";
import { resolveAgendaScope } from "../../src/detection/eligibility.js";

describe("jurisdiction name resolution", () => {
  it("treats common spellings of one government as the same jurisdiction", () => {
    expect(sameJurisdictionName("County of Sonoma", "Sonoma County")).toBe(true);
    expect(sameJurisdictionName("City of Fresno", "Fresno")).toBe(true);
    expect(sameJurisdictionName("City and County of San Francisco", "San Francisco County")).toBe(true);
    expect(jurisdictionKey("State of California")).toBe("state:california");
  });

  it("never merges a city with the county of the same name", () => {
    expect(sameJurisdictionName("City of Sonoma", "Sonoma County")).toBe(false);
    expect(jurisdictionKey("")).toBe("");
  });

  it("finds jurisdictions by any spelling", () => {
    const rows = [{ id: "c", name: "County of Sonoma" }, { id: "f", name: "City of Fresno" }];
    expect(findJurisdictionsByName(rows, "Sonoma County").map((row) => row.id)).toEqual(["c"]);
    expect(findJurisdictionsByName(rows, "Oakland")).toEqual([]);
  });

  it("resolves a Legistar 'Sonoma County' agenda item to the 'County of Sonoma' filers", () => {
    const scope = resolveAgendaScope(
      { cityId: "source-1", cityName: "Sonoma County", meetingDate: "2019-12-17T08:00:00Z" },
      [{ id: "county", name: "County of Sonoma" }],
    );
    expect(scope).toMatchObject({ jurisdictionId: "county", reason: null });
  });

  it("prefers an explicit data-source link over name matching", () => {
    const scope = resolveAgendaScope(
      { cityId: "source-1", cityName: "Unlisted Name", meetingDate: "2019-12-17" },
      [{ id: "other", name: "Somewhere" }],
      [{ id: "source-1", jurisdictionId: "linked" }],
    );
    expect(scope.jurisdictionId).toBe("linked");
    expect(scope.meetingDate.toISOString().slice(0, 10)).toBe("2019-12-17");
  });
});
