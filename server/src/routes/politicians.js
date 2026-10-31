import express from 'express';
import { prisma } from '../lib/prisma.js';

const router = express.Router();

// List all politicians.
router.get('/', async (_req, res, next) => {
  try {
    const requestedLimit = Number.parseInt(String(_req.query.limit ?? ''), 10);
    const take = Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(requestedLimit, 500))
      : undefined;
    const politicians = await prisma.politician.findMany({
      where: { isDemo: false },
      select: {
        id: true,
        slug: true,
        fullName: true,
        district: true,
        _count: {
          select: {
            conflicts: true,
          },
        },
      },
      orderBy: {
        fullName: 'asc',
      },
      ...(take ? { take } : {}),
    });

    const data = politicians.map((politician) => ({
      id: politician.id,
      slug: politician.slug,
      fullName: politician.fullName,
      district: politician.district,
      conflictCount: politician._count.conflicts,
    }));

    return res.status(200).json({ data });
  } catch (error) {
    return next(error);
  }
});

// Look up a politician by UUID.
// The explicit /id/ prefix prevents this route from conflicting
// with the slug-based route below.
router.get('/id/:id', async (req, res, next) => {
  try {
    const politician = await prisma.politician.findUnique({
      where: {
        id: req.params.id,
        isDemo: false,
      },
      select: {
        id: true,
        fullName: true,
        district: true,
        filings: {
          select: {
            id: true,
            filingYear: true,
            filedAt: true,
            filerName: true,
          },
          orderBy: {
            filingYear: 'desc',
          },
        },
        conflicts: {
          select: {
            id: true,
            conflictType: true,
            severity: true,
            entityName: true,
            ruleReference: true,
            detectedAt: true,
            agendaItemId: true,
            agendaItem: {
              select: {
                id: true,
                title: true,
                meetingDate: true,
              },
            },
          },
          orderBy: {
            detectedAt: 'desc',
          },
        },
      },
    });

    if (!politician) {
      return res.status(404).json({
        error: 'Politician not found',
      });
    }

    return res.status(200).json({
      data: politician,
    });
  } catch (error) {
    return next(error);
  }
});

// Preserve main's slug-based politician profile endpoint.
router.get('/:slug', async (req, res, next) => {
  try {
    const politician = await prisma.politician.findUnique({
      where: {
        slug: req.params.slug,
        isDemo: false,
      },
      select: {
        id: true,
        slug: true,
        fullName: true,
        officeTitle: true,
        district: true,
        jurisdiction: {
          select: {
            name: true,
          },
        },
        filings: {
          orderBy: {
            filingYear: 'desc',
          },
          select: {
            id: true,
            filingYear: true,
            filerName: true,
          },
        },
      },
    });

    if (!politician) {
      return res.status(404).json({
        error: 'Politician not found.',
      });
    }

    return res.json({
      data: {
        id: politician.id,
        slug: politician.slug,
        name: politician.fullName,
        officeTitle: politician.officeTitle,
        district: politician.district,
        city: politician.jurisdiction?.name ?? null,
        filings: politician.filings,
      },
    });
  } catch (error) {
    return next(error);
  }
});

export default router;

