/**
 * Lesson builder — derives a LessonCandidate from a file's history.
 *
 * Pure function: takes file history + current edit metadata, returns a
 * candidate (or shouldSave=false with a skipReason). Adapter does the I/O
 * (history fetch, duplicate check, save).
 *
 * Error-signal keywords live in data/error-signals.ts; add a locale there,
 * not here. Filters are conservative on purpose — false negatives (skip a
 * real pattern) are cheap, false positives (save noise) accumulate over time.
 */

import { ERROR_SIGNALS } from "../data/error-signals.js";
import type {
  FileEditEvent,
  FileHistoryEntry,
  LessonCandidate,
} from "./types.js";

const ERROR_KEYWORDS: readonly string[] = Object.values(ERROR_SIGNALS).flat();

const MIN_EDIT_LINES = 5;
const MIN_HISTORY_ENTRIES = 1;
const MIN_ERROR_SIGNAL = 1;
const BASE_CONFIDENCE = 0.4;
const TAG_DEFAULT = "auto-captured,file-history";

/** True if any text field of an entry mentions an error keyword. */
function entryHasErrorSignal(entry: FileHistoryEntry): boolean {
  const data = entry.data ?? {};
  const fields = [
    typeof data.tool_input === "string" ? data.tool_input : "",
    typeof data.tool_output === "string" ? data.tool_output : "",
    typeof data.error === "string" ? data.error : "",
  ];
  const blob = fields.join(" ").toLowerCase();
  return ERROR_KEYWORDS.some((kw) => blob.includes(kw));
}

function extractShortContext(entries: FileHistoryEntry[]): string {
  // Pick the most recent entry with an error signal, fall back to most recent.
  const withError = entries.filter(entryHasErrorSignal);
  const pool = withError.length > 0 ? withError : entries;
  const latest = pool[pool.length - 1];
  if (!latest) return "";
  const out: string[] = [];
  if (latest.data?.tool_name) out.push(`tool=${latest.data.tool_name}`);
  if (latest.data?.error) {
    out.push(`error="${String(latest.data.error).slice(0, 140)}"`);
  } else if (latest.data?.tool_output) {
    out.push(`output="${String(latest.data.tool_output).slice(0, 140)}"`);
  }
  return out.join(" ");
}

export function buildLessonFromFileHistory(
  filePath: string,
  history: FileHistoryEntry[],
  currentEdit: FileEditEvent,
): LessonCandidate {
  const base: LessonCandidate = {
    filePath,
    content: "",
    tags: TAG_DEFAULT,
    confidence: BASE_CONFIDENCE,
    shouldSave: false,
    duplicateQuery: filePath,
  };

  if (history.length < MIN_HISTORY_ENTRIES) {
    return { ...base, skipReason: "no-file-history" };
  }

  const totalLines = currentEdit.additions + currentEdit.deletions;
  if (totalLines < MIN_EDIT_LINES) {
    return { ...base, skipReason: `edit-too-small(${totalLines}<?${MIN_EDIT_LINES})` };
  }

  const errorEntries = history.filter(entryHasErrorSignal);
  if (errorEntries.length < MIN_ERROR_SIGNAL) {
    return { ...base, skipReason: "no-error-signal-in-history" };
  }

  const context = extractShortContext(history);
  const recurrence = errorEntries.length;
  const fileName = filePath.split("/").pop() ?? filePath;

  const content = `Pattern in ${fileName}: ${recurrence} past ${
    recurrence === 1 ? "occurrence" : "occurrences"
  } with error signal. Latest context: ${context || "(no extractable text)"}. When touching this file again, recall this lesson first and verify the same failure mode is not re-introduced.`;

  return {
    filePath,
    content,
    tags: TAG_DEFAULT,
    confidence: BASE_CONFIDENCE,
    shouldSave: true,
    duplicateQuery: `file:${fileName} error pattern`,
  };
}

export const INTERNAL = {
  ERROR_KEYWORDS,
  MIN_EDIT_LINES,
  MIN_HISTORY_ENTRIES,
  BASE_CONFIDENCE,
  entryHasErrorSignal,
};
