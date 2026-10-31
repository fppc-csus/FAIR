import express from "express";

import { prisma } from "../../lib/prisma.js";
import { eligibilityPolicy } from "../../config/eligibilityPolicy.js";

const router = express.Router();

const politicianSelect = {
  id: true,
  slug: true,
  fullName: true,
  officeTitle: true,
  district: true,
  needsReview: true,
  jurisdiction: { select: { id: true, name: true } },
};
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class ReconciliationConflict extends Error {
  constructor(message) {
    super(message);
    this.statusCode = 409;
  }
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function slugify(value) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "politician";
}

function publicPolitician(politician) {
  return {
    id: politician.id,
    slug: politician.slug,
    name: politician.fullName,
    officeTitle: politician.officeTitle,
    district: politician.district,
    city: politician.jurisdiction?.name ?? "",
    needsReview: politician.needsReview,
    filingCount: politician._count?.filings ?? politician.filingCount ?? 0,
  };
}

function readBody(body) {
  const name = cleanString(body?.name);
  const district = cleanString(body?.district);
  const city = cleanString(body?.city);
  const officeTitle = cleanString(body?.officeTitle) || "Unknown";

  if (!name || !district || !city) {
    return { error: "Name, district, and city are required." };
  }
  if (name.length > 160 || district.length > 120 || city.length > 160) {
    return { error: "Name, district, or city is too long." };
  }

  return { value: { name, district, city, officeTitle } };
}

async function getOrCreateCity(name) {
  const existing = await prisma.jurisdiction.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
    select: { id: true },
  });
  if (existing) return existing.id;

  const city = await prisma.jurisdiction.create({
    data: { name, type: "city" },
    select: { id: true },
  });
  return city.id;
}

async function uniqueSlug(name, excludeId) {
  const base = slugify(name);
  let slug = base;
  let suffix = 2;

  while (true) {
    const existing = await prisma.politician.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!existing || existing.id === excludeId) return slug;
    slug = `${base}-${suffix}`;
    suffix += 1;
  }
}

router.get("/", async (_req, res, next) => {
  try {
    const politicians = await prisma.politician.findMany({
      orderBy: { fullName: "asc" },
      select: { ...politicianSelect, _count: { select: { filings: true } } },
    });
    return res.json({ data: politicians.map(publicPolitician) });
  } catch (error) {
    return next(error);
  }
});

