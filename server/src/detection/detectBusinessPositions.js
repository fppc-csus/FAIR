import { businessActivityOf } from "./entityContext.js";
import {
  CONFLICT_TYPES,
  RULE_REFERENCE,
  calculateSeverity,
} from "../config/conflictRules.js";
import {
  getAgendaText,
  matchNamedEntity,
  normalizeEntityName,
  pickField,
} from "./matchEntity.js";

function sourceKey(entityName) {
  return `${CONFLICT_TYPES.BUSINESS_POSITION}:${normalizeEntityName(entityName) || "entity"}`;
}

export async function detectBusinessPositions(positions, agendaItem, deps = {}) {
  const agendaText = getAgendaText(agendaItem);
  const agendaItemId = pickField(agendaItem, "id");
  if (!agendaItemId || !Array.isArray(positions) || positions.length === 0) {
    return [];
  }

  const match = deps.matchNamedEntity ?? matchNamedEntity;
  const flags = [];

  for (const row of positions) {
    const politicianId = pickField(row, "politician_id", "politicianId");
    const entityName = pickField(row, "entity_name", "entityName");
    if (!politicianId || !entityName) continue;

    const result = await match(entityName, agendaText, { ...deps, businessActivity: businessActivityOf(row) });
    if (!result.matched) continue;

    flags.push({
      politician_id: politicianId,
      agenda_item_id: agendaItemId,
      conflict_type: CONFLICT_TYPES.BUSINESS_POSITION,
      severity: calculateSeverity({
        conflictType: CONFLICT_TYPES.BUSINESS_POSITION,
      }),
      rule_reference: RULE_REFERENCE.BUSINESS_POSITION,
      entity_name: entityName,
      source_key: sourceKey(entityName),
    });
  }

  return flags;
}
