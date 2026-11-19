/**
 * Deterministic (no-AI) helpers that widen and narrow entity matching:
 *
 *  - Variants: an entity also matches its configured aliases
 *    (config/entityAliases.js) and other spellings of its acronym, so a Form 700
 *    "PG&E" matches an agenda that says "Pacific Gas and Electric Company",
 *    "PGE" or "P.G.&E.", and vice versa.
 *  - Ambiguity: a one-word name that is also an ordinary English word
 *    ("Apple", "Scoop") must be corroborated by context near the mention: a
 *    corporate suffix ("Apple Inc.") or vocabulary from the filer's reported
 *    line of business ("Technology" → software, computer, iPhone…).
 */
import { COMMON_WORD_NAMES, ENTITY_ALIAS_GROUPS } from "../config/entityAliases.js";
import { normalizeEntityName } from "../utils/entityNorm.js";

const LEGAL_SUFFIXES = new Set(["inc", "incorporated", "corp", "corporation", "co", "company", "llc", "ltd", "limited", "plc", "lp", "llp"]);

/** "PG&E" → "pge", "P.G. & E." → "pge"; null when the text is not acronym-like. */
export function compactAcronym(value) {
  const text = String(value ?? "").trim();
  if (!/^[A-Z][A-Z.&\s-]*$/.test(text)) return null;
  const letters = text.replace(/[^A-Za-z]/g, "").toLowerCase();
  return letters.length >= 2 && letters.length <= 8 ? letters : null;
}

/** Normalised name with "and"/"&" ignored, so "Gas & Electric" = "Gas and Electric". */
function aliasKey(value) {
  return normalizeEntityName(value).split(" ").filter((word) => word && word !== "and").join(" ");
}

function aliasGroupFor(name) {
  const key = aliasKey(name);
  if (!key) return [];
  const compact = compactAcronym(name);
  return ENTITY_ALIAS_GROUPS.find((group) => group.some((alias) =>
    aliasKey(alias) === key || (compact && compactAcronym(alias) === compact))) ?? [];
}

