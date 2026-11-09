import { detectBusinessPositions } from "./detectBusinessPositions.js";
import { detectIncomeGiftsTravel } from "./detectIncomeGiftsTravel.js";
import { detectInvestments } from "./investments.js";
import { detectRealEstate } from "./detectRealEstate.js";
import { persistConflicts } from "./persistConflicts.js";
import { eligibilityPolicy } from "../config/eligibilityPolicy.js";
import { disclosureEligibility, resolveAgendaScope } from "./eligibility.js";

async function getPrisma(override) {
  if (override) return override;
  const { prisma } = await import("../lib/prisma.js");
  return prisma;
}

function politicianIdFrom(row) {
  return row?.filing?.politicianId ?? row?.politicianId ?? row?.politician_id ?? null;
}

function asScheduleA(row) {
  return {
    ...evidence(row),
    politician_id: politicianIdFrom(row),
    entity_name: row.entityName ?? row.entity_name ?? null,
    fair_market_value:
      row.fairMarketValue ?? row.fair_market_value ?? null,
    nature_of_investment:
      row.natureOfInvestment ?? row.nature_of_investment ?? null,
  };
}

function asScheduleB(row) {
  return {
    ...evidence(row),
    politician_id: politicianIdFrom(row),
    property_description: row.propertyDescription ?? row.property_description ?? null,
    city: row.city ?? null,
    county: row.county ?? null,
    fair_market_value: row.fairMarketValue ?? row.fair_market_value ?? null,
  };
}

function asScheduleCde(row) {
  return {
    ...evidence(row),
    politician_id: politicianIdFrom(row),
    source_name: row.sourceName ?? row.source_name ?? null,
    amount: row.amount ?? null,
    schedule_type: row.scheduleType ?? row.schedule_type ?? null,
  };
}

function asScheduleA2(row) {
  return {
    ...evidence(row),
    politician_id: politicianIdFrom(row),
    entity_name: row.entityName ?? row.entity_name ?? null,
    business_position: row.businessPosition ?? row.business_position ?? null,
  };
}

function evidence(row) {
  return {
    disclosureId: row.id,
    filingId: row.filingId ?? row.filing?.id,
    filingYear: row.filing?.filingYear ?? row.filingYear,
    politicianJurisdictionId: row.filing?.politician?.jurisdictionId ?? row.politicianJurisdictionId,
    supportingSource: row.filing?.archivedPath ?? row.filing?.storagePath ?? row.filing?.originalFilename ?? null,
    filing: row.filing,
    schedulePoliticianId: row.politicianId ?? row.politician_id,
  };
}

async function loadRows(delegate, isDemo) {
  if (!delegate?.findMany) return [];
  return delegate.findMany({
    where: { filing: { politician: { isDemo } } },
    include: { filing: { include: { politician: { select: { jurisdictionId: true, jurisdictionVerifiedId: true, jurisdictionVerifiedAt: true, jurisdictionVerifiedBy: true, needsReview: true } } } } },
  });
}

export async function detectConflictsForAgendaItems(ids, deps = {}) {
  if (!Array.isArray(ids) || ids.length === 0) {
    return { inserted: 0, skipped: 0, totalCandidates: 0 };
  }

  const client = await getPrisma(deps.prisma);
  if (!client.$transaction) throw new Error("Scoped conflict detection requires a transaction");
  return client.$transaction(async (tx) => {
    // Lock before discovering agenda/disclosure metadata; locking only at the
    // persistence stage allows a waiting run to reconcile stale candidates.
    if (!tx.$queryRaw && !deps.prisma) throw new Error("Scoped detection requires agenda row locks");
    if (tx.$queryRaw) {
      for (const id of [...new Set(ids)].sort()) {
        await tx.$queryRaw`SELECT id FROM agenda_items WHERE id = ${id}::uuid FOR UPDATE`;
      }
    }
    return detectLockedAgendaItems(tx, ids, deps);
  }, { timeout: 120000 });
}

