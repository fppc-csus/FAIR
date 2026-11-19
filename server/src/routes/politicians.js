import express from 'express';
import { prisma } from '../lib/prisma.js';

const router = express.Router();

const ACTIVE_CONFLICT = { OR: [{ eligibilityStatus: null }, { eligibilityStatus: 'active' }] };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCHEDULE_ORDER = { createdAt: 'asc' };

// Directory of officials with the counts an investigator triages by.
router.get('/', async (req, res, next) => {
  try {
    const requestedLimit = Number.parseInt(String(req.query.limit ?? ''), 10);
    const take = Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(requestedLimit, 500))
      : undefined;
    const politicians = await prisma.politician.findMany({
      where: { isDemo: false },
      select: {
        id: true,
        slug: true,
        fullName: true,
        officeTitle: true,
        district: true,
        needsReview: true,
        jurisdiction: { select: { name: true } },
        filings: { select: { filingYear: true }, orderBy: { filingYear: 'desc' } },
        _count: {
          select: {
            conflicts: { where: ACTIVE_CONFLICT },
            scheduleAInvestments: true,
            scheduleA2Positions: true,
            scheduleBRealEstate: true,
            scheduleCdeIncome: true,
          },
        },
      },
      orderBy: { fullName: 'asc' },
      ...(take ? { take } : {}),
    });

    const data = politicians.map((politician) => ({
      id: politician.id,
      slug: politician.slug,
      fullName: politician.fullName,
      officeTitle: politician.officeTitle ?? null,
      district: politician.district,
      jurisdiction: politician.jurisdiction?.name ?? null,
      identityVerified: politician.needsReview === undefined ? null : !politician.needsReview,
      filingYears: [...new Set((politician.filings ?? []).map((filing) => filing.filingYear))],
      disclosureCount: ['scheduleAInvestments', 'scheduleA2Positions', 'scheduleBRealEstate', 'scheduleCdeIncome']
        .reduce((sum, key) => sum + (politician._count[key] ?? 0), 0),
      conflictCount: politician._count.conflicts,
    }));

    return res.status(200).json({ data });
  } catch (error) {
    return next(error);
  }
});

const dossierSelect = {
  id: true,
  slug: true,
  fullName: true,
  officeTitle: true,
  party: true,
  district: true,
  photoUrl: true,
  externalId: true,
  needsReview: true,
  createdAt: true,
  updatedAt: true,
  jurisdiction: { select: { id: true, name: true, type: true } },
  filings: {
    orderBy: { filingYear: 'desc' },
    select: {
      id: true,
      filingYear: true,
      filedAt: true,
      filerName: true,
      originalFilename: true,
      archivedPath: true,
      importMetadata: true,
      createdAt: true,
      scheduleAInvestments: { orderBy: SCHEDULE_ORDER, select: { id: true, entityName: true, fairMarketValue: true, natureOfInvestment: true, details: true } },
      scheduleA2Positions: { orderBy: SCHEDULE_ORDER, select: { id: true, entityName: true, businessPosition: true, fairMarketValue: true, natureOfInvestment: true, grossIncomeRange: true, details: true } },
      scheduleBRealEstate: { orderBy: SCHEDULE_ORDER, select: { id: true, propertyDescription: true, city: true, county: true, fairMarketValue: true, natureOfInterest: true, details: true } },
      scheduleCdeIncome: { orderBy: SCHEDULE_ORDER, select: { id: true, scheduleType: true, sourceName: true, amount: true, details: true } },
    },
  },
  conflicts: {
    where: ACTIVE_CONFLICT,
    orderBy: { detectedAt: 'desc' },
    select: {
      id: true,
      conflictType: true,
      severity: true,
      entityName: true,
      ruleReference: true,
      detectedAt: true,
      reviewStatus: true,
      reviewNote: true,
      reviewedAt: true,
      filingYear: true,
      meetingDate: true,
      disclosureId: true,
      agendaItemId: true,
      agendaItem: {
        select: { id: true, title: true, meetingDate: true, cityName: true, bodyName: true, agendaNumber: true, sourceUrl: true },
      },
    },
  },
  votes: {
    orderBy: { voteDate: 'desc' },
    select: { id: true, vote: true, voteDate: true, agendaItem: { select: { id: true, title: true, meetingDate: true } } },
  },
};

/**
 * Everything FAIR holds about one official: identity and jurisdiction, every
 * Form 700 filing with all schedule rows (including each row's full original
 * columns), candidate conflicts with review status, recorded votes, and the
 * identity-review audit trail.
 */
export function toDossier(politician, reviewEvents = []) {
  const filings = (politician.filings ?? []).map(({ scheduleAInvestments = [], scheduleA2Positions = [], scheduleBRealEstate = [], scheduleCdeIncome = [], ...filing }) => ({
    ...filing,
    investments: scheduleAInvestments,
    businessPositions: scheduleA2Positions,
    realProperty: scheduleBRealEstate,
    income: scheduleCdeIncome.filter((row) => row.scheduleType === 'C'),
    gifts: scheduleCdeIncome.filter((row) => row.scheduleType === 'D'),
    travel: scheduleCdeIncome.filter((row) => row.scheduleType === 'E'),
  }));
  const conflicts = politician.conflicts ?? [];
  const count = (key) => filings.reduce((sum, filing) => sum + filing[key].length, 0);
  const { needsReview, filings: _filings, ...profile } = politician;
  return {
    ...profile,
    name: politician.fullName,
    city: politician.jurisdiction?.name ?? null,
    identityVerified: !needsReview,
    filings,
    conflicts,
    votes: politician.votes ?? [],
    reviewEvents,
    summary: {
      filingYears: filings.map((filing) => filing.filingYear),
      disclosures: {
        investments: count('investments'),
        businessPositions: count('businessPositions'),
        realProperty: count('realProperty'),
        income: count('income'),
        gifts: count('gifts'),
        travel: count('travel'),
      },
      conflicts: {
        total: conflicts.length,
        pending: conflicts.filter((conflict) => conflict.reviewStatus === 'pending').length,
        high: conflicts.filter((conflict) => conflict.severity === 'HIGH').length,
      },
    },
  };
}

async function sendDossier(where, res, next) {
  try {
    const politician = await prisma.politician.findUnique({ where: { ...where, isDemo: false }, select: dossierSelect });
    if (!politician) return res.status(404).json({ error: 'Politician not found' });
    const reviewEvents = prisma.politicianReviewEvent?.findMany
      ? await prisma.politicianReviewEvent.findMany({
        where: { politicianId: politician.id },
        orderBy: { createdAt: 'desc' },
        select: { id: true, action: true, adminUserId: true, details: true, createdAt: true },
      })
      : [];
    return res.status(200).json({ data: toDossier(politician, reviewEvents) });
  } catch (error) {
    return next(error);
  }
}

// Explicit UUID lookup (kept for existing links).
router.get('/id/:id', (req, res, next) => (UUID.test(req.params.id)
  ? sendDossier({ id: req.params.id }, res, next)
  : res.status(404).json({ error: 'Politician not found' })));

// Slug or UUID lookup; both return the same dossier shape.
router.get('/:slugOrId', (req, res, next) => sendDossier(
  UUID.test(req.params.slugOrId) ? { id: req.params.slugOrId } : { slug: req.params.slugOrId },
  res,
  next,
));

export default router;
