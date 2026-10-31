/**
 * Admin Form 700 upload — POST /api/admin/upload/form700 (multipart, field `file`).
 *
 * Mounted in app.js behind `requireAdmin`; this router does NOT re-apply auth.
 *
 * Flow: multer (memory, 10 MB) → MIME check → XLSX.read → sheet-name sanity
 * check → parseCoverPage → resolve politician → duplicate-year pre-check →
 * transactional filing/schedule write and durable detection-run creation.
 * Corrections archive first, then replace schedules transactionally; new
 * filings archive after commit and are removed if archiving fails. Detection is
 * queued only after both database and archive writes succeed.
 *
 * Responses
 *   200 { filing_id, politician_id, schedules_parsed: { A, B, CDE, A2 }, archived_path, detection }
 *   400 bad/missing file, wrong MIME, unreadable XLSX, unrecognised sheets,
 *       filer/filing year could not be determined
 *   409 filing already exists for this politician + filing year unless
 *       `replace_existing=true` explicitly requests a correction
 *   413 file larger than 10 MB
 *   500 archive failure / unexpected error (via next(err))
 */
import express from "express";
import multer from "multer";
import * as XLSX from "xlsx";

import { prisma } from "../../lib/prisma.js";
import { archiveWorkbook, deleteWorkbook, XLSX_MIME } from "../../lib/storage.js";
import { parseCoverPage } from "../../parsers/coverPage.js";
import { parseScheduleA } from "../../parsers/scheduleA.js";
import { parseScheduleA2 } from "../../parsers/scheduleA2.js";
import { parseScheduleB } from "../../parsers/scheduleB.js";
import { parseScheduleCDE } from "../../parsers/scheduleCDE.js";
import { findOrCreatePolitician } from "../../utils/findOrCreatePolitician.js";
import { queueDetectionRun } from "../../detection/detectionRuns.js";
import { redetectDisclosureAgendaItems } from "../../detection/redetectDisclosure.js";
import { parseForm700Bulk } from "../../parsers/form700Bulk.js";
import { previewForm700Bulk, importForm700Bulk } from "../../ingestion/form700Bulk.js";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

const RECOGNISED_SHEET_KEYWORDS = [
  "cover",
  "schedule a",
  "schedule b",
  "schedule c",
  "schedule d",
  "schedule e",
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
});

/** Wrap multer so size-limit errors become 413 and other multer errors 400. */
function receiveFile(req, res, next) {
  upload.single("file")(req, res, (err) => {
    if (!err) return next();

    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({ error: "File too large. Maximum upload size is 10 MB." });
      }
      return res.status(400).json({ error: `Upload rejected: ${err.message}` });
    }

    return next(err);
  });
}

export function hasRecognizableForm700Sheets(sheetNames = []) {
  return sheetNames.some((name) => {
    const normalized = String(name ?? "").trim().toLowerCase();
    return RECOGNISED_SHEET_KEYWORDS.some((keyword) => normalized.includes(keyword));
  });
}

function isDuplicateError(error) {
  return error?.code === "P2002";
}

