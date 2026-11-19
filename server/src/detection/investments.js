import { businessActivityOf } from "./entityContext.js";
import {
  CONFLICT_TYPES,
  RULE_REFERENCE,
  calculateSeverity,
  meetsInvestmentThreshold,
} from "../config/conflictRules.js";

import {
  getAgendaText,
  matchNamedEntity,
  normalizeEntityName,
  pickField,
} from "./matchEntity.js";

function sourceKey(entityName) {
  return `${CONFLICT_TYPES.INVESTMENT}:${
    normalizeEntityName(entityName) || "entity"
  }`;
}

export async function detectInvestments(investments, agendaItem, deps = {}) {
  const agendaText = getAgendaText(agendaItem);
  const agendaItemId = pickField(agendaItem, "id");

  if (
    !agendaItemId ||
    !Array.isArray(investments) ||
    investments.length === 0
  ) {
    return [];
  }

  const match = deps.matchNamedEntity ?? matchNamedEntity;
  const flags = [];

  for (const row of investments) {
    const politicianId = pickField(
      row,
      "politician_id",
      "politicianId"
    );

    const entityName = pickField(
      row,
      "entity_name",
      "entityName"
    );

    const fairMarketValue = pickField(
      row,
      "fair_market_value",
      "fairMarketValue"
    );

    if (!politicianId || !entityName) {
      continue;
    }

    if (!meetsInvestmentThreshold(fairMarketValue)) {
      continue;
    }

    const result = await match(entityName, agendaText, { ...deps, businessActivity: businessActivityOf(row) });

    if (!result.matched) {
      continue;
    }

    flags.push({
      politician_id: politicianId,
      agenda_item_id: agendaItemId,
      conflict_type: CONFLICT_TYPES.INVESTMENT,

      severity: calculateSeverity({
        conflictType: CONFLICT_TYPES.INVESTMENT,
        amount: fairMarketValue,
      }),

      rule_reference: RULE_REFERENCE.INVESTMENT,
      entity_name: entityName,
      source_key: sourceKey(entityName),
    });
  }

  return flags;
}