/**
 * Intent keyword data — bilingual patterns grouped by action then locale.
 *
 * Add a language by adding a new locale key to each action. Regex source
 * strings are compiled at load time in core/keywords.ts.
 *
 * Order within an action matters when actions are scanned: forget is checked
 * before save so "don't forget" maps to forget, not the bare verb. This file
 * only holds source strings; the action ordering lives in keywords.ts.
 */

export type KeywordLocale = "en" | "ko";

export interface KeywordSet {
  forget: string[];
  save: string[];
  recall: string[];
}

export const KEYWORDS: Record<KeywordLocale, KeywordSet> = {
  en: {
    forget: [
      "\\b(?:forget|delete that|don'?t remember|remove that memory)\\b",
      "\\bdon'?t (?:save|remember|store) this\\b",
    ],
    save: [
      "\\b(?:remember this|save this|remember that|note that|keep this in mind|don'?t forget)\\b",
      "\\b(?:this is important|for future|for next time|worth remembering)\\b",
    ],
    recall: [
      "\\b(?:do you remember|recall|what did we (?:do|decide)|previously|last time|earlier)\\b",
    ],
  },
  ko: {
    forget: [
      "(?:잊어|지워|기억하지 마|삭제해)",
    ],
    save: [
      "(?:기억해|저장해|남겨둬|메모해|기록해)",
    ],
    recall: [
      "(?:기억나|이전에|저번에|그때|예전에)",
    ],
  },
};

/** All locales defined above — used by loaders to iterate. */
export const KEYWORD_LOCALES: readonly KeywordLocale[] = Object.keys(KEYWORDS) as KeywordLocale[];
