import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import * as XLSX from "xlsx";
import { parseScheduleB, normalizeCity, normalizeCounty } from "../../src/parsers/scheduleB.js";

const validBuffer = fs.readFileSync(path.resolve("tests/fixtures/form700-valid.xlsx"));
const malformedBuffer = fs.readFileSync(path.resolve("tests/fixtures/form700-malformed.xlsx"));

function bufferFromRows(sheetName, rows) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), sheetName);
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

describe("parseScheduleB", () => {
  it("returns snake_case Schedule B rows with county (not agency) for a valid buffer", () => {
    const result = parseScheduleB(validBuffer, "filing-1");

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);

    const row = result[0];
    expect(Object.keys(row).filter((key) => key !== "details").sort()).toEqual(
      [
        "property_description",
        "city",
        "county",
        "fair_market_value",
        "nature_of_interest",
        "filing_id",
      ].sort(),
    );
    expect(row).not.toHaveProperty("agency");
    expect(row).not.toHaveProperty("propertyDescription");

    expect(row).toMatchObject({
      property_description: "6867 Quailbrook Lane",
      city: "Penngrove", // "Penngrove, CA" → state stripped, title-cased
      county: null, // fixture has no COUNTY column
      fair_market_value: "$100,001 - $1,000,000",
      nature_of_interest: "Ownership/Deed of Trust",
      filing_id: "filing-1",
    });

    for (const r of result) {
      expect(r.filing_id).toBe("filing-1");
      expect(r.property_description).toBeTruthy();
    }
  });

  it("title-cases city and county when a COUNTY column exists", () => {
    const buffer = bufferFromRows("Schedule B", [
      ["STREET ADDRESS OR PRECISE LOCATION", "CITY", "COUNTY", "FAIR MARKET VALUE", "NATURE OF INTEREST"],
      ["123 main st", "sAN JOSE, CA", "SANTA CLARA COUNTY", "$2,000 - $10,000", "Ownership/Deed of Trust"],
    ]);

    expect(parseScheduleB(buffer, "f")).toMatchObject([
      {
        property_description: "123 main st",
        city: "San Jose",
        county: "Santa Clara",
        fair_market_value: "$2,000 - $10,000",
        nature_of_interest: "Ownership/Deed of Trust",
        filing_id: "f",
      },
    ]);
  });

  it("skips sub-header / blank rows that have no property description", () => {
    const result = parseScheduleB(validBuffer, "f");
    expect(result.some((r) => /nature of interest/i.test(r.nature_of_interest ?? ""))).toBe(false);
  });

  it("returns an empty array when the Schedule B sheet is missing", () => {
    const buffer = bufferFromRows("Schedule A", [["NAME OF BUSINESS ENTITY"], ["Acme"]]);
    expect(parseScheduleB(buffer, "f")).toEqual([]);
  });

  it("returns an empty array for null / unreadable / malformed input", () => {
    expect(parseScheduleB(null, "f")).toEqual([]);
    expect(parseScheduleB("does-not-exist.xlsx", "f")).toEqual([]);
    expect(parseScheduleB(Buffer.from("garbage"), "f")).toEqual([]);
    expect(parseScheduleB(malformedBuffer, "f")).toEqual([]);
  });
});

describe("normalizeCity / normalizeCounty", () => {
  it("normalizes city strings", () => {
    expect(normalizeCity("healdsburg, CA 95448")).toBe("Healdsburg");
    expect(normalizeCity("  santa   rosa ")).toBe("Santa Rosa");
    expect(normalizeCity("")).toBeNull();
    expect(normalizeCity(null)).toBeNull();
  });

  it("normalizes county strings", () => {
    expect(normalizeCounty("sonoma county")).toBe("Sonoma");
    expect(normalizeCounty("LOS ANGELES")).toBe("Los Angeles");
    expect(normalizeCounty(undefined)).toBeNull();
  });
});
