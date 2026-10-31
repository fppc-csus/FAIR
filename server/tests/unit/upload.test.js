import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import request from "supertest";
import * as XLSX from 'xlsx';

// --- mocks (hoisted by vitest) ---------------------------------------------

vi.mock("../../src/lib/auth.js", () => {
  const requireAdmin = vi.fn((_req, _res, next) => next());
  return { requireAdmin, default: requireAdmin };
});

vi.mock("../../src/lib/prisma.js", () => {
  const tx = {
    form700Filing: { create: vi.fn() },
    scheduleAInvestment: { createMany: vi.fn() },
    scheduleBRealEstate: { createMany: vi.fn() },
    scheduleCdeIncome: { createMany: vi.fn() },
    scheduleA2BusinessPosition: { createMany: vi.fn() },
  };
  const prisma = {
    __tx: tx,
    $transaction: vi.fn(async (fn) => fn(tx)),
    form700Filing: {
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    politician: { findUnique: vi.fn() },
    jurisdiction: { findMany: vi.fn() },
    form700ImportRun: { create: vi.fn(), update: vi.fn() },
  };
  return { prisma, default: prisma };
});

vi.mock("../../src/lib/storage.js", () => ({
  XLSX_MIME: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  archiveWorkbook: vi.fn(),
  getWorkbook: vi.fn(),
  deleteWorkbook: vi.fn(),
}));

vi.mock("../../src/utils/findOrCreatePolitician.js", () => ({
  findOrCreatePolitician: vi.fn(),
}));

vi.mock("../../src/detection/redetectDisclosure.js", () => ({
  redetectDisclosureAgendaItems: vi.fn(),
}));

// Belt and braces: app.js does not schedule cron, but never let a test touch it.
vi.mock("../../src/jobs/scheduleCronJobs.js", () => ({ scheduleCronJobs: vi.fn() }));

import { app } from "../../src/app.js";
import { requireAdmin } from "../../src/lib/auth.js";
import { prisma } from "../../src/lib/prisma.js";
import { archiveWorkbook, deleteWorkbook, XLSX_MIME } from "../../src/lib/storage.js";
import { findOrCreatePolitician } from "../../src/utils/findOrCreatePolitician.js";
import { redetectDisclosureAgendaItems } from "../../src/detection/redetectDisclosure.js";

const ENDPOINT = "/api/admin/upload/form700";
// The old fixture is a county-wide export. Give its schedule rows one synthetic
// owner/version for legacy single-filing transaction tests; bulk tests use the
// untouched workbook and verify that cross-filer assignments are rejected.
const singleWorkbook = XLSX.read(fs.readFileSync(path.resolve('tests/fixtures/form700-valid.xlsx')));
for (const name of singleWorkbook.SheetNames) {
  const sheet = singleWorkbook.Sheets[name];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  const header = rows.findIndex(row => row.includes('Last Name'));
  if (header < 0) continue;
  for (const row of rows.slice(header + 1)) {
    if (!row[0] || !row[1]) continue;
    row[0] = 'Gore'; row[1] = 'James'; row[2] = 'M'; row[7] = 'Annual'; row[10] = 43922;
  }
  singleWorkbook.Sheets[name] = XLSX.utils.aoa_to_sheet(rows);
}
const validBuffer = XLSX.write(singleWorkbook, { type: 'buffer', bookType: 'xlsx' });
const malformedBuffer = fs.readFileSync(path.resolve("tests/fixtures/form700-malformed.xlsx"));

const POLITICIAN_ID = "11111111-2222-4333-8444-555555555555";
const FILING_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ARCHIVED_PATH = `filings/${POLITICIAN_ID}/${FILING_ID}/123-form700-valid.xlsx`;

function postFile(buffer, { filename = "form700-valid.xlsx", contentType = XLSX_MIME, fields = {} } = {}) {
  let req = request(app).post(ENDPOINT).set("Authorization", "Bearer test-jwt");
  for (const [key, value] of Object.entries(fields)) {
    req = req.field(key, value);
  }
  return req.attach("file", buffer, { filename, contentType });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});

  requireAdmin.mockImplementation((_req, _res, next) => next());
  findOrCreatePolitician.mockResolvedValue(POLITICIAN_ID);
  prisma.form700Filing.findUnique.mockResolvedValue(null);
  prisma.form700Filing.update.mockResolvedValue({ id: FILING_ID });
  prisma.form700Filing.delete.mockResolvedValue({ id: FILING_ID });
  prisma.politician.findUnique.mockResolvedValue({ fullName: "James M Gore", slug: "james-m-gore" });
  prisma.jurisdiction.findMany.mockResolvedValue([]);
  prisma.form700ImportRun.create.mockResolvedValue({ id: 'run-id' });
  prisma.form700ImportRun.update.mockResolvedValue({ id: 'run-id' });
  prisma.$transaction.mockImplementation(async (fn) => fn(prisma.__tx));
  prisma.__tx.form700Filing.create.mockResolvedValue({ id: FILING_ID });
  for (const model of [
    "scheduleAInvestment",
    "scheduleBRealEstate",
    "scheduleCdeIncome",
    "scheduleA2BusinessPosition",
  ]) {
    prisma.__tx[model].createMany.mockImplementation(async ({ data }) => ({ count: data.length }));
  }
  archiveWorkbook.mockResolvedValue(ARCHIVED_PATH);
  deleteWorkbook.mockResolvedValue(undefined);
  redetectDisclosureAgendaItems.mockResolvedValue({
    agendaItemsProcessed: 2,
    conflictCandidates: 1,
    conflictsDetected: 1,
    conflictsSkipped: 0,
    detectionErrors: [],
    skippedReason: null,
  });
});

