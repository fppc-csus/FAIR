import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import * as XLSX from "xlsx";
import { parseScheduleCDE } from "../../src/parsers/scheduleCDE.js";

const validBuffer = fs.readFileSync(path.resolve("tests/fixtures/form700-valid.xlsx"));
const malformedBuffer = fs.readFileSync(path.resolve("tests/fixtures/form700-malformed.xlsx"));

function bufferFromSheets(sheets) {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

describe("parseScheduleCDE", () => {
  it("returns snake_case rows for Schedules C, D and E from a valid buffer", () => {
    const result = parseScheduleCDE(validBuffer, "filing-1");

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);

    for (const row of result) {
      expect(Object.keys(row).filter((key) => key !== "details").sort()).toEqual(
        ["source_name", "amount", "schedule_type", "filing_id"].sort(),
      );
      expect(row).not.toHaveProperty("sourceName");
      expect(["C", "D", "E"]).toContain(row.schedule_type);
      expect(row.filing_id).toBe("filing-1");
      expect(row.source_name).toBeTruthy();
    }

    const types = new Set(result.map((r) => r.schedule_type));
    expect(types).toEqual(new Set(["C", "D", "E"]));
  });

  it("maps the per-schedule dollar column (C: gross income, D: value, E: amount) to amount", () => {
    const result = parseScheduleCDE(validBuffer, "f");

    const c = result.find((r) => r.schedule_type === "C");
    expect(c).toMatchObject({
      source_name: "Sonoma Ecology Center",
      amount: "$10,001 - $100,000",
      schedule_type: "C",
      filing_id: "f",
    });

    const d = result.find((r) => r.schedule_type === "D");
    expect(d.source_name).toBe("Sonoma County Farm Bureau");
    expect(d.amount).toBe("125");

    const e = result.find((r) => r.schedule_type === "E");
    expect(e.source_name).toMatch(/CSAC/);
    expect(e.amount).toBe("3029.5");
  });

  it("returns only the schedules present when some sheets are missing", () => {
    const buffer = bufferFromSheets({
      "Schedule D": [
        ["NAME OF SOURCE", "VALUE", "DESCRIPTION OF GIFT(S)"],
        ["Farm Bureau", 125, "ticket"],
      ],
    });

    expect(parseScheduleCDE(buffer, "f")).toMatchObject([
      { source_name: "Farm Bureau", amount: "125", schedule_type: "D", filing_id: "f" },
    ]);
  });

  it("returns an empty array when no C/D/E sheets exist", () => {
    const buffer = bufferFromSheets({ "Schedule A": [["NAME OF BUSINESS ENTITY"], ["Acme"]] });
    expect(parseScheduleCDE(buffer, "f")).toEqual([]);
  });

  it("returns an empty array for null / unreadable / malformed input", () => {
    expect(parseScheduleCDE(null, "f")).toEqual([]);
    expect(parseScheduleCDE("does-not-exist.xlsx", "f")).toEqual([]);
    expect(parseScheduleCDE(Buffer.from("garbage"), "f")).toEqual([]);
    expect(parseScheduleCDE(malformedBuffer, "f")).toEqual([]);
  });
});
