import express from 'express';
import puppeteer from 'puppeteer';
import { prisma } from '../../lib/prisma.js';
import { renderConflictReportHtml } from '../../utils/conflictReportTemplate.js';

const router = express.Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONFLICT_INCLUDE = {
  politician: { select: { fullName: true, jurisdiction: { select: { name: true } } } },
  agendaItem: { select: { title: true, description: true, itemText: true, cityName: true, meetingDate: true } },
};

function readDate(value, field) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid ${field}; use YYYY-MM-DD`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`Invalid ${field}; use YYYY-MM-DD`);
  }
  return value;
}

function parseFilters(body = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Report filters must be an object');
  }

  const scope = body.scope ?? 'all';
  if (!['all', 'politician', 'city', 'dateRange'].includes(scope)) {
    throw new Error('Invalid report scope');
  }

  if (scope === 'politician') {
    if (typeof body.politicianId !== 'string' || !UUID.test(body.politicianId)) {
      throw new Error('A valid politician is required');
    }
    return { scope, politicianId: body.politicianId };
  }

  if (scope === 'city') {
    const city = typeof body.city === 'string' ? body.city.trim() : '';
    if (!city || city.length > 160) throw new Error('A valid city is required');
    return { scope, city };
  }

  if (scope === 'dateRange') {
    const fromDate = readDate(body.startDate ?? body.fromDate, 'start date');
    const toDate = readDate(body.endDate ?? body.toDate, 'end date');
    if (!fromDate && !toDate) throw new Error('At least one date is required');
    if (fromDate && toDate && fromDate > toDate) {
      throw new Error('Start date must not be after end date');
    }
    return { scope, fromDate, toDate };
  }

  return { scope };
}

function conflictWhere(filters) {
  if (filters.scope === 'politician') return { politicianId: filters.politicianId };
  if (filters.scope === 'city') {
    return {
      OR: [
        { agendaItem: { is: { cityName: filters.city } } },
        { politician: { is: { jurisdiction: { is: { name: filters.city } } } } },
      ],
    };
  }
  if (filters.scope === 'dateRange') {
    const detectedAt = {};
    if (filters.fromDate) detectedAt.gte = new Date(`${filters.fromDate}T00:00:00.000Z`);
    if (filters.toDate) {
      const dayAfterEnd = new Date(`${filters.toDate}T00:00:00.000Z`);
      dayAfterEnd.setUTCDate(dayAfterEnd.getUTCDate() + 1);
      detectedAt.lt = dayAfterEnd;
    }
    return { detectedAt };
  }
  return {};
}

function activeConflictWhere(filters) {
  return { AND: [conflictWhere(filters), { OR: [{ eligibilityStatus: null }, { eligibilityStatus: 'active' }] }] };
}

function reportConflict(conflict) {
  const agendaItem = conflict.agendaItem ?? {};
  return {
    politicianName: conflict.politician?.fullName ?? 'Unknown',
    city: agendaItem.cityName ?? conflict.politician?.jurisdiction?.name ?? 'Unknown',
    conflictType: conflict.conflictType,
    severity: conflict.severity,
    entityName: conflict.entityName,
    agendaItemSummary: agendaItem.title ?? agendaItem.description ?? agendaItem.itemText ?? 'Agenda item unavailable',
    meetingDate: agendaItem.meetingDate,
    detectedAt: conflict.detectedAt,
    reviewStatus: conflict.reviewStatus,
    eligibilityStatus: conflict.eligibilityStatus ?? 'unknown',
    ruleReference: conflict.ruleReference,
  };
}

router.post('/pdf', async (req, res, next) => {
  let filters;
  try {
    filters = parseFilters(req.body);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  try {
    let politicianName;
    if (filters.scope === 'politician') {
      const politician = await prisma.politician.findUnique({
        where: { id: filters.politicianId },
        select: { fullName: true },
      });
      if (!politician) return res.status(404).json({ error: 'Politician not found' });
      politicianName = politician.fullName;
    }

    const conflicts = await prisma.conflict.findMany({
      where: activeConflictWhere(filters),
      include: CONFLICT_INCLUDE,
      orderBy: [{ detectedAt: 'desc' }, { id: 'asc' }],
    });
    const templateFilters = { ...filters, politicianName };
    const generatedAt = new Date();
    const html = renderConflictReportHtml({
      conflicts: conflicts.map(reportConflict),
      filters: templateFilters,
      generatedAt,
    });

    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    let pdf;
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'load' });
      pdf = await page.pdf({
        format: 'Letter',
        landscape: true,
        printBackground: true,
        preferCSSPageSize: true,
      });
    } finally {
      await browser.close();
    }

    const date = generatedAt.toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="fair-conflict-report-${date}.pdf"`);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(Buffer.from(pdf));
  } catch (error) {
    return next(error);
  }
});

export default router;
