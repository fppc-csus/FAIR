import { describe, it, expect } from "vitest";
import { detectRealEstate } from "../../src/detection/detectRealEstate.js";
import {
  CONFLICT_TYPES,
  SEVERITY,
  calculateSeverity,
} from "../../src/config/conflictRules.js";

const politicianId = "pol-b-1";
const agendaItemId = "item-b-1";

const property = {
  politician_id: politicianId,
  property_description: "123 Main Street",
  city: "Santa Rosa",
  county: "Sonoma",
};

describe("detectRealEstate", () => {
  it("assigns severity at each dollar threshold", () => {
    expect(
      calculateSeverity({ conflictType: CONFLICT_TYPES.INCOME, amount: "$999" }),
    ).toBe(SEVERITY.LOW);
    expect(
      calculateSeverity({ conflictType: CONFLICT_TYPES.INCOME, amount: "$1,000" }),
    ).toBe(SEVERITY.MEDIUM);
    expect(
      calculateSeverity({ conflictType: CONFLICT_TYPES.INCOME, amount: "$9,999" }),
    ).toBe(SEVERITY.MEDIUM);
    expect(
      calculateSeverity({ conflictType: CONFLICT_TYPES.INCOME, amount: "$10,000" }),
    ).toBe(SEVERITY.HIGH);
  });

  it("flags when the street appears in the agenda item", async () => {
    const item = {
      id: agendaItemId,
      title: "Public hearing for a variance at 123 Main Street",
      description: "Consider a setback variance for the parcel.",
      cityName: "Santa Rosa",
    };

    const flags = await detectRealEstate([property], item);

    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({
      politician_id: politicianId,
      agenda_item_id: agendaItemId,
      conflict_type: CONFLICT_TYPES.REAL_ESTATE,
      severity: SEVERITY.MEDIUM,
    });
    expect(flags[0].rule_reference).toMatch(/§87100/);
    expect(flags[0].rule_reference).toMatch(/§87103/);
  });

  it("does not flag when only the meeting city matches", async () => {
    const item = {
      id: agendaItemId,
      title: "Approve the consent calendar",
      description: "Routine administrative items and minutes.",
      cityName: "Santa Rosa",
      city_name: "Santa Rosa",
    };

    const flags = await detectRealEstate([property], item);
    expect(flags).toHaveLength(0);
  });

  it("uses fair market value for property severity", async () => {
    const item = {
      id: agendaItemId,
      title: "Public hearing for a variance at 123 Main Street",
      description: "Consider a setback variance for the parcel.",
      cityName: "Santa Rosa",
    };

    const flags = await detectRealEstate(
      [{ ...property, fair_market_value: "$25,000" }],
      item,
    );

    expect(flags[0].severity).toBe(SEVERITY.HIGH);
  });

  it("does not flag an unrelated city", async () => {
    const item = {
      id: agendaItemId,
      title: "Zoning amendment in Fresno",
      description: "Parcel APN 111-222-333 development near downtown Fresno.",
      cityName: "Fresno",
    };

    const flags = await detectRealEstate([property], item);
    expect(flags).toHaveLength(0);
  });

  it("optionally flags city plus a land-use keyword in the item text", async () => {
    const item = {
      id: agendaItemId,
      title: "Zoning map amendment for downtown Santa Rosa",
      description: "Consider a CUP for a mixed-use development.",
    };

    expect(await detectRealEstate([property], item)).toHaveLength(0);
    const flags = await detectRealEstate([property], item, { matchCity: true });
    expect(flags).toHaveLength(1);
    expect(flags[0].conflict_type).toBe(CONFLICT_TYPES.REAL_ESTATE);
  });
});
