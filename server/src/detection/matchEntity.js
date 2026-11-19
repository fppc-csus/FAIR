import Fuse from "fuse.js";
import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  ENTITY_RESOLUTION,
  MATCH_BANDS,
  isExcludedEntity,
} from "../config/conflictRules.js";
import {
  areSameEntity,
  normalizeEntityName,
} from "../utils/entityNorm.js";

export { normalizeEntityName } from "../utils/entityNorm.js";

export function pickField(row, ...keys) {
  if (!row) return undefined;
  for (const key of keys) {
    if (row[key] != null && row[key] !== "") return row[key];
  }
  return undefined;
}

export function collapseText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function getAgendaText(item = {}) {
  return [item.item_text, item.itemText, item.description, item.title]
    .filter((value) => value != null && String(value).trim() !== "")
    .join("\n");
}

export const FUZZY_WINDOW_WORD_LIMIT = 600;

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsPhrase(haystack, needle) {
  if (!haystack || !needle) return false;
  return new RegExp(`\\b${escapeRegex(needle)}\\b`).test(haystack);
}

export function scoreEntityInText(name, agendaText) {
  const needle = normalizeEntityName(name);
  const haystack = collapseText(agendaText);
  if (!needle || !haystack) return 0;

  if (containsPhrase(haystack, needle)) return 1;

  const needleWords = needle.split(" ");
  // One-word names ("Cisco", "Apple", "LandPaths") fuzzy-match unrelated words
  // ("Francisco"); they must appear exactly.
  if (needleWords.length < 2) return 0;
  // Exact phrases are searched across the whole text above. Fuzzy windows are
  // limited to the opening words (title + recommended action) so long staff
  // reports neither dominate runtime nor produce spurious near-matches.
  const hayWords = haystack.split(" ").slice(0, FUZZY_WINDOW_WORD_LIMIT);
  const n = Math.max(1, needleWords.length);
  const windows = [];

  if (hayWords.length <= n) {
    windows.push(hayWords.join(" "));
  } else {
    for (let i = 0; i <= hayWords.length - n; i++) {
      windows.push(hayWords.slice(i, i + n).join(" "));
    }
  }

  const fuse = new Fuse(
    windows.map((text) => ({ text })),
    {
      keys: ["text"],
      includeScore: true,
      ignoreLocation: true,
      threshold: 1,
    },
  );
  const results = fuse.search(needle);
  if (!results.length) return 0;
  return 1 - results[0].score;
}

function getGeminiApiKey() {
  return process.env.GEMINI_API_KEY || process.env.LLM_API_KEY || "";
}

const resolutionMetrics = {
  requestCount: 0,
  fallbackCount: 0,
  totalLatencyMs: 0,
  estimatedInputTokens: 0,
};

export function getEntityResolutionMetrics() {
  const averageLatencyMs = resolutionMetrics.requestCount
    ? Math.round(resolutionMetrics.totalLatencyMs / resolutionMetrics.requestCount)
    : 0;
  return { ...resolutionMetrics, averageLatencyMs };
}

export function resetEntityResolutionMetrics() {
  Object.assign(resolutionMetrics, {
    requestCount: 0,
    fallbackCount: 0,
    totalLatencyMs: 0,
    estimatedInputTokens: 0,
  });
}

function buildResolutionPrompt(name, agendaText) {
  const limitedAgendaText = String(agendaText || "").slice(
    0,
    ENTITY_RESOLUTION.MAX_AGENDA_TEXT_CHARS,
  );
  return `You determine whether an agenda item refers to a Form 700 entity.

Return only JSON in this exact shape: {"isMatch":true}
Use false when the organizations are different or the entity is not referenced.

Entity name: ${name}
Agenda item text: ${limitedAgendaText}`;
}

function withTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("entity resolution timed out")), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function parseGeminiMatch(text) {
  const cleaned = String(text || "").replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(cleaned);
  if (typeof parsed?.isMatch !== "boolean") throw new Error("invalid Gemini response");
  return parsed.isMatch;
}

export async function resolveEntityWithGemini(name, agendaText) {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    resolutionMetrics.fallbackCount += 1;
    return false;
  }

  const startedAt = performance.now();
  const prompt = buildResolutionPrompt(name, agendaText);
  resolutionMetrics.requestCount += 1;
  resolutionMetrics.estimatedInputTokens += Math.ceil(prompt.length / 4);
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: ENTITY_RESOLUTION.GEMINI_MODEL });
    const result = await withTimeout(
      model.generateContent(prompt),
      ENTITY_RESOLUTION.REQUEST_TIMEOUT_MS,
    );
    return parseGeminiMatch(result.response.text());
  } catch {
    resolutionMetrics.fallbackCount += 1;
    return false;
  } finally {
    resolutionMetrics.totalLatencyMs += Math.round(performance.now() - startedAt);
  }
}

export async function matchNamedEntity(name, agendaText, deps = {}) {
  if (isExcludedEntity(name)) {
    return { matched: false, score: 0, usedGemini: false, excluded: true };
  }

  const scoreFn = deps.scoreEntityInText ?? scoreEntityInText;
  const normalizedAgendaText = normalizeEntityName(agendaText);
  const score = areSameEntity(name, normalizedAgendaText)
    ? 1
    : scoreFn(name, agendaText);
  const result = { matched: false, score, usedGemini: false };

  if (score >= MATCH_BANDS.AUTO_MATCH) {
    result.matched = true;
    return result;
  }

  if (score < MATCH_BANDS.GEMINI_MIN) {
    return result;
  }

  result.usedGemini = true;
  const resolve = deps.resolveWithGemini ?? resolveEntityWithGemini;
  try {
    result.matched = (await resolve(name, agendaText)) === true;
  } catch {
    result.matched = false;
  }
  return result;
}
