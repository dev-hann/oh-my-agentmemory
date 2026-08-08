/**
 * Error-signal keyword data — used by lessons.ts to detect whether a file's
 * history contains failure signals worth saving as a lesson.
 *
 * Add a language by adding a new locale key. The loader flattens all locales
 * into a single match list.
 *
 * Keep entries short and lowercase — matching is case-insensitive substring
 * search on the concatenated tool input/output/error text.
 */

export type ErrorSignalLocale = "en" | "ko";

export const ERROR_SIGNALS: Record<ErrorSignalLocale, readonly string[]> = {
  en: [
    "error",
    "fail",
    "failed",
    "failure",
    "crash",
    "crashed",
    "exception",
    "bug",
    "fix",
    "fixed",
    "regression",
    "broken",
    "undefined is not",
    "null pointer",
    "typeerror",
  ],
  ko: [
    "에러",
    "오류",
    "실패",
    "버그",
    "수정",
    "고침",
    "깨짐",
    "오작동",
  ],
};
