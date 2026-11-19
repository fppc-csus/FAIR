/**
 * Deterministic (no-AI) helpers that widen and narrow entity matching:
 *
 *  - Variants: an entity also matches its known aliases (config/entityAliases.js)
 *    and its acronym, so a Form 700 "PG&E" matches an agenda that says
 *    "Pacific Gas and Electric Company", "PGE" or "P.G.&E.", and vice versa.
 *  - Ambiguity: a one-word name that is also an ordinary English word
 *    ("Apple", "Scoop") must be corroborated by context near the mention: a
 *    corporate suffix ("Apple Inc.") or vocabulary from the filer's reported
 *    line of business ("Technology" → software, computer, iPhone…).
 */
import { COMMON_WORD_NAMES, ENTITY_ALIAS_GROUPS } from "../config/entityAliases.js";
import { normalizeEntityName } from "../utils/entityNorm.js";

const STOPWORDS = new Set(["and", "of", "the", "for", "in", "at", "on", "a", "an", "to"]);
const LEGAL_SUFFIXES = new Set(["inc", "incorporated", "corp", "corporation", "co", "company", "llc", "ltd", "limited", "plc", "lp", "llp"]);

/** "PG&E" → "pge", "P.G. & E." → "pge"; null when the text is not acronym-like. */
export function compactAcronym(value) {
  const text = String(value ?? "").trim();
  if (!/^[A-Z][A-Z.&\s-]*$/.test(text)) return null;
  const letters = text.replace(/[^A-Za-z]/g, "").toLowerCase();
  return letters.length >= 2 && letters.length <= 8 ? letters : null;
}

/** Initials of the significant words: "Pacific Gas and Electric Company" → "pge". */
export function initialsOf(value) {
  const words = normalizeEntityName(value).split(" ").filter(Boolean);
  while (words.length && LEGAL_SUFFIXES.has(words.at(-1))) words.pop();
  const significant = words.filter((word) => !STOPWORDS.has(word));
  if (significant.length < 2) return null;
  const initials = significant.map((word) => word[0]).join("");
  return initials.length >= 3 ? initials : null;
}

function aliasGroupFor(name) {
  const key = normalizeEntityName(name);
  if (!key) return [];
  const compact = compactAcronym(name);
  return ENTITY_ALIAS_GROUPS.find((group) => group.some((alias) =>
    normalizeEntityName(alias) === key || (compact && compactAcronym(alias) === compact))) ?? [];
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

/** Acronyms the entity is known by: its own compact form and its initials. */
function acronymsFor(name) {
  return [...new Set(entityVariants(name)
    .flatMap((variant) => [compactAcronym(variant), initialsOf(variant)])
    .filter((value) => value && value.length >= 3))];
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Locate every mention of the entity in the agenda text: exact phrases of any
 * variant (case- and punctuation-insensitive), upper-case acronym tokens
 * ("PG&E", "PGE"), and capitalised spelled-out phrases whose initials equal
 * the entity's acronym ("Pacific Gas and Electric").
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
    // Spelled-out form of an acronym-only disclosure ("PG&E" → "Pacific Gas and Electric").
    const tokens = [...text.matchAll(/[\p{L}][\p{L}'’-]*/gu)];
    for (let start = 0; start < tokens.length; start += 1) {
      if (!/^\p{Lu}/u.test(tokens[start][0])) continue;
      let initials = "";
      for (let end = start; end < Math.min(tokens.length, start + 8); end += 1) {
        const word = tokens[end][0];
        const lower = word.toLowerCase();
        if (STOPWORDS.has(lower) && end > start) continue;
        if (!/^\p{Lu}/u.test(word)) break;
        initials += lower[0];
        if (initials.length >= 3 && acronyms.includes(initials)) {
          const last = tokens[end];
          const phrase = text.slice(tokens[start].index, last.index + last[0].length);
          if (!/[.;:!?,\n]/.test(phrase)) mentions.push({ index: tokens[start].index, text: phrase, via: "expansion" });
          break;
        }
      }
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

const SECTOR_TERMS = [
  [/tech|software|it services|electronic|computer|semiconductor|internet|platform|digital/i,
    ["technology", "software", "computer", "computers", "hardware", "device", "devices", "iphone", "ipad", "ipads", "mac", "macbook", "laptop", "laptops", "network", "networking", "cloud", "data", "database", "server", "servers", "license", "licenses", "licensing", "subscription", "app", "application", "applications", "platform", "digital", "internet", "it", "cyber", "cybersecurity", "telecommunications", "electronics"]],
  [/oil|gas|energy|fuel|petrol|utilit|electric|power/i,
    ["energy", "oil", "gas", "fuel", "fuels", "petroleum", "pipeline", "refinery", "utility", "utilities", "electric", "electrical", "power", "station", "gasoline"]],
  [/bank|financ|invest|broker|mortgage|wealth|insur|credit|capital/i,
    ["bank", "banking", "loan", "loans", "financial", "finance", "investment", "credit", "deposit", "deposits", "mortgage", "broker", "insurance", "fund", "funds", "account"]],
  [/retail|store|e-?commerce|consumer/i,
    ["store", "stores", "retail", "retailer", "purchase", "purchases", "shopping", "merchandise", "supplies", "online"]],
  [/health|pharma|medic|hospital|biotech|drug/i,
    ["health", "healthcare", "medical", "pharmaceutical", "pharmaceuticals", "drug", "drugs", "clinic", "hospital", "patients", "vaccine"]],
  [/food|beverage|restaurant|grocery/i,
    ["food", "beverage", "beverages", "restaurant", "restaurants", "grocery", "drinks", "catering"]],
  [/telecom|wireless|cable|communication/i,
    ["telecommunications", "wireless", "cellular", "phone", "phones", "broadband", "cable", "communications", "fiber"]],
  [/transport|airline|rail|shipping|logistic|vehicle|auto/i,
    ["transportation", "airline", "airport", "flights", "rail", "shipping", "freight", "logistics", "vehicle", "vehicles", "fleet", "trucks"]],
];

/** Vocabulary that corroborates a mention, derived from the reported business activity. */
export function contextTermsFor(businessActivity) {
  const activity = String(businessActivity ?? "");
  if (!activity.trim()) return [];
  const own = normalizeEntityName(activity).split(" ")
    .filter((word) => word.length >= 4 && !["company", "services", "business", "industry", "consumable", "equipment"].includes(word));
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
