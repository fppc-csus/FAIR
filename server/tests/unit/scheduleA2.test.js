import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import * as XLSX from "xlsx";
import { parseScheduleA2 } from "../../src/parsers/scheduleA2.js";

const validBuffer = fs.readFileSync(path.resolve("tests/fixtures/form700-valid.xlsx"));
const malformedBuffer = fs.readFileSync(path.resolve("tests/fixtures/form700-malformed.xlsx"));

const A2_KEYS = [
  "entity_name",
  "business_position",
  "fair_market_value",
  "nature_of_investment",
  "gross_income_range",
  "filing_id",
].sort();

function bufferFromSheets(sheets) {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

/** Fixture 2: the valid workbook with the A-2 sheet removed. */
function validWithoutA2() {
  const wb = XLSX.read(validBuffer, { type: "buffer" });
  const out = XLSX.utils.book_new();
  for (const name of wb.SheetNames) {
    if (/a-2|a2/i.test(name)) continue;
    XLSX.utils.book_append_sheet(out, wb.Sheets[name], name);
  }
  return XLSX.write(out, { type: "buffer", bookType: "xlsx" });
}

/** Fixture 3: a hand-built A-2 sheet using the FPPC layout (section-title row above headers). */
function syntheticA2() {
  return bufferFromSheets({
    "Cover Page": [["Name", "Agency"], ["Jane Public", "City of Davis"]],
    "Schedule A-2": [
      ["1. Business Entity or Trust", null, null, null, null, "2. Gross Income Received"],
      [
        "NAME OF BUSINESS ENTITY OR TRUST",
        "GENERAL DESCRIPTION OF BUSINESS ACTIVITY",
        "FAIR MARKET VALUE",
        "NATURE OF INVESTMENT \r\n(if \"other,\" describe)",
        "YOUR BUSINESS POSITION",
        "INCLUDE YOUR PRO RATA SHARE OF GROSS INCOME TO ENTITY/TRUST",
      ],
      ["Public Consulting LLC", "Consulting", "$10,001 - $100,000", "Sole Proprietorship", "Owner", "$10,001 - $100,000"],
      ["", "", "", "", "", ""],
      ["Family Trust", null, null, null, "Trustee", "$0 - $499"],
    ],
  });
}

describe("parseScheduleA2", () => {
  it("returns snake_case rows shaped for schedule_a2_business_positions (fixture 1: real export)", () => {
    const result = parseScheduleA2(validBuffer, "filing-1");

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);

    for (const row of result) {
      expect(Object.keys(row).filter((key) => key !== "details").sort()).toEqual(A2_KEYS);
      expect(row.filing_id).toBe("filing-1");
      expect(row.entity_name).toBeTruthy();
    }

    expect(result[0]).toMatchObject({
      entity_name: "Gore Family Vineyards",
      business_position: "Co-Owner",
      fair_market_value: "$10,001 - $100,000", // entity-level FMV, not the section-4 column
      nature_of_investment: "Partnership",
      gross_income_range: "$0 - $499",
      filing_id: "filing-1",
    });

    // Trusts with no investment details still produce a row with nulls.
    const trust = result.find((r) => r.entity_name === "Thomas A. Gore Trust");
    expect(trust).toBeDefined();
    expect(trust.business_position).toBeNull();
    expect(trust.fair_market_value).toBeNull();
    expect(trust.gross_income_range).toBe("$0 - $499");
  });

  it("returns an empty array when the A-2 sheet is missing (fixture 2: valid export minus A-2)", () => {
    expect(parseScheduleA2(validWithoutA2(), "f")).toEqual([]);
  });

  it("parses a hand-built A-2 sheet and skips blank rows (fixture 3: synthetic)", () => {
    expect(parseScheduleA2(syntheticA2(), "f")).toMatchObject([
      {
        entity_name: "Public Consulting LLC",
        business_position: "Owner",
        fair_market_value: "$10,001 - $100,000",
        nature_of_investment: "Sole Proprietorship",
        gross_income_range: "$10,001 - $100,000",
        filing_id: "f",
      },
      {
        entity_name: "Family Trust",
        business_position: "Trustee",
        fair_market_value: null,
        nature_of_investment: null,
        gross_income_range: "$0 - $499",
        filing_id: "f",
      },
    ]);
  });

  it("accepts an already-read workbook object", () => {
    const wb = XLSX.read(validBuffer, { type: "buffer" });
    expect(parseScheduleA2(wb, "f")).toEqual(parseScheduleA2(validBuffer, "f"));
  });

  it("returns an empty array (never throws) for null / unreadable / malformed input", () => {
    expect(parseScheduleA2(null, "f")).toEqual([]);
    expect(parseScheduleA2(undefined, "f")).toEqual([]);
    expect(parseScheduleA2("does-not-exist.xlsx", "f")).toEqual([]);
    expect(parseScheduleA2(Buffer.from("garbage"), "f")).toEqual([]);
    expect(parseScheduleA2(malformedBuffer, "f")).toEqual([]);
  });
});