async function detectLockedAgendaItems(client, ids, deps) {
  const items = await client.agendaItem.findMany({
    where: { id: { in: [...new Set(ids)] } },
    include: { meeting: { select: { jurisdictionId: true, meetingDate: true } } },
  });
  const names = [...new Set(items.flatMap((item) => [item.cityName, item.cityId].filter(Boolean)))];
  const uuidNames = names.filter((name) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(name));
  const jurisdictions = names.length ? await client.jurisdiction.findMany({
    where: { OR: [{ id: { in: uuidNames } },
      ...names.map((name) => ({ name: { equals: name, mode: "insensitive" } }))] },
    select: { id: true, name: true },
  }) : [];
  const scopes = new Map(items.map((item) => [item.id, resolveAgendaScope(item, jurisdictions)]));
  const policy = deps.eligibilityPolicy ?? eligibilityPolicy();
  if (policy.period !== "ALL_VERIFIED" || policy.jurisdiction !== "ALL_VERIFIED") {
    throw new Error("Unknown eligibility policy");
  }

  const groups = new Map();
  for (const isDemo of new Set(items.map((item) => Boolean(item.isDemo)))) {
    groups.set(isDemo, await Promise.all([
      loadRows(client.scheduleAInvestment, isDemo),
      loadRows(client.scheduleBRealEstate, isDemo),
      loadRows(client.scheduleCdeIncome, isDemo),
      loadRows(client.scheduleA2BusinessPosition, isDemo),
    ]));
  }


  const matchDeps = deps.matchNamedEntity
    ? { matchNamedEntity: deps.matchNamedEntity }
    : {};

  const candidates = [];
  const reviewRequired = [];
  const reviewKeys = new Set();
  const requireReview = (entry) => {
    const key = `${entry.agendaItemId}|${entry.filingId ?? ""}|${entry.reason}`;
    if (!reviewKeys.has(key)) {
      reviewKeys.add(key);
      reviewRequired.push(entry);
    }
  };
  for (const item of items) {
    const [investments, properties, sources, positions] = groups.get(Boolean(item.isDemo));
    const scheduleA = (investments || []).map(asScheduleA);
    const scheduleB = (properties || []).map(asScheduleB);
    const scheduleCde = (sources || []).map(asScheduleCde);
    const scheduleA2 = (positions || []).map(asScheduleA2);
    const scope = scopes.get(item.id);
    if (!scope.meetingDate || scope.reason === "AMBIGUOUS_MEETING_DATE") {
      requireReview({ agendaItemId: item.id, reason: scope.reason === "AMBIGUOUS_MEETING_DATE" ? scope.reason : "MISSING_MEETING_DATE" });
      continue;
    }
    if (!item.meetingDateVerifiedAt || !item.meetingDateVerifiedBy || !item.meetingDateVerifiedValue
      || new Date(item.meetingDateVerifiedValue).getTime() !== scope.meetingDate.getTime()) {
      requireReview({ agendaItemId: item.id, reason: "UNVERIFIED_MEETING_DATE" });
      continue;
    }
    scope.meetingDateVerifiedAt = item.meetingDateVerifiedAt;
    scope.meetingDateVerifiedBy = item.meetingDateVerifiedBy;
    scope.meetingDateVerifiedValue = item.meetingDateVerifiedValue;
    const eligible = (rows) => rows.filter((row) => {
      const result = disclosureEligibility(scope, row, policy);
      if (result.status === "REVIEW_REQUIRED") {
        requireReview({ agendaItemId: item.id, filingId: row.filingId, reason: result.reason });
      }
      return result.status === "ELIGIBLE";
    });
    for (const [rows, detector] of [
      [eligible(scheduleA), (row) => detectInvestments([row], item, matchDeps)],
      [eligible(scheduleB), (row) => detectRealEstate([row], item)],
      [eligible(scheduleCde), (row) => detectIncomeGiftsTravel([row], item, matchDeps)],
      [eligible(scheduleA2), (row) => detectBusinessPositions([row], item, matchDeps)],
    ]) {
      for (const row of rows) {
        for (const flag of await detector(row)) {
          candidates.push({ ...flag,
            source_key: `${flag.source_key}:disclosure:${row.disclosureId}`,
            filingId: row.filingId, disclosureId: row.disclosureId,
            filingYear: row.filingYear, jurisdictionId: scope.jurisdictionId,
            politicianJurisdictionId: row.politicianJurisdictionId,
            meetingDate: scope.meetingDate, supportingSource: row.supportingSource });
        }
      }
    }
  }

  // A candidate that no longer has verified supporting records is not current.
  const persisted = await persistConflicts(candidates, {
    prisma: client,
    agendaItemIds: items.map((item) => item.id),
    lockedAgendaItems: true,
  });
  return { ...persisted, totalCandidates: candidates.length, reviewRequired };
}
