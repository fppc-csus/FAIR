import { normalizeEntityName } from "./matchEntity.js";

async function getPrisma(override) {
  if (override) return override;
  const { prisma } = await import("../lib/prisma.js");
  return prisma;
}

export function toConflictRecord(candidate = {}) {
  const politicianId = candidate.politicianId ?? candidate.politician_id;
  const agendaItemId = candidate.agendaItemId ?? candidate.agenda_item_id;
  const conflictType = candidate.conflictType ?? candidate.conflict_type;
  const ruleReference = candidate.ruleReference ?? candidate.rule_reference;
  const entityName = candidate.entityName ?? candidate.entity_name ?? null;
  const sourceKey =
    candidate.sourceKey ??
    candidate.source_key ??
    `${conflictType || ""}:${normalizeEntityName(entityName) || ""}`;
  const detectedAt = candidate.detectedAt ?? candidate.detected_at;

  const record = {
    politicianId,
    agendaItemId,
    conflictType,
    severity: candidate.severity,
    ruleReference,
    entityName,
    sourceKey,
    detectedAt: detectedAt ? new Date(detectedAt) : new Date(),
  };
  for (const field of ["filingId", "disclosureId", "filingYear", "jurisdictionId", "meetingDate", "supportingSource"]) {
    if (candidate[field] != null) record[field] = candidate[field];
  }
  return record;
}

export function conflictUniqueKey(candidate) {
  const record = toConflictRecord(candidate);
  return `${record.politicianId}|${record.agendaItemId}|${record.conflictType}|${record.sourceKey}`;
}

export async function persistConflicts(candidates, deps = {}) {
  const rows = [];
  const seen = new Set();
  let duplicates = 0;

  for (const candidate of candidates || []) {
    const record = toConflictRecord(candidate);
    if (
      !record.politicianId ||
      !record.agendaItemId ||
      !record.conflictType ||
      !record.severity ||
      !record.ruleReference ||
      !record.sourceKey
    ) {
      continue;
    }
    const key = conflictUniqueKey(record);
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);
    rows.push(record);
  }

  if (rows.length === 0 && !deps.agendaItemIds?.length) {
    return { inserted: 0, skipped: 0 };
  }

  const client = await getPrisma(deps.prisma);
  if (!deps.agendaItemIds) {
    const result = await client.conflict.createMany({ data: rows, skipDuplicates: true });
    const inserted = result?.count ?? 0;
    return { inserted, skipped: rows.length - inserted };
  }
  const run = async (tx) => {
    const ids = [...new Set(deps.agendaItemIds)];
    if (!ids.length) return { inserted: 0, skipped: 0, inactivated: 0, reactivated: 0 };
    if (!tx.$queryRaw && !deps.prisma) throw new Error("Scoped reconciliation requires agenda row locks");
    // Lock parent agenda rows so overlapping detection runs serialize even when
    // there are no existing conflicts yet. All writes below share this transaction.
    if (tx.$queryRaw && ids.length && !deps.lockedAgendaItems) {
      for (const id of [...ids].sort()) {
        await tx.$queryRaw`SELECT id FROM agenda_items WHERE id = ${id}::uuid FOR UPDATE`;
      }
    }
    // Do not insert duplicates of legacy/manual records or assume they are ours.
    const occupied = await tx.conflict.findMany({
      where: { agendaItemId: { in: ids } },
      select: { id: true, politicianId: true, agendaItemId: true, conflictType: true, sourceKey: true,
        detectionOwner: true, eligibilityStatus: true, filingId: true, disclosureId: true,
        filingYear: true, jurisdictionId: true, meetingDate: true, supportingSource: true,
        severity: true, ruleReference: true, entityName: true },
    });
    const existing = occupied.filter((row) => row.detectionOwner === "SH-324");
    const keys = new Set(rows.map(conflictUniqueKey));
    const preserved = new Set(deps.preserveAgendaItemIds ?? []);
    const inactive = existing.filter((row) => !preserved.has(row.agendaItemId)
      && !keys.has(conflictUniqueKey(row)) && row.eligibilityStatus !== "inactive");
    const candidatesByKey = new Map(rows.map((row) => [conflictUniqueKey(row), row]));
    for (const row of inactive) await tx.conflict.update({ where: { id: row.id }, data: { eligibilityStatus: "inactive" } });
    let reactivated = 0;
    for (const row of existing) {
      const candidate = candidatesByKey.get(conflictUniqueKey(row));
      if (!candidate) continue;
      const data = {};
      if (row.eligibilityStatus !== "active") {
        data.eligibilityStatus = "active";
        reactivated += 1;
      }
      for (const field of ["severity", "ruleReference", "entityName", "filingId", "disclosureId", "filingYear", "jurisdictionId", "meetingDate", "supportingSource"]) {
        if (candidate[field] !== undefined && String(candidate[field]) !== String(row[field])) data[field] = candidate[field];
      }
      if (Object.keys(data).length) await tx.conflict.update({ where: { id: row.id }, data });
    }
    const occupiedKeys = new Set(occupied.map(conflictUniqueKey));
    const legacyKeys = new Set(occupied.filter((row) => !row.detectionOwner).map(conflictUniqueKey));
    const fresh = rows.filter((row) => {
      if (occupiedKeys.has(conflictUniqueKey(row))) return false;
      // The pre-SH-324 source key had no disclosure suffix. Do not duplicate
      // or take ownership of a legacy candidate for the same entity.
      const base = { ...row, sourceKey: row.sourceKey.replace(/:disclosure:[^:]+$/i, "") };
      return !legacyKeys.has(conflictUniqueKey(base));
    });
    const result = fresh.length ? await tx.conflict.createMany({
      data: fresh.map((row) => ({ ...row, detectionOwner: "SH-324", eligibilityStatus: "active" })),
      skipDuplicates: true,
    }) : { count: 0 };
    return { inserted: result.count, skipped: rows.length - result.count, inactivated: inactive.length, reactivated };
  };
  if (deps.lockedAgendaItems) return run(client);
  if (!client.$transaction) throw new Error("Scoped conflict reconciliation requires a transaction");
  return client.$transaction(run);
}
