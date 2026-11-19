import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import * as XLSX from "xlsx";
import { parseScheduleA } from "../../src/parsers/scheduleA.js";

const validBuffer = fs.readFileSync(path.resolve("tests/fixtures/form700-valid.xlsx"));
const malformedBuffer = fs.readFileSync(path.resolve("tests/fixtures/form700-malformed.xlsx"));

function workbookWithoutSheet(keyword) {
  const wb = XLSX.read(validBuffer, { type: "buffer" });
  const out = XLSX.utils.book_new();
  for (const name of wb.SheetNames) {
    if (name.toLowerCase().includes(keyword)) continue;
    XLSX.utils.book_append_sheet(out, wb.Sheets[name], name);
  }
  return XLSX.write(out, { type: "buffer", bookType: "xlsx" });
}

describe("parseScheduleA", () => {
  it("returns snake_case Schedule A rows for a valid XLSX buffer", () => {
    const result = parseScheduleA(validBuffer, "filing-1");

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);

    const row = result[0];
    expect(Object.keys(row).filter((key) => key !== "details").sort()).toEqual(
      ["entity_name", "fair_market_value", "filing_id", "nature_of_investment"].sort(),
    );
    expect(row).toMatchObject({
      entity_name: "Scoop",
      fair_market_value: "$2,000 - $10,000",
      nature_of_investment: "Advisory Shares",
      filing_id: "filing-1",
    });

    // No camelCase leakage and every row carries the filing id.
    for (const r of result) {
      expect(r).not.toHaveProperty("entityName");
      expect(r.filing_id).toBe("filing-1");
      expect(typeof r.entity_name).toBe("string");
      expect(r.entity_name.length).toBeGreaterThan(0);
    }
  });

  it("does not pick up the Schedule A-2 sheet as Schedule A", () => {
    const result = parseScheduleA(validBuffer, "f");
    // A-2 entities (business positions) must not appear in Schedule A output.
    expect(result.some((r) => r.entity_name === "Thomas A. Gore Trust")).toBe(false);
  });

  it("also accepts an already-read workbook object", () => {
    const wb = XLSX.read(validBuffer, { type: "buffer" });
    expect(parseScheduleA(wb, "f")).toEqual(parseScheduleA(validBuffer, "f"));
  });

  it("returns an empty array when the Schedule A sheet is missing", () => {
    expect(parseScheduleA(workbookWithoutSheet("schedule a1"), "f")).toEqual([]);
  });

  it("returns an empty array for null / non-buffer / unreadable input", () => {
    expect(parseScheduleA(null, "f")).toEqual([]);
    expect(parseScheduleA(undefined, "f")).toEqual([]);
    expect(parseScheduleA("does-not-exist.xlsx", "f")).toEqual([]);
    expect(parseScheduleA(Buffer.from("not a workbook"), "f")).toEqual([]);
  });

  it("returns an empty array for the malformed fixture", () => {
    expect(parseScheduleA(malformedBuffer, "f")).toEqual([]);
  });
});
