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

async function loadRows(delegate, isDemo) {
  if (!delegate?.findMany) return [];
  return delegate.findMany({
    where: { filing: { politician: { isDemo } } },
    include: { filing: { select: { politicianId: true } } },
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
  const jurisdictionIds = [...new Set([...scopes.values()].map((scope) => scope.jurisdictionId).filter(Boolean))];
  const policy = deps.eligibilityPolicy ?? eligibilityPolicy();
  if (policy.period !== "PENDING" && (policy.period !== "YEAR_OFFSETS"
    || !Array.isArray(policy.offsets) || !policy.offsets.every((offset) => Number.isInteger(offset) && offset >= 0))) {
    throw new Error("Unknown filing-period policy");
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
  const pendingItemIds = new Set();
  for (const item of items) {
    const [investments, properties, sources, positions] = groups.get(Boolean(item.isDemo));
    const scheduleA = (investments || []).map(asScheduleA);
    const scheduleB = (properties || []).map(asScheduleB);
    const scheduleCde = (sources || []).map(asScheduleCde);
    const scheduleA2 = (positions || []).map(asScheduleA2);
    candidates.push(
      ...(await detectInvestments(scheduleA, item, matchDeps)),
    );

    candidates.push(...(await detectRealEstate(scheduleB, item)));
    
    candidates.push(
      ...(await detectIncomeGiftsTravel(scheduleCde, item, matchDeps)),
    );
    
    candidates.push(
      ...(await detectBusinessPositions(scheduleA2, item, matchDeps)),
    );
  }

  // A review-required disclosure must not invalidate earlier matches, but it
  // must not prevent independently eligible disclosures from being recorded.
  const persisted = await persistConflicts(candidates, {
    prisma: client,
    agendaItemIds: items.map((item) => item.id),
    preserveAgendaItemIds: [...pendingItemIds],
    lockedAgendaItems: true,
  });
  return { ...persisted, totalCandidates: candidates.length, reviewRequired };
}
