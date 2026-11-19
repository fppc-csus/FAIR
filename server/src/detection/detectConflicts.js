import { detectBusinessPositions } from "./detectBusinessPositions.js";
import { detectIncomeGiftsTravel } from "./detectIncomeGiftsTravel.js";
import { detectInvestments } from "./investments.js";
import { detectRealEstate } from "./detectRealEstate.js";
import { persistConflicts } from "./persistConflicts.js";
import { eligibilityPolicy } from "../config/eligibilityPolicy.js";
import { disclosureEligibility, resolveAgendaScope } from "./eligibility.js";
import { relatedNamesFromDetails } from "../parsers/parserUtils.js";
import { parseAmount } from "../config/conflictRules.js";
import { normalizeEntityName } from "../utils/entityNorm.js";

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

function filerNameOf(row) {
  return row.filing?.filerName ?? row.filing?.politician?.fullName ?? null;
}

/**
 * A filer's own name (e.g. "James Gore" listed as a source on Gore's spouse
 * income line) appears in nearly every item the official votes on; it is not
 * an outside source of income.
 */
export function isFilerOwnName(name, filerName) {
  const words = (value) => normalizeEntityName(value).split(" ").filter((word) => word.length > 1);
  const source = words(name);
  const filer = words(filerName);
  if (!source.length || filer.length < 2) return false;
  const first = filer[0];
  const last = filer.at(-1);
  return source.length <= 3 && source.includes(first) && source.includes(last);
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

/** Attach the per-filing total of gifts (D) from the same source to each gift row. */
function withGiftTotals(rows) {
  const totals = new Map();
  const key = (row) => `${row.filingId}|${normalizeEntityName(row.source_name)}`;
  for (const row of rows) {
    if (String(row.schedule_type).toUpperCase() !== "D") continue;
    const amount = parseAmount(row.amount);
    if (amount != null) totals.set(key(row), (totals.get(key(row)) ?? 0) + amount);
  }
  return rows.map((row) => (String(row.schedule_type).toUpperCase() === "D" && totals.has(key(row))
    ? { ...row, aggregate_amount: totals.get(key(row)) }
    : row));
}

const PARENT_LABEL = (row) => row.entity_name ?? row.source_name ?? row.property_description ?? "disclosure";

/**
 * Parties named inside a disclosure (A-2 income sources and holdings, Schedule
 * B tenants, Schedule C commission sources) are matched like first-class
 * sources of income / investments. The entity label records the parent
 * disclosure so investigators can trace where the name came from.
 */
async function detectRelatedParties(row, item, matchDeps) {
  const flags = [];
  for (const related of relatedNamesFromDetails(row.details)) {
    if (isFilerOwnName(related.name, filerNameOf(row))) continue;
    const found = related.kind === "INVESTMENT"
      ? await detectInvestments([{ politician_id: row.politician_id, entity_name: related.name, fair_market_value: null }], item, matchDeps)
      : await detectIncomeGiftsTravel([{ politician_id: row.politician_id, source_name: related.name, schedule_type: "C", amount: null }], item, matchDeps);
    for (const flag of found) {
      flags.push({ ...flag, source_key: `related:${flag.source_key}`,
        entity_name: `${related.name} (${related.label.toLowerCase()} on disclosure for ${PARENT_LABEL(row)})` });
    }
  }
  return flags;
}

function evidence(row) {
  return {
    details: row.details ?? null,
    disclosureId: row.id,
    filingId: row.filingId ?? row.filing?.id,
    filingYear: row.filing?.filingYear ?? row.filingYear,
    politicianJurisdictionId: row.filing?.politician?.jurisdictionId ?? row.politicianJurisdictionId,
    supportingSource: row.filing?.archivedPath ?? row.filing?.storagePath ?? row.filing?.originalFilename ?? null,
    filing: row.filing,
    schedulePoliticianId: row.politicianId ?? row.politician_id,
  };
}

async function loadRows(delegate, jurisdictionIds, isDemo) {
  if (!delegate?.findMany) return [];
  return delegate.findMany({
    where: { filing: { politician: { isDemo, OR: [
      { jurisdictionId: { in: jurisdictionIds } }, { jurisdictionId: null },
    ] } } },
    include: { filing: { include: { politician: { select: { jurisdictionId: true, needsReview: true, fullName: true } } } } },
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
  // The jurisdiction table is small; load it whole so name variants such as
  // "Sonoma County" / "County of Sonoma" resolve through jurisdictionKey().
  const jurisdictions = names.length
    ? await client.jurisdiction.findMany({ select: { id: true, name: true } })
    : [];
  const dataSources = uuidNames.length && client.dataSource?.findMany
    ? await client.dataSource.findMany({
      where: { id: { in: uuidNames }, jurisdictionId: { not: null } },
      select: { id: true, jurisdictionId: true },
    })
    : [];
  const scopes = new Map(items.map((item) => [item.id, resolveAgendaScope(item, jurisdictions, dataSources)]));
  const jurisdictionIds = [...new Set([...scopes.values()].map((scope) => scope.jurisdictionId).filter(Boolean))];
  const policy = deps.eligibilityPolicy ?? eligibilityPolicy();
  if (policy.period !== "PENDING" && (policy.period !== "YEAR_OFFSETS"
    || !Array.isArray(policy.offsets) || !policy.offsets.every((offset) => Number.isInteger(offset) && offset >= 0))) {
    throw new Error("Unknown filing-period policy");
  }

  const groups = new Map();
  for (const isDemo of new Set(items.map((item) => Boolean(item.isDemo)))) {
    groups.set(isDemo, await Promise.all([
      loadRows(client.scheduleAInvestment, jurisdictionIds, isDemo),
      loadRows(client.scheduleBRealEstate, jurisdictionIds, isDemo),
      loadRows(client.scheduleCdeIncome, jurisdictionIds, isDemo),
      loadRows(client.scheduleA2BusinessPosition, jurisdictionIds, isDemo),
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
    const scope = scopes.get(item.id);
    if (!scope.jurisdictionId || !scope.meetingDate) {
      requireReview({ agendaItemId: item.id, reason: scope.reason ?? "MISSING_MEETING_DATE" });
      pendingItemIds.add(item.id);
      continue;
    }
    if (policy.period === "PENDING") {
      requireReview({ agendaItemId: item.id, reason: "POLICY_PENDING" });
      pendingItemIds.add(item.id);
    }
    const eligible = (rows) => rows.filter((row) => {
      const result = disclosureEligibility(scope, row, policy);
      if (result.status === "REVIEW_REQUIRED") {
        requireReview({ agendaItemId: item.id, filingId: row.filingId, reason: result.reason });
      }
      if (["POLICY_PENDING", "REVIEW_REQUIRED"].includes(result.status)) pendingItemIds.add(item.id);
      return result.status === "ELIGIBLE";
    });
    const eligibleB = eligible(scheduleB);
    const eligibleCde = withGiftTotals(eligible(scheduleCde))
      .filter((row) => !isFilerOwnName(row.source_name, filerNameOf(row)));
    const eligibleA2 = eligible(scheduleA2);
    for (const [rows, detector] of [
      [eligible(scheduleA), (row) => detectInvestments([row], item, matchDeps)],
      [eligibleB, (row) => detectRealEstate([row], item)],
      [eligibleCde, (row) => detectIncomeGiftsTravel([row], item, matchDeps)],
      [eligibleA2, (row) => detectBusinessPositions([row], item, matchDeps)],
      [[...eligibleA2, ...eligibleB, ...eligibleCde], (row) => detectRelatedParties(row, item, matchDeps)],
    ]) {
      for (const row of rows) {
        for (const flag of await detector(row)) {
          candidates.push({ ...flag,
            source_key: `${flag.source_key}:disclosure:${row.disclosureId}`,
            filingId: row.filingId, disclosureId: row.disclosureId,
            filingYear: row.filingYear, jurisdictionId: scope.jurisdictionId,
            meetingDate: scope.meetingDate, supportingSource: row.supportingSource });
        }
      }
    }
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
