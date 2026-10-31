import { Prisma } from '@prisma/client';
import { parseConflictQuery, conflictSql } from '../utils/conflictQuery.js';
import express from "express";
import { prisma } from "../lib/prisma.js";
import { normalizeEntityName } from "../utils/entityNorm.js";
import {
  conflictInclude,
  dashboardRow,
  matchesFilters,
  csvHeaders,
  csvLine,
  conflictCsvLine,
} from "../utils/conflictExport.js";

const router = express.Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.get("/", async (req, res, next) => {
  try {
    const requestedLimit = Number.parseInt(String(_req.query.limit ?? ""), 10);
    const take = Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(requestedLimit, 100))
      : undefined;
    const conflicts = await prisma.conflict.findMany({
      where: { politician: { isDemo: false }, agendaItem: { isDemo: false } },
      include: conflictInclude,
      orderBy: [
        { detectedAt: "desc" },
        { id: "asc" },
      ],
      ...(take ? { take } : {}),
    });

// Global city choices must not be derived from just one results page.
router.get('/filters', async (_req, res, next) => {
  try {
    const cities = await prisma.$queryRaw(Prisma.sql`SELECT DISTINCT COALESCE(a.city_name, j.name, 'Unknown') AS city FROM conflicts c JOIN agenda_items a ON a.id = c.agenda_item_id JOIN politicians p ON p.id = c.politician_id LEFT JOIN jurisdictions j ON j.id = p.jurisdiction_id ORDER BY city`);
    res.json({ data: cities.map(row => row.city) });
  } catch (error) { next(error); }
});

// Backwards-compatible endpoint for clients that load filter options separately.
// Keep this before `/:id`, otherwise Express treats "filters" as a conflict ID.
router.get('/filters', async (_req, res, next) => {
  try {
    const conflicts = await prisma.conflict.findMany({
      where: { politician: { isDemo: false }, agendaItem: { isDemo: false } },
      include: conflictInclude,
      orderBy: [{ detectedAt: 'desc' }, { id: 'asc' }],
    });
    const rows = conflicts.map(dashboardRow);
    const unique = values => [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
    return res.status(200).json({ data: {
      cities: unique(rows.map(row => row.city)),
      conflictTypes: unique(rows.map(row => row.conflictType)),
      severities: unique(rows.map(row => row.severity)),
    } });
  } catch (error) { return next(error); }
});

const STREET_ABBREVIATIONS = [
  [/\b(street|str)\b/g, "st"],
  [/\bavenue\b/g, "ave"],
  [/\bboulevard\b/g, "blvd"],
  [/\broad\b/g, "rd"],
  [/\bdrive\b/g, "dr"],
  [/\blane\b/g, "ln"],
  [/\bcourt\b/g, "ct"],
  [/\bplace\b/g, "pl"],
  [/\bhighway\b/g, "hwy"],
  [/\bcircle\b/g, "cir"],
  [/\bparkway\b/g, "pkwy"],
];

function canonicalizeLocation(value) {
  let text = String(value ?? "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  for (const [pattern, replacement] of STREET_ABBREVIATIONS) {
    text = text.replace(pattern, replacement);
  }

  return text;
}

function sourceMatches(conflict, label) {
  if (!label) return false;

  if (conflict.conflictType === "REAL_ESTATE") {
    return conflict.sourceKey === `REAL_ESTATE:${canonicalizeLocation(label) || "property"}`;
  }

  const fallback = ["INCOME", "GIFT", "TRAVEL"].includes(conflict.conflictType)
    ? "source"
    : "entity";

  return conflict.sourceKey === `${conflict.conflictType}:${normalizeEntityName(label) || fallback}`;
}

function formatScheduleEntry(row, scheduleType) {
  if (!row) return null;

  return {
    id: row.id,
    scheduleType,
    entityName: row.entityName ?? row.sourceName ?? row.propertyDescription ?? null,
    dollarValue: row.fairMarketValue ?? row.amount ?? row.grossIncomeRange ?? null,
    natureOfInterest: row.natureOfInvestment ?? row.natureOfInterest ?? row.businessPosition ?? null,
  };
}

async function findScheduleEntry(conflict) {
  const delegates = {
    INVESTMENT: [prisma.scheduleAInvestment, "A"],
    REAL_ESTATE: [prisma.scheduleBRealEstate, "B"],
    BUSINESS_POSITION: [prisma.scheduleA2BusinessPosition, "A-2"],
    INCOME: [prisma.scheduleCdeIncome, "C"],
    GIFT: [prisma.scheduleCdeIncome, "D"],
    TRAVEL: [prisma.scheduleCdeIncome, "E"],
  };
  if (conflict.disclosureId && delegates[conflict.conflictType]) {
    const [delegate, type] = delegates[conflict.conflictType];
    const row = await delegate.findFirst({ where: {
      id: conflict.disclosureId,
      filingId: conflict.filingId,
      filing: { politicianId: conflict.politicianId },
    } });
    return formatScheduleEntry(row, type);
  }
  const politicianWhere = {
    OR: [
      { politicianId: conflict.politicianId },
      { filing: { politicianId: conflict.politicianId } },
    ],
  };
  const orderBy = { createdAt: "desc" };

  switch (conflict.conflictType) {
    case "INVESTMENT": {
      const rows = await prisma.scheduleAInvestment.findMany({ where: politicianWhere, orderBy });
      return formatScheduleEntry(rows.find((row) => sourceMatches(conflict, row.entityName)), "A");
    }
    case "REAL_ESTATE": {
      const rows = await prisma.scheduleBRealEstate.findMany({ where: politicianWhere, orderBy });
      return formatScheduleEntry(
        rows.find((row) => (
          sourceMatches(conflict, row.propertyDescription)
          || sourceMatches(conflict, row.city)
          || sourceMatches(conflict, row.county)
        )),
        "B",
      );
    }
    case "BUSINESS_POSITION": {
      const rows = await prisma.scheduleA2BusinessPosition.findMany({ where: politicianWhere, orderBy });
      return formatScheduleEntry(rows.find((row) => sourceMatches(conflict, row.entityName)), "A-2");
    }
    case "INCOME":
    case "GIFT":
    case "TRAVEL": {
      const scheduleType = { INCOME: "C", GIFT: "D", TRAVEL: "E" }[conflict.conflictType];
      const rows = await prisma.scheduleCdeIncome.findMany({
        where: { AND: [politicianWhere, { scheduleType }] },
        orderBy,
      });
      return formatScheduleEntry(rows.find((row) => sourceMatches(conflict, row.sourceName)), scheduleType);
    }
    default:
      return null;
  }
}

router.get("/export", async (req, res, next) => {
  let filters;

  try {
    filters = parseConflictQuery(req.query);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  try {
    const batchSize = 250;
    let cursor;

    const getBatch = () => prisma.conflict.findMany({
      where: { politician: { isDemo: false }, agendaItem: { isDemo: false } },
      include: conflictInclude,
      orderBy: { id: "asc" },
      take: batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    // Check the database before starting the file response.
    let batch = await getBatch();

    const date = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="fair-conflicts-${date}.csv"`,
    );
    res.setHeader("Cache-Control", "no-store");

    // Wait for each write so large exports don't fill the output buffer.
    const write = (text) => new Promise((resolve, reject) => {
      res.write(text, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });

    await write(csvLine(csvHeaders));

    while (batch.length > 0) {
      for (const conflict of batch) {
        if (res.destroyed) return;

        const row = dashboardRow(conflict);
        if (matchesFilters(row, filters)) {
          await write(conflictCsvLine(conflict, row));
        }
      }

      if (batch.length < batchSize || res.destroyed) break;

      cursor = batch[batch.length - 1].id;
      batch = await getBatch();
    }

    res.end();
  } catch (error) {
    if (res.headersSent) {
      res.destroy(error);
    } else {
      next(error);
    }
  }
});

router.get("/:id", async (req, res, next) => {
  if (!UUID.test(req.params.id)) {
    return res.status(400).json({ error: "Invalid conflict ID" });
  }

  try {
    const conflict = await prisma.conflict.findUnique({
      where: { id: req.params.id, politician: { isDemo: false }, agendaItem: { isDemo: false } },
      include: {
        politician: true,
        agendaItem: { include: { meeting: { include: { jurisdiction: true } } } },
      },
    });

    if (!conflict) {
      return res.status(404).json({ error: "Conflict not found" });
    }

    const scheduleEntry = await findScheduleEntry(conflict);
    const agendaItem = conflict.agendaItem;

    return res.status(200).json({
      data: {
        id: conflict.id,
        politician: {
          id: conflict.politicianId,
          name: conflict.politician.fullName,
          district: conflict.politician.district,
        },
        conflictType: conflict.conflictType,
        severity: conflict.severity,
        ruleReference: conflict.ruleReference,
        entityName: conflict.entityName,
        eligibilityStatus: conflict.eligibilityStatus ?? "unknown",
        filingId: conflict.filingId ?? null,
        disclosureId: conflict.disclosureId ?? null,
        filingYear: conflict.filingYear ?? null,
        supportingSource: conflict.supportingSource ?? null,
        scheduleEntry,
        agendaItem: {
          id: conflict.agendaItemId,
          title: agendaItem.title,
          text: agendaItem.itemText ?? agendaItem.description ?? agendaItem.title,
          meetingDate: agendaItem.meetingDate ?? agendaItem.meeting?.meetingDate ?? null,
          city: agendaItem.cityName ?? agendaItem.meeting?.jurisdiction?.name ?? null,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