/** All phrase forms to look for: the name itself plus known aliases. */
export function entityVariants(name) {
  const variants = [name, ...aliasGroupFor(name)];
  const seen = new Set();
  return variants.filter((variant) => {
    const key = normalizeEntityName(variant);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Acronyms the entity is known by: the compact form of the name and of its
 * configured aliases ("PG&E" → "pge"). Initials are never guessed from an
 * arbitrary name: "Annaly Capital Management" must not match "Agent for Cement
 * Masons". Spelled-out forms come only from the alias table.
 */
function acronymsFor(name) {
  return [...new Set(entityVariants(name)
    .map((variant) => compactAcronym(variant))
    .filter((value) => value && value.length >= 3))];
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Locate every mention of the entity in the agenda text: exact phrases of the
 * name or any configured alias (case- and punctuation-insensitive) and
 * upper-case acronym tokens in any spelling ("PG&E", "PGE", "P.G.&E.").
 * @returns {{ index: number, text: string, via: string }[]}
 */
export function findEntityMentions(name, agendaText) {
  const text = String(agendaText ?? "");
  if (!text || !normalizeEntityName(name)) return [];
  const mentions = [];

  for (const variant of entityVariants(name)) {
    const words = normalizeEntityName(variant).split(" ").filter((word) => word && word !== "and");
    if (!words.length) continue;
    // Words separated by any punctuation/space run, so "Pacific Gas & Electric"
    // and "Pacific Gas and Electric" are found from either spelling.
    const joiner = "(?:[^\\p{L}\\p{N}]+(?:and[^\\p{L}\\p{N}]+)?)";
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${words.map(escapeRegex).join(joiner)}(?![\\p{L}\\p{N}])`, "giu");
    for (const match of text.matchAll(pattern)) mentions.push({ index: match.index, text: match[0], via: variant === name ? "name" : "alias" });
  }

  const acronyms = acronymsFor(name);
  if (acronyms.length) {
    for (const match of text.matchAll(/(?<![\p{L}\p{N}])[A-Z](?:[A-Z]|[.&\s-]{1,3}(?=[A-Z](?:[.&]|[A-Z]|\b))|\.(?=\s|$))+(?![\p{L}\p{N}])/gu)) {
      const compact = match[0].replace(/[^A-Za-z]/g, "").toLowerCase();
      if (acronyms.includes(compact)) mentions.push({ index: match.index, text: match[0], via: "acronym" });
    }
  }

  return mentions.sort((a, b) => a.index - b.index);
}

/** True for a one-word name that is also an ordinary word, or is used as one in this text. */
export function isAmbiguousName(name, agendaText = "") {
  const words = normalizeEntityName(name).split(" ").filter(Boolean);
  while (words.length > 1 && LEGAL_SUFFIXES.has(words.at(-1))) words.pop();
  if (words.length !== 1) return false;
  const [word] = words;
  if (COMMON_WORD_NAMES.has(word)) return true;
  // Used as a common noun here ("cherry, apple, and grapefruit")?
  return new RegExp(`(?<![\\p{L}])${escapeRegex(word)}s?(?![\\p{L}])`, "u").test(String(agendaText));
}

// Distinctive vocabulary only. Words that are routine in government agendas
// ("application", "subscription", "fund", "license", "utility", "network",
// "data", "health") corroborated "Apple" in permit applications and "Scoop"
// in a newspaper subscription, so they are deliberately excluded.
const SECTOR_TERMS = [
  [/tech|software|it services|electronic|computer|semiconductor|internet|platform|digital/i,
    ["technology", "software", "computer", "computers", "hardware", "iphone", "iphones", "ipad", "ipads", "mac", "macs", "macbook", "macbooks", "laptop", "laptops", "smartphone", "smartphones", "tablet", "tablets", "cloud", "database", "server", "servers", "cybersecurity", "telecommunications", "electronics", "semiconductor", "semiconductors"]],
  [/oil|gas|energy|fuel|petrol|utilit|electric|power/i,
    ["oil", "petroleum", "pipeline", "refinery", "refineries", "gasoline", "diesel", "fuels", "drilling"]],
  [/bank|financ|invest|broker|mortgage|wealth|insur|credit|capital/i,
    ["bank", "banking", "banks", "mortgage", "mortgages", "brokerage", "insurer", "insurance", "securities"]],
  [/retail|store|e-?commerce|consumer/i,
    ["retailer", "retail", "shopping", "merchandise", "warehouse", "ecommerce"]],
  [/pharma|biotech|drug|medical device/i,
    ["pharmaceutical", "pharmaceuticals", "drug", "drugs", "vaccine", "vaccines", "prescription", "prescriptions"]],
  [/food|beverage|restaurant|grocery/i,
    ["beverage", "beverages", "restaurant", "restaurants", "grocery", "sandwich", "franchise"]],
  [/telecom|wireless|cable|communication/i,
    ["telecommunications", "wireless", "cellular", "broadband", "fiber"]],
  [/airline|aviation|transport|shipping|logistic/i,
    ["airline", "airlines", "flights", "aircraft", "aviation", "freight", "logistics"]],
];

const GENERIC_ACTIVITY_WORDS = new Set([
  "company", "services", "service", "business", "industry", "industries", "consumable", "equipment", "products",
  "product", "platform", "group", "holding", "holdings", "international", "national", "general", "public",
  "profit", "nonprofit", "community", "development", "management", "systems", "system", "application",
  "applications", "program", "programs", "health", "financial", "fund", "funds", "investment", "investments",
  "data", "network", "consulting", "provider", "providers", "supplies",
]);

/** Vocabulary that corroborates a mention, derived from the reported business activity. */
export function contextTermsFor(businessActivity) {
  const activity = String(businessActivity ?? "");
  if (!activity.trim()) return [];
  const own = normalizeEntityName(activity).split(" ")
    .filter((word) => word.length >= 4 && !GENERIC_ACTIVITY_WORDS.has(word));
  const sector = SECTOR_TERMS.filter(([pattern]) => pattern.test(activity)).flatMap(([, terms]) => terms);
  return [...new Set([...own, ...sector])];
}

/**
 * Whether at least one mention is supported by context: a corporate suffix
 * right after it, or a business-activity term within ~200 characters.
 */
export function isCorroborated(mentions, agendaText, businessActivity) {
  const text = String(agendaText ?? "");
  const terms = contextTermsFor(businessActivity);
  return mentions.some(({ index, text: found }) => {
    const after = text.slice(index + found.length, index + found.length + 30);
    if (/^[\s,]*(inc\.?|incorporated|corp\.?|corporation|computer|llc|ltd\.?|co\.)(?![\p{L}])/iu.test(after)) return true;
    if (!terms.length) return false;
    const window = text.slice(Math.max(0, index - 200), index + found.length + 200).toLowerCase();
    const words = new Set(window.split(/[^\p{L}\p{N}]+/u));
    return terms.some((term) => words.has(term));
  });
}

/** The filer's reported line of business for a disclosure row, if captured. */
export function businessActivityOf(row) {
  const details = row?.details;
  if (!Array.isArray(details)) return null;
  return details.find(({ label }) => /business activity/i.test(label))?.value ?? null;
}
