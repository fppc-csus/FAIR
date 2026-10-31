// Public API stub — full implementation is Sprint 6.
// Mounted at /api/agenda in server/src/app.js.
import express from 'express';
import { prisma } from "../lib/prisma.js";

const router = express.Router();

router.get("/", async (_req, res, next) => {
  try {
    const requestedLimit = Number.parseInt(String(_req.query.limit ?? ""), 10);
    const take = Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(requestedLimit, 100))
      : undefined;
    const agendaItems = await prisma.agendaItem.findMany({
      where: { isDemo: false },
      select: {
        id: true,
        title: true,
        itemNumber: true,
        meetingDate: true,
        cityName: true,
        sourceType: true,
        _count: {
          select: {
            conflicts: { where: { OR: [{ eligibilityStatus: null }, { eligibilityStatus: "active" }] } },
          },
        },
      },
      orderBy: {
        meetingDate: "desc",
      },
      ...(take ? { take } : {}),
    });

    const data = agendaItems.map((item) => ({
      id: item.id,
      title: item.title,
      itemNumber: item.itemNumber,
      meetingDate: item.meetingDate,
      cityName: item.cityName,
      sourceType: item.sourceType,
      conflictCount: item._count.conflicts,
    }));

    res.status(200).json({ data });
  } catch (error) {
    next(error);
  }
});

router.get("/:id", async (req, res) => {
  try {
    const agendaItem = await prisma.agendaItem.findUnique({
      where: {
        id: req.params.id,
        isDemo: false,
      },
      select: {
        id: true,
        title: true,
        description: true,
        itemText: true,
        itemNumber: true,
        meetingDate: true,
        cityName: true,
        sourceType: true,
        bodyName: true,
        conflicts: {
          where: { OR: [{ eligibilityStatus: null }, { eligibilityStatus: "active" }] },
          select: {
            id: true,
            conflictType: true,
            severity: true,
            entityName: true,
            ruleReference: true,
            detectedAt: true,
            politician: {
              select: {
                id: true,
                fullName: true,
                district: true,
              },
            },
          },
          orderBy: {
            detectedAt: "desc",
          },
        },
      },
    });

    if (!agendaItem) {
      return res.status(404).json({
        error: "Agenda item not found",
      });
    }

    res.status(200).json({
      data: agendaItem,
    });
  } catch (error) {
    console.error("Failed to fetch agenda item:", error);

    res.status(500).json({
      error: "Failed to fetch agenda item",
    });
  }
});

export default router;
