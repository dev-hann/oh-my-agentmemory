/**
 * Keyword detection — bilingual (Korean + English) intent patterns.
 *
 * Pure function: takes a string, returns matches. Pattern source strings
 * live in data/keywords.ts; add a locale there, not here. Adapters wire
 * this into the chat-message hook and forward matches to the directive layer.
 */

import { KEYWORDS, KEYWORD_LOCALES, type KeywordLocale } from "../data/keywords.js";
import type { KeywordAction, KeywordMatch } from "./types.js";

interface Pattern {
  id: string;
  regex: RegExp;
  action: KeywordAction;
}

// Order matters: forget comes before save so "don't forget" matches forget,
// not the "forget" verb alone. Similarly "이거 기억하지 마" should map to
// forget, not save.
const ACTION_ORDER: readonly KeywordAction[] = ["forget", "save", "recall"];

let cachedPatterns: readonly Pattern[] | null = null;

/** Compile locale source strings into Pattern objects. Memoized. */
function loadPatterns(): readonly Pattern[] {
  if (cachedPatterns) return cachedPatterns;
  const out: Pattern[] = [];
  for (const action of ACTION_ORDER) {
    for (const locale of KEYWORD_LOCALES) {
      const sources = KEYWORDS[locale][action];
      for (const src of sources) {
        const flags = locale === "ko" ? "g" : "gi";
        out.push({
          id: `${locale}-${action}`,
          regex: new RegExp(src, flags),
          action,
        });
      }
    }
  }
  cachedPatterns = out;
  return out;
}

const MAX_MATCHES_PER_TURN = 5;

export function matchKeywords(input: string): KeywordMatch[] {
  if (!input || typeof input !== "string") return [];
  const patterns = loadPatterns();
  const out: KeywordMatch[] = [];
  for (const pattern of patterns) {
    const re = new RegExp(pattern.regex.source, pattern.regex.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(input)) !== null) {
      out.push({
        match: m[0],
        index: m.index,
        action: pattern.action,
        patternId: pattern.id,
      });
      if (out.length >= MAX_MATCHES_PER_TURN) {
        return dedupe(out);
      }
    }
  }
  return dedupe(out);
}

function dedupe(matches: KeywordMatch[]): KeywordMatch[] {
  const seen = new Set<string>();
  const result: KeywordMatch[] = [];
  for (const m of matches) {
    const key = `${m.action}:${m.match.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(m);
  }
  return result;
}

/** Convenience for adapters — one-line summary for logs / observe events. */
export function summarizeMatches(matches: KeywordMatch[]): string {
  if (matches.length === 0) return "";
  return matches.map((m) => `${m.action}:"${m.match}"`).join(", ");
}

export const INTERNAL = {
  loadPatterns,
  KEYWORD_LOCALES,
  ACTION_ORDER,
};

export type { KeywordLocale };
