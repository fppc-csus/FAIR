import { businessActivityOf } from "./entityContext.js";
import {
  RULE_REFERENCE,
  calculateSeverity,
  conflictTypeForSchedule,
  isGovernmentSource,
  meetsAmountThreshold,
} from "../config/conflictRules.js";
import {
  getAgendaText,
  matchNamedEntity,
  normalizeEntityName,
  pickField,
} from "./matchEntity.js";

function sourceKey(conflictType, sourceName) {
  return `${conflictType}:${normalizeEntityName(sourceName) || "source"}`;
}

export async function detectIncomeGiftsTravel(sources, agendaItem, deps = {}) {
  const agendaText = getAgendaText(agendaItem);
  const agendaItemId = pickField(agendaItem, "id");
  if (!agendaItemId || !Array.isArray(sources) || sources.length === 0) {
    return [];
  }

  const match = deps.matchNamedEntity ?? matchNamedEntity;
  const flags = [];

  for (const row of sources) {
    const politicianId = pickField(row, "politician_id", "politicianId");
    const sourceName = pickField(row, "source_name", "sourceName");
    const scheduleType = pickField(row, "schedule_type", "scheduleType");
    const amount = pickField(row, "amount");
    const conflictType = conflictTypeForSchedule(scheduleType);

    if (!politicianId || !sourceName || !conflictType) continue;
    if (conflictType === "INCOME" && isGovernmentSource(sourceName)) continue;
    // Gifts from one source aggregate across the statement (§87103(e)).
    const decisionYear = new Date(pickField(agendaItem, "meetingDate", "meeting_date") ?? NaN).getUTCFullYear();
    if (!meetsAmountThreshold(scheduleType, row.aggregate_amount ?? amount, { year: decisionYear })) continue;

    const result = await match(sourceName, agendaText, { ...deps, businessActivity: businessActivityOf(row) });
    if (!result.matched) continue;

    flags.push({
      politician_id: politicianId,
      agenda_item_id: agendaItemId,
      conflict_type: conflictType,
      severity: calculateSeverity({ conflictType, amount }),
      rule_reference: RULE_REFERENCE[conflictType] ?? RULE_REFERENCE.INCOME,
      entity_name: sourceName,
      source_key: sourceKey(conflictType, sourceName),
    });
  }

  return flags;
}
