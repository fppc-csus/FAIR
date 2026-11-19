import {
  CONFLICT_TYPES,
  RULE_REFERENCE,
  calculateSeverity,
  hasLandUseKeyword,
} from "../config/conflictRules.js";
import { getAgendaText, pickField } from "./matchEntity.js";

const STREET_CANON = [
  [/\b(street|str)\b/g, "st"],
  [/\b(avenue)\b/g, "ave"],
  [/\b(boulevard)\b/g, "blvd"],
  [/\b(road)\b/g, "rd"],
  [/\b(drive)\b/g, "dr"],
  [/\b(lane)\b/g, "ln"],
  [/\b(court)\b/g, "ct"],
  [/\b(place)\b/g, "pl"],
  [/\b(highway)\b/g, "hwy"],
  [/\b(circle)\b/g, "cir"],
  [/\b(parkway)\b/g, "pkwy"],
];

function canonicalizeLocation(value) {
  let text = String(value || "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  for (const [pattern, replacement] of STREET_CANON) {
    text = text.replace(pattern, replacement);
  }
  return text;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsPhrase(haystack, needle) {
  if (!haystack || !needle || needle.length < 3) return false;
  return new RegExp(`\\b${escapeRegex(needle)}\\b`).test(haystack);
}

export function preciseLocationInText(propertyDescription, agendaText) {
  const desc = canonicalizeLocation(propertyDescription);
  const text = canonicalizeLocation(agendaText);
  if (!desc || desc.length < 6 || !text) return false;
  if (text.includes(desc)) return true;

  const numbered = desc.match(/\b\d+\s+[a-z0-9]+(?:\s+[a-z0-9]+)?/);
  if (numbered && numbered[0].length >= 6 && text.includes(numbered[0])) {
    return true;
  }

  const apn = String(propertyDescription || "").match(
    /\b(?:apn\s*)?(\d{3,4}[-–]\d{2,4}[-–]\d{2,4})\b/i,
  );
  if (apn) {
    const parcel = apn[1].replace("–", "-");
    if (text.includes(canonicalizeLocation(parcel))) return true;
  }

  return false;
}

/**
 * The part of an item that states the decision: title, agenda note and the
 * Legistar "Recommended Action" section (or the opening of the text). Full
 * staff reports mention "development", parcels and place names incidentally.
 */
export function decisionText(agendaItem = {}) {
  const full = String(agendaItem.itemText ?? agendaItem.item_text ?? "");
  const action = full.match(/recommended action:?\s*([\s\S]*?)(?:\n\s*(?:executive summary|discussion|background|prior board actions?|fiscal summary)\s*:|$)/i)?.[1];
  return [agendaItem.title, agendaItem.description, action ?? full.slice(0, 1200)]
    .filter((value) => value != null && String(value).trim() !== "").join("\n");
}

// "Sonoma County" / "County of Sonoma" name the jurisdiction itself, not the
// city of Sonoma; remove them before looking for the property's city.
function withoutCountyNames(text) {
  return text.replace(/\bcounty of [a-z]+(?: [a-z]+)?\b|\b[a-z]+(?: [a-z]+)? county\b/g, " ");
}

function cityOrCountyInText(row, agendaText) {
  const text = withoutCountyNames(canonicalizeLocation(agendaText));
  const city = canonicalizeLocation(pickField(row, "city"));
  const county = canonicalizeLocation(pickField(row, "county"));

  if (containsPhrase(text, city)) return city;
  return null;
}

function sourceKey(label) {
  const norm = canonicalizeLocation(label);
  return `${CONFLICT_TYPES.REAL_ESTATE}:${norm || "property"}`;
}

export async function detectRealEstate(properties, agendaItem, options = {}) {
  const itemText = getAgendaText(agendaItem);
  const agendaItemId = pickField(agendaItem, "id");
  if (!agendaItemId || !Array.isArray(properties) || properties.length === 0) {
    return [];
  }

  const flags = [];
  const decision = decisionText(agendaItem);
  const landUse = hasLandUseKeyword(decision);

  for (const row of properties) {
    const politicianId = pickField(row, "politician_id", "politicianId");
    if (!politicianId) continue;

    const propertyDescription = pickField(
      row,
      "property_description",
      "propertyDescription",
    );
    const fairMarketValue = pickField(
      row,
      "fair_market_value",
      "fairMarketValue",
    );
    let matchedLabel = null;

    // Only the disclosed address or APN identifies the property. A city-name
    // match fired on every land-use item in the filer's own city, so it is
    // available solely behind the explicit `matchCity` option for research.
    if (preciseLocationInText(propertyDescription, itemText)) {
      matchedLabel = propertyDescription;
    } else if (options.matchCity && landUse) {
      matchedLabel = cityOrCountyInText(row, decision);
    }

    if (!matchedLabel) continue;

    flags.push({
      politician_id: politicianId,
      agenda_item_id: agendaItemId,
      conflict_type: CONFLICT_TYPES.REAL_ESTATE,
      severity: calculateSeverity({
        conflictType: CONFLICT_TYPES.REAL_ESTATE,
        amount: fairMarketValue,
      }),
      rule_reference: RULE_REFERENCE.REAL_ESTATE,
      entity_name: propertyDescription || matchedLabel,
      source_key: sourceKey(propertyDescription || matchedLabel),
    });
  }

  return flags;
}