// Read-only review queue derived from current records; no destructive backfill.
router.get("/eligibility-review", async (_req, res, next) => {
  try {
    const [politicians, agendaItems] = await Promise.all([
      prisma.politician.findMany({
        where: { filings: { some: {} }, OR: [{ jurisdictionId: null }, { needsReview: true }] },
        select: { id: true, fullName: true, needsReview: true },
      }),
      prisma.agendaItem.findMany({
        where: { meetingId: null, OR: [{ meetingDate: null }, { cityName: null }] },
        select: { id: true, cityId: true, cityName: true, meetingDate: true },
      }),
    ]);
    return res.json({
      data: {
        policyPending: eligibilityPolicy().period === "PENDING",
        politicians: politicians.map((row) => ({ ...row, reason: row.needsReview ? "POLITICIAN_IDENTITY_REVIEW" : "UNRESOLVED_POLITICIAN_JURISDICTION" })),
        agendaItems: agendaItems.map((row) => ({ ...row, reason: row.meetingDate ? "UNRESOLVED_JURISDICTION" : "MISSING_MEETING_DATE" })),
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const parsed = readBody(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    const cityId = await getOrCreateCity(parsed.value.city);
    const slug = await uniqueSlug(parsed.value.name);
    const politician = await prisma.politician.create({
      data: {
        fullName: parsed.value.name,
        slug,
        officeTitle: parsed.value.officeTitle,
        district: parsed.value.district,
        jurisdictionId: cityId,
      },
      select: politicianSelect,
    });
    return res.status(201).json({ data: publicPolitician({ ...politician, filingCount: 0 }) });
  } catch (error) {
    if (error?.code === "P2002") {
      return res.status(409).json({ error: "A politician with this profile slug already exists." });
    }
    return next(error);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    if (!uuidPattern.test(req.params.id)) {
      return res.status(400).json({ error: "Politician id must be a UUID." });
    }
    const parsed = readBody(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    const current = await prisma.politician.findUnique({
      where: { id: req.params.id },
      select: { id: true, _count: { select: { filings: true } } },
    });
    if (!current) return res.status(404).json({ error: "Politician not found." });

    const cityId = await getOrCreateCity(parsed.value.city);
    const slug = await uniqueSlug(parsed.value.name, current.id);
    const politician = await prisma.politician.update({
      where: { id: current.id },
      data: {
        fullName: parsed.value.name,
        slug,
        officeTitle: parsed.value.officeTitle,
        district: parsed.value.district,
        jurisdictionId: cityId,
      },
      select: politicianSelect,
    });
    return res.json({ data: publicPolitician({ ...politician, _count: current._count }) });
  } catch (error) {
    if (error?.code === "P2002") {
      return res.status(409).json({ error: "A politician with this profile slug already exists." });
    }
    return next(error);
  }
});

router.post("/:id/approve", async (req, res, next) => {
  try {
    if (!uuidPattern.test(req.params.id)) {
      return res.status(400).json({ error: "Politician id must be a UUID." });
    }
    const politician = await prisma.politician.findUnique({
      where: { id: req.params.id },
      select: { id: true, needsReview: true },
    });
    if (!politician) return res.status(404).json({ error: "Politician not found." });
    if (!politician.needsReview) {
      return res.json({ data: { id: politician.id, needsReview: false }, alreadyApproved: true });
    }

    await prisma.$transaction(async (tx) => {
      await tx.politician.update({
        where: { id: politician.id },
        data: { needsReview: false },
      });
      await tx.politicianReviewEvent.create({
        data: {
          politicianId: politician.id,
          action: "approved",
          adminUserId: req.user?.id ?? req.user?.email ?? "unknown",
        },
      });
    });
    return res.json({ data: { id: politician.id, needsReview: false }, alreadyApproved: false });
  } catch (error) {
    return next(error);
  }
});

async function reconcilePoliticians(tx, sourceId, targetId, adminUserId) {
  const [source, target] = await Promise.all([
    tx.politician.findUnique({ where: { id: sourceId }, select: { id: true, fullName: true } }),
    tx.politician.findUnique({ where: { id: targetId }, select: { id: true, fullName: true } }),
  ]);

  if (!source) {
    const prior = await tx.politicianReviewEvent.findUnique({ where: { sourcePoliticianId: sourceId } });
    if (prior?.politicianId === targetId) return { alreadyMerged: true, sourceName: null, targetName: target?.fullName ?? null };
    throw new ReconciliationConflict("The duplicate profile no longer exists or was reconciled into a different profile.");
  }
  if (!target) throw Object.assign(new Error("Target politician not found."), { statusCode: 404 });

  const [sourceFilings, targetFilings, sourceVotes, sourceConflicts] = await Promise.all([
    tx.form700Filing.findMany({ where: { politicianId: sourceId }, select: { id: true, filingYear: true } }),
    tx.form700Filing.findMany({ where: { politicianId: targetId }, select: { filingYear: true } }),
    tx.voteRecord.findMany({ where: { politicianId: sourceId }, select: { id: true, agendaItemId: true, vote: true } }),
    tx.conflict.findMany({
      where: { politicianId: sourceId },
      select: { id: true, agendaItemId: true, conflictType: true, sourceKey: true },
    }),
  ]);

  const targetYears = new Set(targetFilings.map((filing) => filing.filingYear));
  const duplicateYears = sourceFilings.filter((filing) => targetYears.has(filing.filingYear)).map((filing) => filing.filingYear);
  if (duplicateYears.length) {
    throw new ReconciliationConflict(`Both profiles have Form 700 filings for ${[...new Set(duplicateYears)].join(", ")}. Resolve those filings before merging.`);
  }

  for (const vote of sourceVotes) {
    const existing = await tx.voteRecord.findUnique({
      where: { agendaItemId_politicianId: { agendaItemId: vote.agendaItemId, politicianId: targetId } },
      select: { id: true, vote: true },
    });
    if (existing && existing.vote !== vote.vote) {
      throw new ReconciliationConflict("The profiles contain different votes for the same agenda item. Resolve the vote records before merging.");
    }
    if (existing) await tx.voteRecord.delete({ where: { id: vote.id } });
    else await tx.voteRecord.update({ where: { id: vote.id }, data: { politicianId: targetId } });
  }

  for (const conflict of sourceConflicts) {
    const existing = await tx.conflict.findUnique({
      where: {
        politicianId_agendaItemId_conflictType_sourceKey: {
          politicianId: targetId,
          agendaItemId: conflict.agendaItemId,
          conflictType: conflict.conflictType,
          sourceKey: conflict.sourceKey,
        },
      },
      select: { id: true },
    });
    if (existing) {
      await tx.conflictReview.updateMany({ where: { conflictId: conflict.id }, data: { conflictId: existing.id } });
      await tx.conflict.delete({ where: { id: conflict.id } });
    } else {
      await tx.conflict.update({ where: { id: conflict.id }, data: { politicianId: targetId } });
    }
  }

  await Promise.all([
    tx.form700Filing.updateMany({ where: { politicianId: sourceId }, data: { politicianId: targetId } }),
    tx.conflictFlag.updateMany({ where: { politicianId: sourceId }, data: { politicianId: targetId } }),
    tx.scheduleAInvestment.updateMany({ where: { politicianId: sourceId }, data: { politicianId: targetId } }),
    tx.scheduleBRealEstate.updateMany({ where: { politicianId: sourceId }, data: { politicianId: targetId } }),
    tx.scheduleCdeIncome.updateMany({ where: { politicianId: sourceId }, data: { politicianId: targetId } }),
    tx.scheduleA2BusinessPosition.updateMany({ where: { politicianId: sourceId }, data: { politicianId: targetId } }),
  ]);
  await tx.politicianReviewEvent.create({
    data: {
      politicianId: targetId,
      sourcePoliticianId: sourceId,
      action: "merged",
      adminUserId,
      details: { sourceName: source.fullName, targetName: target.fullName },
    },
  });
  await tx.politician.delete({ where: { id: sourceId } });
  return { alreadyMerged: false, sourceName: source.fullName, targetName: target.fullName };
}

router.post("/:id/reconcile", async (req, res, next) => {
  try {
    const sourceId = req.params.id;
    const targetId = cleanString(req.body?.targetPoliticianId);
    if (!uuidPattern.test(sourceId) || !uuidPattern.test(targetId)) {
      return res.status(400).json({ error: "Source and target politician ids must be UUIDs." });
    }
    if (sourceId === targetId) return res.status(400).json({ error: "Choose a different target politician." });

    const result = await prisma.$transaction(
      (tx) => reconcilePoliticians(tx, sourceId, targetId, req.user?.id ?? req.user?.email ?? "unknown"),
      { isolationLevel: "Serializable" },
    );
    return res.json({
      data: { sourcePoliticianId: sourceId, targetPoliticianId: targetId },
      alreadyMerged: result.alreadyMerged,
      message: result.alreadyMerged
        ? "This duplicate was already reconciled into the selected profile."
        : `${result.sourceName} was reconciled into ${result.targetName}.`,
    });
  } catch (error) {
    if (error?.statusCode === 409 || error?.statusCode === 404) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    if (error?.code === "P2034" || error?.code === "P2002") {
      return res.status(409).json({ error: "The profiles changed during reconciliation. Refresh and try again." });
    }
    return next(error);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    if (!uuidPattern.test(req.params.id)) {
      return res.status(400).json({ error: "Politician id must be a UUID." });
    }
    const politician = await prisma.politician.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        _count: { select: { filings: true, votes: true, conflicts: true, conflictFlags: true } },
      },
    });
    if (!politician) return res.status(404).json({ error: "Politician not found." });
    if (politician._count.filings > 0) {
      return res.status(409).json({
        error: `This politician cannot be deleted because ${politician._count.filings} Form 700 filing(s) are linked to the profile.`,
        filing_count: politician._count.filings,
      });
    }
    const otherLinkedRecords = politician._count.votes + politician._count.conflicts + politician._count.conflictFlags;
    if (otherLinkedRecords > 0) {
      return res.status(409).json({
        error: "This politician has linked votes or conflict records. Reconcile the profile instead of deleting it.",
        linked_record_count: otherLinkedRecords,
      });
    }

    await prisma.politician.delete({ where: { id: politician.id } });
    return res.status(204).end();
  } catch (error) {
    return next(error);
  }
});

export default router;