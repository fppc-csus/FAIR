import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const db = vi.hoisted(() => ({
  conflict: { findMany: vi.fn() },
}));

vi.mock("../../src/lib/prisma.js", () => ({
  default: db,
  prisma: db,
}));

import conflictsRouter from "../../src/routes/conflicts.js";

const app = express();
app.use("/api/conflicts", conflictsRouter);
app.use((error, _req, res, _next) => {
  res.status(500).json({ error: error.message });
});

const headers = [
  "Politician", "City", "Conflict type", "Severity",
  "Agenda item", "Detected", "Full agenda item text",
  "FPPC rule reference",
];

function record(index, overrides = {}) {
  return {
    id: String(index).padStart(6, "0"),
    politician: {
      fullName: `Official ${index}`,
      jurisdiction: { name: "Sacramento" },
    },
    agendaItem: {
      cityName: "Sacramento",
      title: "Contract review",
      description: "Short description",
      itemText: "Complete agenda text",
    },
    conflictType: "INVESTMENT",
    severity: "HIGH",
    detectedAt: new Date("2026-10-11T12:00:00Z"),
    ruleReference: "Gov. Code 87103",
    ...overrides,
  };
}

function mockRecords(records) {
  db.conflict.findMany.mockImplementation(async (query) => {
    const active = records.filter((row) => row.eligibilityStatus !== "inactive");
    const start = query.cursor
      ? active.findIndex((row) => row.id === query.cursor.id)
        + query.skip
      : 0;
    return active.slice(start, start + query.take);
  });
}

// Parse CSV, including escaped quotes and embedded line breaks.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const character = text[i];
    if (character === '"') {
      if (quoted && text[i + 1] === '"') {
        value += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(value);
      value = "";
    } else if (character === "\r" && !quoted &&
               text[i + 1] === "\n") {
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
      i++;
    } else {
      value += character;
    }
  }
  return rows;
}

beforeEach(() => {
  db.conflict.findMany.mockReset();
});

describe("public CSV export", () => {
  it.each([0, 1, 500, 501])(
    "downloads all %i records without authentication",
    async (count) => {
      mockRecords(Array.from({ length: count }, (_, i) => record(i)));

      const response = await request(app).get("/api/conflicts/export");

      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toContain("text/csv");
      expect(response.headers["content-disposition"]).toMatch(
        /^attachment; filename="fair-conflicts-\d{4}-\d{2}-\d{2}\.csv"$/,
      );

      const rows = parseCsv(response.text);
      expect(rows[0]).toEqual(headers);
      expect(rows).toHaveLength(count + 1);
      expect(rows.slice(1).map((row) => row[0])).toEqual(
        Array.from({ length: count }, (_, i) => `Official ${i}`),
      );

      expect(db.conflict.findMany).toHaveBeenCalledTimes(
        Math.floor(count / 250) + 1,
      );
      for (const [query] of db.conflict.findMany.mock.calls) {
        expect(query.take).toBe(250);
        expect(query.orderBy).toEqual({ id: "asc" });
        expect(query.where).toEqual({ OR: [{ eligibilityStatus: null }, { eligibilityStatus: "active" }] });
      }
    },
  );

  it("exports eight columns and preserves full text, commas and quotes", async () => {
    const item = record(1);
    item.politician.fullName = 'Rivera, "Alex"';
    item.agendaItem.itemText = 'First line,\nSecond "quoted" line';
    mockRecords([item]);

    const response = await request(app).get("/api/conflicts/export");

    expect(response.status).toBe(200);
    expect(parseCsv(response.text)[1]).toEqual([
      'Rivera, "Alex"',
      "Sacramento",
      "INVESTMENT",
      "HIGH",
      "Contract review",
      "2026-10-11T12:00:00.000Z",
      'First line,\nSecond "quoted" line',
      "Gov. Code 87103",
    ]);
  });

  it("excludes inactive automated candidates but retains legacy records", async () => {
    mockRecords([record(1, { eligibilityStatus: "inactive" }), record(2, { eligibilityStatus: null })]);
    const response = await request(app).get("/api/conflicts/export");
    expect(parseCsv(response.text).slice(1).map((row) => row[0])).toEqual(["Official 2"]);
  });

  it.each([
    ["city=Davis", 0],
    ["types=GIFT", 0],
    ["severities=LOW", 0],
    ["fromDate=2026-10-12", 0],
    ["toDate=2026-10-10", 0],
    ["city=Sacramento&types=INVESTMENT&severities=HIGH", 1],
    ["fromDate=2026-10-11&toDate=2026-10-11", 1],
    ["types=GIFT&types=INVESTMENT&severities=high", 1],
  ])("respects filters: %s", async (query, expectedCount) => {
    mockRecords([record(1)]);

    const response = await request(app).get(
      `/api/conflicts/export?${query}`,
    );

    expect(response.status).toBe(200);
    expect(parseCsv(response.text)).toHaveLength(expectedCount + 1);
  });

  it("finds a filtered match beyond the first database batch", async () => {
    const records = Array.from({ length: 501 }, (_, i) => record(i));
    records[500].agendaItem.cityName = "Davis";
    mockRecords(records);

    const response = await request(app).get(
      "/api/conflicts/export?city=Davis",
    );

    expect(response.status).toBe(200);
    const rows = parseCsv(response.text);
    expect(rows).toHaveLength(2);
    expect(rows[1][0]).toBe("Official 500");
    expect(db.conflict.findMany).toHaveBeenCalledTimes(3);
  });

  it.each([
    "fromDate=2026-02-30",
    "fromDate=2026-10-12&toDate=2026-10-11",
  ])("rejects invalid dates: %s", async (query) => {
    const response = await request(app).get(
      `/api/conflicts/export?${query}`,
    );

    expect(response.status).toBe(400);
    expect(db.conflict.findMany).not.toHaveBeenCalled();
  });

  it("protects spreadsheet cells from formula execution", async () => {
    const item = record(1);
    item.politician.fullName = "=1+1";
    mockRecords([item]);

    const response = await request(app).get("/api/conflicts/export");

    expect(response.status).toBe(200);
    expect(parseCsv(response.text)[1][0]).toBe("'=1+1");
  });

  it("returns an error if the database fails before download starts", async () => {
    db.conflict.findMany.mockRejectedValue(new Error("Database unavailable"));

    const response = await request(app).get("/api/conflicts/export");

    expect(response.status).toBe(500);
    expect(response.headers["content-disposition"]).toBeUndefined();
  });
});