describe("POST /api/admin/upload/form700", () => {
  it('rejects a multi-filer workbook on the single-filing route', async () => {
    const buffer = fs.readFileSync(path.resolve('../docs/County of Sonoma -- Form 700 (2019).xlsx'));
    const res = await postFile(buffer);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('bulk Form 700');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('requires authentication for bulk previews', async () => {
    requireAdmin.mockImplementation((_req, res) => res.status(401).json({ error: 'unauthorized' }));
    const res = await request(app).post('/api/admin/upload/form700/bulk/preview');
    expect(res.status).toBe(401);
  });

  it('previews a bulk export without writes and rejects unconfirmed imports', async () => {
    const buffer = fs.readFileSync(path.resolve('../docs/County of Sonoma -- Form 700 (2019).xlsx'));
    const preview = await request(app).post('/api/admin/upload/form700/bulk/preview')
      .attach('file', buffer, { filename: 'county.xlsx', contentType: XLSX_MIME });
    expect(preview.status).toBe(200);
    expect(preview.body.filings).toHaveLength(13);
    expect(preview.body.filings[0]).not.toHaveProperty('schedules');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    const unconfirmed = await request(app).post('/api/admin/upload/form700/bulk/import')
      .field('digest', 'wrong').attach('file', buffer, { filename: 'county.xlsx', contentType: XLSX_MIME });
    expect(unconfirmed.status).toBe(409);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('records a confirmed bulk import attempt for durable history', async () => {
    const buffer = fs.readFileSync(path.resolve('../docs/County of Sonoma -- Form 700 (2019).xlsx'));
    prisma.form700Filing.findUnique.mockResolvedValue({ id: 'existing' });
    prisma.politician.findMany = vi.fn().mockResolvedValue([{ id: POLITICIAN_ID, fullName: 'James M Gore' }]);
    prisma.jurisdiction.findMany.mockResolvedValue([{ id: 'jurisdiction' }]);
    const preview = await request(app).post('/api/admin/upload/form700/bulk/preview').attach('file', buffer, { filename: 'county.xlsx', contentType: XLSX_MIME });
    const response = await request(app).post('/api/admin/upload/form700/bulk/import').field('digest', preview.body.digest).attach('file', buffer, { filename: 'county.xlsx', contentType: XLSX_MIME });
    expect(response.status).toBe(200);
    expect(prisma.form700ImportRun.create).toHaveBeenCalledWith({ data: expect.objectContaining({ originalFilename: 'county.xlsx', sourceDigest: preview.body.digest }) });
    expect(prisma.form700ImportRun.create.mock.calls[0][0].data.status).toBe('running');
    expect(prisma.form700ImportRun.update).toHaveBeenCalledWith({ where: { id: 'run-id' }, data: expect.objectContaining({ skippedCount: 1, failedCount: 12, status: 'partial' }) });
  });

  it('rejects missing bulk files and unknown actions', async () => {
    expect((await request(app).post('/api/admin/upload/form700/bulk/preview')).status).toBe(400);
    expect((await request(app).post('/api/admin/upload/form700/bulk/unknown')).status).toBe(404);
  });
  it("ingests a valid XLSX: 200 with filing id, politician id, schedule counts and archive path", async () => {
    const res = await postFile(validBuffer);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      filing_id: FILING_ID,
      politician_id: POLITICIAN_ID,
      politician: { name: "James M Gore", slug: "james-m-gore" },
      schedules_parsed: { A: 39, B: 15, CDE: 24, A2: 17 },
      archived_path: ARCHIVED_PATH,
      detection: {
        agenda_items_processed: 2,
        conflict_candidates: 1,
        conflicts_detected: 1,
        conflicts_skipped: 0,
        failures: [],
        skipped_reason: null,
      },
    });

    // Politician resolved from the cover-page/filer metadata, not a form field.
    expect(findOrCreatePolitician).toHaveBeenCalledWith("James M Gore", null, {
      officeTitle: "Supervisor",
    });

    // Duplicate pre-check on the (politicianId, filingYear) unique key.
    expect(prisma.form700Filing.findUnique).toHaveBeenCalledWith({
      where: { politicianId_filingYear: { politicianId: POLITICIAN_ID, filingYear: 2019 } },
      select: { id: true },
    });

    // Single transaction: filing + all four schedule createMany calls.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const tx = prisma.__tx;
    expect(tx.form700Filing.create).toHaveBeenCalledTimes(1);
    expect(tx.form700Filing.create.mock.calls[0][0].data).toMatchObject({
      politicianId: POLITICIAN_ID,
      filingYear: 2019,
      filerName: "James M Gore",
      originalFilename: "form700-valid.xlsx",
    });

    expect(tx.scheduleAInvestment.createMany).toHaveBeenCalledTimes(1);
    expect(tx.scheduleBRealEstate.createMany).toHaveBeenCalledTimes(1);
    expect(tx.scheduleCdeIncome.createMany).toHaveBeenCalledTimes(1);
    expect(tx.scheduleA2BusinessPosition.createMany).toHaveBeenCalledTimes(1);

    // Rows are mapped to Prisma camelCase fields and tagged with filing/politician ids.
    const aRows = tx.scheduleAInvestment.createMany.mock.calls[0][0].data;
    expect(aRows).toHaveLength(39);
    expect(aRows[0]).toEqual({
      filingId: FILING_ID,
      politicianId: POLITICIAN_ID,
      entityName: "Scoop",
      fairMarketValue: "$2,000 - $10,000",
      natureOfInvestment: "Advisory Shares",
    });
    expect(aRows[0]).not.toHaveProperty("entity_name");

    const bRows = tx.scheduleBRealEstate.createMany.mock.calls[0][0].data;
    expect(bRows[0]).toMatchObject({ city: "Penngrove", county: null });
    expect(bRows[0]).not.toHaveProperty("agency");

    const cdeRows = tx.scheduleCdeIncome.createMany.mock.calls[0][0].data;
    expect(new Set(cdeRows.map((r) => r.scheduleType))).toEqual(new Set(["C", "D", "E"]));

    const a2Rows = tx.scheduleA2BusinessPosition.createMany.mock.calls[0][0].data;
    expect(a2Rows[0]).toMatchObject({
      entityName: "Gore Family Vineyards",
      businessPosition: "Co-Owner",
      grossIncomeRange: "$0 - $499",
    });

    // Archived AFTER commit, then path recorded on the filing.
    expect(archiveWorkbook).toHaveBeenCalledTimes(1);
    const [buf, filename, ids] = archiveWorkbook.mock.calls[0];
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.equals(validBuffer)).toBe(true);
    expect(filename).toBe("form700-valid.xlsx");
    expect(ids).toEqual({ filingId: FILING_ID, politicianId: POLITICIAN_ID });
    expect(prisma.form700Filing.update).toHaveBeenCalledWith({
      where: { id: FILING_ID },
      data: { archivedPath: ARCHIVED_PATH, storagePath: ARCHIVED_PATH },
    });
    expect(redetectDisclosureAgendaItems).toHaveBeenCalledWith({
      politicianId: POLITICIAN_ID,
      filingYear: 2019,
      prisma,
    });
    expect(prisma.form700Filing.delete).not.toHaveBeenCalled();
  });

    it("ingests a workbook with missing optional schedules", async () => {
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(validBuffer, { type: "buffer" });

    const optionalSchedule = /schedule\s+(?:b|c|d|e|a-2)\b/i;

    workbook.SheetNames = workbook.SheetNames.filter((sheetName) => {
      if (optionalSchedule.test(sheetName)) {
        delete workbook.Sheets[sheetName];
        return false;
      }
      return true;
    });

    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    const res = await postFile(buffer, { filename: "form700-missing-optional.xlsx" });

    expect(res.status).toBe(200);
    expect(res.body.filing_id).toBe(FILING_ID);
    expect(res.body.politician_id).toBe(POLITICIAN_ID);
    expect(res.body.schedules_parsed).toMatchObject({
      A: 39,
      B: 0,
      CDE: 0,
      A2: 0,
    });
    expect(res.body.archived_path).toBe(ARCHIVED_PATH);
  });

    it("logs when filing cleanup fails after an archive error", async () => {
    prisma.form700Filing.update.mockRejectedValueOnce(new Error("database unavailable"));
    prisma.form700Filing.delete.mockRejectedValueOnce(new Error("filing delete failed"));

    const res = await postFile(validBuffer);

    expect(res.status).toBe(500);
    expect(console.error).toHaveBeenCalledWith(
      "[upload] failed to delete filing after archive error:",
      expect.objectContaining({
        filingId: FILING_ID,
        politicianId: POLITICIAN_ID,
        error: "filing delete failed",
      }),
    );
  });

  it("uses an explicit politician_id form field instead of entity resolution", async () => {
    const override = "99999999-8888-4777-8666-555555555555";
    const res = await postFile(validBuffer, { fields: { politician_id: override } });

    expect(res.status).toBe(200);
    expect(res.body.politician_id).toBe(override);
    expect(findOrCreatePolitician).not.toHaveBeenCalled();
  });

  it("returns 400 for non-XLSX bytes renamed to .xlsx", async () => {
    const res = await postFile(Buffer.from("this,is,a,csv\n1,2,3,4\n"), { filename: "fake.xlsx" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/recognizable Form 700|valid XLSX/i);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(archiveWorkbook).not.toHaveBeenCalled();
  });

  it("rejects files without an .xlsx extension before parsing", async () => {
    const res = await postFile(validBuffer, { filename: "form700.xml" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Only \.xlsx files are accepted/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("returns 400 for the malformed fixture", async () => {
    const res = await postFile(malformedBuffer, { filename: "form700-malformed.xlsx" });

    expect(res.status).toBe(400);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("returns 400 for a workbook with no recognizable Form 700 sheets", async () => {
    const XLSX = await import("xlsx");
    const workbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([["Instructions"], ["Not a Form 700 workbook"]]),
      "Instructions",
    );

    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    const res = await postFile(buffer, { filename: "unsupported.xlsx" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/recognizable Form 700 sheets/i);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(archiveWorkbook).not.toHaveBeenCalled();
  });

  it("returns 400 when the MIME type is not XLSX", async () => {
    const res = await postFile(validBuffer, { contentType: "text/plain" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid file type/);
  });

  it("returns 400 when no file is attached", async () => {
    const res = await request(app)
      .post(ENDPOINT)
      .set("Authorization", "Bearer test-jwt")
      .field("politician_id", POLITICIAN_ID);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Missing XLSX upload/);
  });

  it("returns 401 for an unauthenticated request and never touches parsing or the DB", async () => {
    requireAdmin.mockImplementation((_req, res) => res.status(401).json({ error: "unauthorized" }));

    const res = await request(app).post(ENDPOINT).attach("file", validBuffer, {
      filename: "form700-valid.xlsx",
      contentType: XLSX_MIME,
    });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "unauthorized" });
    expect(findOrCreatePolitician).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(archiveWorkbook).not.toHaveBeenCalled();
  });

  it("returns 409 when a filing for the same politician + year already exists (pre-check)", async () => {
    prisma.form700Filing.findUnique.mockResolvedValue({ id: "existing-filing" });

    const res = await postFile(validBuffer);

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already exists/);
    expect(res.body.filing_id).toBe("existing-filing");
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(archiveWorkbook).not.toHaveBeenCalled();
  });

  it("returns 409 when the transaction hits the unique constraint (Prisma P2002 race)", async () => {
    const p2002 = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    prisma.__tx.form700Filing.create.mockRejectedValue(p2002);

    const res = await postFile(validBuffer);

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already exists/);
    expect(archiveWorkbook).not.toHaveBeenCalled();
  });

  it("returns 413 for a file larger than 10 MB", async () => {
    const big = Buffer.alloc(10 * 1024 * 1024 + 1, 0x41);

    const res = await postFile(big, { filename: "huge.xlsx" });

    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/10 MB/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("deletes the filing and returns 500 when archiving fails after commit", async () => {
    archiveWorkbook.mockRejectedValue(new Error("bucket unavailable"));

    const res = await postFile(validBuffer);

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/Failed to archive workbook/);
    expect(res.body).not.toHaveProperty('stack');
    expect(JSON.stringify(res.body)).not.toContain('bucket unavailable');
    expect(prisma.form700Filing.delete).toHaveBeenCalledWith({ where: { id: FILING_ID } });
    expect(prisma.form700Filing.update).not.toHaveBeenCalled();
  });

  it("deletes the archived workbook and filing when saving the archive path fails", async () => {
    prisma.form700Filing.update.mockRejectedValueOnce(new Error("database unavailable"));

    const res = await postFile(validBuffer);

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/Failed to archive workbook/);
    expect(deleteWorkbook).toHaveBeenCalledWith(ARCHIVED_PATH);
    expect(prisma.form700Filing.delete).toHaveBeenCalledWith({ where: { id: FILING_ID } });
    expect(prisma.form700Filing.update).toHaveBeenCalled();
  });

  it("logs enough information when archived workbook cleanup fails", async () => {
    prisma.form700Filing.update.mockRejectedValueOnce(new Error("database unavailable"));
    deleteWorkbook.mockRejectedValueOnce(new Error("storage delete failed"));

    const res = await postFile(validBuffer);

    expect(res.status).toBe(500);
    expect(console.error).toHaveBeenCalledWith(
      "[upload] failed to delete archived workbook after archive error:",
      expect.objectContaining({
          filingId: FILING_ID,
          politicianId: POLITICIAN_ID,
          archivedPath: ARCHIVED_PATH,
          error: "storage delete failed",
        }), 
    );
  });

  it("does not archive anything when a schedule insert fails inside the transaction", async () => {
    prisma.__tx.scheduleBRealEstate.createMany.mockRejectedValue(new Error("insert failed"));

    const res = await postFile(validBuffer);

    expect(res.status).toBe(500);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(archiveWorkbook).not.toHaveBeenCalled();
    expect(prisma.form700Filing.update).not.toHaveBeenCalled();
    expect(prisma.form700Filing.delete).not.toHaveBeenCalled();
  });

  it("returns 400 when neither the cover page nor the form supplies a filer", async () => {
    // Workbook with a recognisable sheet name but no filer columns / cover page.
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([["NAME OF BUSINESS ENTITY", "FAIR MARKET VALUE"], ["Acme", "$2,000 - $10,000"]]),
      "Schedule A",
    );
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    const missingYear = await postFile(buffer, { filename: "nocover.xlsx" });
    expect(missingYear.status).toBe(400);
    expect(missingYear.body.error).toMatch(/filing year/i);

    const missingFiler = await postFile(buffer, { filename: "nocover.xlsx", fields: { filing_year: "2025" } });
    expect(missingFiler.status).toBe(400);
    expect(missingFiler.body.error).toMatch(/filer name/i);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
