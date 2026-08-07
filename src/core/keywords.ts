/**
 * Keyword detection — bilingual (Korean + English) intent patterns.
 *
 * Pure function: takes a string, returns matches. Adapters wire this into
 * the chat-message hook and forward matches to the directive layer.
 */

import type { KeywordAction, KeywordMatch } from "./types.js";

interface Pattern {
  id: string;
  regex: RegExp;
  action: KeywordAction;
}

// Order matters: forget comes before save so "don't forget" matches forget,
// not the "forget" verb alone. Similarly "이거 기억하지 마" should map to
// forget, not save.
const PATTERNS: readonly Pattern[] = [
  // Forget / delete — checked first
  {
    id: "en-forget-explicit",
    regex: /\b(?:forget|delete that|don'?t remember|remove that memory)\b/gi,
    action: "forget",
  },
  {
    id: "en-forget-negation",
    regex: /\bdon'?t (?:save|remember|store) this\b/gi,
    action: "forget",
  },
  {
    id: "kr-forget",
    regex: /(?:잊어|지워|기억하지 마|_delete|삭제해)/g,
    action: "forget",
  },
  // Save / remember
  {
    id: "en-save",
    regex: /\b(?:remember this|save this|remember that|note that|keep this in mind|don'?t forget)\b/gi,
    action: "save",
  },
  {
    id: "en-save-implicit",
    regex: /\b(?:this is important|for future|for next time|worth remembering)\b/gi,
    action: "save",
  },
  {
    id: "kr-save",
    regex: /(?:기억해|저장해|남겨둬|메모해|기록해)/g,
    action: "save",
  },
  // Recall
  {
    id: "en-recall",
    regex: /\b(?:do you remember|recall|what did we (?:do|decide)|previously|last time|earlier)\b/gi,
    action: "recall",
  },
  {
    id: "kr-recall",
    regex: /(?:기억나|이전에|저번에|그때|예전에)/g,
    action: "recall",
  },
] as const;

const MAX_MATCHES_PER_TURN = 5;

export function matchKeywords(input: string): KeywordMatch[] {
  if (!input || typeof input !== "string") return [];
  const out: KeywordMatch[] = [];
  for (const pattern of PATTERNS) {
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