function cleanBodyString(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

function parseFilingYear(value) {
  const text = cleanBodyString(value);
  if (!text) return null;
  const year = Number(text);
  return Number.isInteger(year) && year >= 1900 && year <= 2100 ? year : null;
}

// --- snake_case parser rows → Prisma camelCase createMany payloads ---------

function toScheduleA(rows, ids) {
  return rows.map((row) => ({
    ...ids,
    entityName: row.entity_name,
    fairMarketValue: row.fair_market_value ?? null,
    natureOfInvestment: row.nature_of_investment ?? null,
  }));
}

function toScheduleB(rows, ids) {
  return rows.map((row) => ({
    ...ids,
    propertyDescription: row.property_description ?? null,
    city: row.city ?? null,
    county: row.county ?? null,
    fairMarketValue: row.fair_market_value ?? null,
    natureOfInterest: row.nature_of_interest ?? null,
  }));
}

function toScheduleCDE(rows, ids) {
  return rows.map((row) => ({
    ...ids,
    scheduleType: row.schedule_type,
    sourceName: row.source_name ?? null,
    amount: row.amount ?? null,
  }));
}

function toScheduleA2(rows, ids) {
  return rows.map((row) => ({
    ...ids,
    entityName: row.entity_name,
    businessPosition: row.business_position ?? null,
    fairMarketValue: row.fair_market_value ?? null,
    natureOfInvestment: row.nature_of_investment ?? null,
    grossIncomeRange: row.gross_income_range ?? null,
  }));
}

router.post('/form700/bulk/:action', receiveFile, async (req, res, next) => {
  try {
    if (!['preview', 'import'].includes(req.params.action)) return res.status(404).json({ error: 'Unknown upload action.' });
    if (!req.file || !/\.xlsx$/i.test(req.file.originalname) || req.file.mimetype !== XLSX_MIME) return res.status(400).json({ error: 'Choose a valid .xlsx workbook.' });
    let preview;
    try { preview = await previewForm700Bulk(req.file.buffer, prisma); }
    catch (error) {
      // Parser errors are actionable; database failures are handled by the global handler.
      if (error.code || error.name?.startsWith('Prisma')) throw error;
      return res.status(400).json({ error: error.message });
    }
    if (req.params.action === 'preview') {
      return res.json({ ...preview, filings: preview.filings.map(({ schedules, ...filing }) => filing) });
    }
    if (req.body.digest !== preview.digest) return res.status(409).json({ error: 'Preview this workbook before importing. The preview must match the selected file.' });
    // Record the attempt before any filing writes, so an interrupted process
    // remains visible as running rather than disappearing from the audit trail.
    const run = await prisma.form700ImportRun.create({ data: {
      originalFilename: req.file.originalname,
      sourceDigest: preview.digest,
      adminUserId: req.user?.id ?? null,
      status: 'running',
      warnings: preview.warnings,
    } });
    const result = await importForm700Bulk(req.file.buffer, req.file.originalname, preview, {
      prisma, archiveWorkbook, deleteWorkbook, redetect: redetectDisclosureAgendaItems,
    });
    const status = result.failed > 0 ? (result.imported > 0 || result.skipped > 0 ? 'partial' : 'failed') : 'completed';
    await prisma.form700ImportRun.update({ where: { id: run.id }, data: {
      status,
      importedCount: result.imported,
      skippedCount: result.skipped,
      failedCount: result.failed,
      warnings: result.warnings,
      results: result.results,
    } });
    return res.json(result);
  } catch (error) { return next(error); }
});

router.post("/form700", receiveFile, async (req, res, next) => {
  try {
    // 1. File present + MIME ----------------------------------------------
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: "Missing XLSX upload (multipart field `file`)." });
    }

    if (!/\.xlsx$/i.test(req.file.originalname ?? "")) {
      return res.status(400).json({ error: "Only .xlsx files are accepted." });
    }

    // Strict: clients must send the XLSX content type (curl: `-F "file=@x.xlsx;type=<mime>"`).
    if (req.file.mimetype !== XLSX_MIME) {
      return res.status(400).json({
        error: `Invalid file type "${req.file.mimetype}". Expected ${XLSX_MIME}.`,
      });
    }

    // 2. Readable workbook with Form 700 sheets ------------------------------
    let workbook;
    try {
      workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    } catch {
      return res.status(400).json({ error: "Uploaded file is not a valid XLSX workbook." });
    }

    if (!workbook || !hasRecognizableForm700Sheets(workbook.SheetNames)) {
      return res.status(400).json({
        error:
          "Workbook does not contain any recognizable Form 700 sheets (Cover Page, Schedule A/A-2/B/C/D/E).",
      });
    }

    // Never allow a county-wide export to be attached to its first filer.
    let bulk;
    const hasFilerColumns = workbook.SheetNames.some(name => {
      if (!/^schedule/i.test(name)) return false;
      return XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1 }).slice(0, 15)
        .some(row => row.some(cell => String(cell ?? '').trim().toLowerCase() === 'last name'));
    });
    if (hasFilerColumns) {
      try { bulk = parseForm700Bulk(workbook); }
      catch {
        return res.status(400).json({ error: 'Filer-tagged export could not be safely isolated. Use the bulk Form 700 preview to review validation errors.' });
      }
    }
    if (bulk && (bulk.filings.length > 1 || bulk.filings.some(filing => filing.versions.length > 1))) {
      return res.status(400).json({ error: 'This workbook contains multiple filers or submissions. Use the bulk Form 700 preview and import.' });
    }

    // 3. Filer metadata ------------------------------------------------------
    const cover = parseCoverPage(workbook);
    const filerName = cleanBodyString(req.body?.filer_name) ?? cover.filer_name;
    const district = cleanBodyString(req.body?.district) ?? cover.district;
    const officeTitle = cleanBodyString(req.body?.office_title) ?? cover.office_title;
    const filingYear = parseFilingYear(req.body?.filing_year) ?? cover.filing_year;

    if (!filingYear) {
      return res.status(400).json({
        error: "Could not determine the filing year from the cover page; supply `filing_year`.",
      });
    }

    // 4. Politician: explicit override or entity resolution ------------------
    let politicianId = cleanBodyString(req.body?.politician_id);
    if (politicianId && !UUID_RE.test(politicianId)) {
      return res.status(400).json({ error: "politician_id must be a UUID." });
    }

    if (!politicianId) {
      if (!filerName) {
        return res.status(400).json({
          error:
            "Could not determine the filer name from the cover page; supply `politician_id` or `filer_name`.",
        });
      }
      politicianId = await findOrCreatePolitician(filerName, district, { officeTitle });
    }

    // 5. Duplicate pre-check (unique politicianId + filingYear) ----------------
    const existing = await prisma.form700Filing.findUnique({
      where: { politicianId_filingYear: { politicianId, filingYear } },
      select: { id: true },
    });
    const replaceExisting = String(req.body?.replace_existing ?? "").toLowerCase() === "true";
    if (existing && !replaceExisting) {
      return res.status(409).json({
        error: `A Form 700 filing for this politician and filing year (${filingYear}) already exists.`,
        filing_id: existing.id,
      });
    }

    let replacementArchivePath = null;
    if (existing) {
      try {
        replacementArchivePath = await archiveWorkbook(req.file.buffer, req.file.originalname, {
          filingId: existing.id,
          politicianId,
        });
      } catch (error) {
        const err = new Error(`Failed to archive corrected workbook: ${error?.message ?? error}`);
        err.statusCode = 500;
        return next(err);
      }
    }

    // 6. Filing + schedule rows in one transaction ----------------------------
    let filingId;
    let detectionRunId;
    let schedulesParsed;
    try {
      const result = await prisma.$transaction(async (tx) => {
        const filing = existing
          ? await tx.form700Filing.update({
              where: { id: existing.id },
              data: {
                filerName: filerName ?? null,
                originalFilename: req.file.originalname ?? null,
                archivedPath: replacementArchivePath,
                storagePath: replacementArchivePath,
              },
              select: { id: true },
            })
          : await tx.form700Filing.create({
              data: {
                politicianId,
                filingYear,
                filerName: filerName ?? null,
                originalFilename: req.file.originalname ?? null,
              },
              select: { id: true },
            });

        if (existing) {
          await Promise.all([
            tx.scheduleAInvestment.deleteMany({ where: { filingId: filing.id } }),
            tx.scheduleBRealEstate.deleteMany({ where: { filingId: filing.id } }),
            tx.scheduleCdeIncome.deleteMany({ where: { filingId: filing.id } }),
            tx.scheduleA2BusinessPosition.deleteMany({ where: { filingId: filing.id } }),
          ]);
        }

        const ids = { filingId: filing.id, politicianId };

        const rowsA = parseScheduleA(workbook, filing.id);
        const rowsB = parseScheduleB(workbook, filing.id);
        const rowsCDE = parseScheduleCDE(workbook, filing.id);
        const rowsA2 = parseScheduleA2(workbook, filing.id);

        if (rowsA.length > 0) {
          await tx.scheduleAInvestment.createMany({ data: toScheduleA(rowsA, ids) });
        }
        if (rowsB.length > 0) {
          await tx.scheduleBRealEstate.createMany({ data: toScheduleB(rowsB, ids) });
        }
        if (rowsCDE.length > 0) {
          await tx.scheduleCdeIncome.createMany({ data: toScheduleCDE(rowsCDE, ids) });
        }
        if (rowsA2.length > 0) {
          await tx.scheduleA2BusinessPosition.createMany({ data: toScheduleA2(rowsA2, ids) });
        }

        const detectionRun = await tx.detectionRun.create({
          data: {
            filingId: filing.id,
            politicianId,
            filingYear,
            trigger: "form700_upload",
            status: "queued",
          },
          select: { id: true },
        });

        return {
          filingId: filing.id,
          detectionRunId: detectionRun.id,
          schedulesParsed: {
            A: rowsA.length,
            B: rowsB.length,
            CDE: rowsCDE.length,
            A2: rowsA2.length,
          },
        };
      });

      filingId = result.filingId;
      detectionRunId = result.detectionRunId;
      schedulesParsed = result.schedulesParsed;
    } catch (error) {
      if (replacementArchivePath) {
        try {
          await deleteWorkbook(replacementArchivePath);
        } catch (cleanupError) {
          console.error("[upload] failed to delete corrected workbook after transaction error:", cleanupError);
        }
      }
      if (isDuplicateError(error)) {
        return res.status(409).json({
          error: `A Form 700 filing for this politician and filing year (${filingYear}) already exists.`,
        });
      }
      throw error;
    }

    // 7. Archive the raw workbook (after commit) ------------------------------
    let archivedPath;
    try {
      archivedPath = await archiveWorkbook(req.file.buffer, req.file.originalname, {
        filingId,
        politicianId,
      });
      await prisma.form700Filing.update({
        where: { id: filingId },
        data: { archivedPath, storagePath: archivedPath },
      });
    } catch (error) {
      // Roll back the committed filing (schedule rows cascade) so a failed
      // archive never leaves a half-ingested filing behind.
      if (archivedPath) {
        try {
          await deleteWorkbook(archivedPath);
        } catch (cleanupError) {
          console.error("[upload] failed to delete archived workbook after archive error:", {
            filingId,
            politicianId,
            archivedPath,
            error: cleanupError?.message ?? cleanupError,
          });
        }
      }
      try {
        await prisma.form700Filing.delete({ where: { id: filingId } });
      } catch (cleanupError) {
        console.error("[upload] failed to delete filing after archive error:", {
          filingId,
          politicianId,
          error: cleanupError?.message ?? cleanupError,
        });
      }
      const err = new Error("Failed to archive workbook.");
      err.statusCode = 500;
      err.publicMessage = "Failed to archive workbook. Contact an administrator to check storage before uploading again.";
      return next(err);
    }

    queueDetectionRun(detectionRunId);

    const politician = await prisma.politician.findUnique({
      where: { id: politicianId },
      select: { fullName: true, slug: true },
    });
    const detection = await redetectDisclosureAgendaItems({
      politicianId,
      filingYear,
      prisma,
    });

    return res.status(200).json({
      filing_id: filingId,
      corrected: Boolean(existing),
      detection_run_id: detectionRunId,
      detection_run_status: "queued",
      politician_id: politicianId,
      politician: politician
        ? { name: politician.fullName, slug: politician.slug }
        : null,
      schedules_parsed: schedulesParsed,
      archived_path: archivedPath,
      detection: {
        agenda_items_processed: detection.agendaItemsProcessed,
        conflict_candidates: detection.conflictCandidates,
        conflicts_detected: detection.conflictsDetected,
        conflicts_skipped: detection.conflictsSkipped,
        failures: detection.detectionErrors,
        skipped_reason: detection.skippedReason,
      },
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
