/**
 * learning — auto lesson capture on file.edited.
 *
 * When a file edit is committed, fetch the file's history from agentmemory,
 * build a LessonCandidate via core/lessons.ts, dedupe against existing
 * lessons, and save if it passes the filters.
 *
 * All HTTP calls are cached per-filepath with a short TTL to avoid hammering
 * the agentmemory API on rapid successive edits.
 */

import { buildLessonFromFileHistory } from "../../../core/lessons.js";
import type { FileEditEvent, FileHistoryEntry } from "../../../core/types.js";
import {
  getFileHistory,
  observe,
  recallLessons,
  saveLesson,
} from "../client.js";
import { isMcpOnly, isPhaseDisabled } from "./_shared.js";

const DEBUG = process.env.OH_AM_DEBUG === "1";
const FILE_HISTORY_TTL_MS = 5 * 60 * 1000;
const FILE_HISTORY_MAX = 50;

interface HistoryCacheEntry {
  history: FileHistoryEntry[];
  fetchedAt: number;
  inFlight: Promise<FileHistoryEntry[]> | null;
}
const historyCache = new Map<string, HistoryCacheEntry>();
// Debounce: don't re-evaluate the same file more than once per N seconds.
const recentEvaluations = new Map<string, number>();
const DEBOUNCE_MS = 60 * 1000;

async function fetchHistory(
  filePath: string,
  sessionId: string,
): Promise<FileHistoryEntry[]> {
  const now = Date.now();
  const cached = historyCache.get(filePath);
  if (cached && now - cached.fetchedAt < FILE_HISTORY_TTL_MS) {
    return cached.history;
  }
  if (cached?.inFlight) {
    return cached.inFlight;
  }
  const inFlight = getFileHistory(filePath, sessionId).then((h) =>
    h.slice(-FILE_HISTORY_MAX),
  );
  historyCache.set(filePath, { history: [], fetchedAt: now, inFlight });
  try {
    const history = await inFlight;
    historyCache.set(filePath, { history, fetchedAt: now, inFlight: null });
    return history;
  } catch (e) {
    historyCache.delete(filePath);
    throw e;
  }
}

export async function onFileEdited(params: {
  sessionId: string;
  project: string | null;
  filePath: string;
  additions?: number;
  deletions?: number;
}): Promise<void> {
  if (isPhaseDisabled("learning")) return;
  // In mcp-only mode, file_history is permanently empty — skip the HTTP.
  if (isMcpOnly()) return;

  const { sessionId, project, filePath } = params;
  if (!filePath) return;

  const now = Date.now();
  const last = recentEvaluations.get(filePath) ?? 0;
  if (now - last < DEBOUNCE_MS) {
    if (DEBUG) {
      console.error(
        `[oh-am] ${filePath} debounced (${Math.round((now - last) / 1000)}s since last eval)`,
      );
    }
    return;
  }
  recentEvaluations.set(filePath, now);

  let history: FileHistoryEntry[];
  try {
    history = await fetchHistory(filePath, sessionId);
  } catch (e) {
    if (DEBUG)
      console.error(
        `[oh-am] history fetch failed for ${filePath}:`,
        (e as Error).message,
      );
    return;
  }

  const edit: FileEditEvent = {
    filePath,
    additions: params.additions ?? 0,
    deletions: params.deletions ?? 0,
  };

  const candidate = buildLessonFromFileHistory(filePath, history, edit);

  // Dedupe against existing lessons (only meaningful when saving).
  let existing: Array<{ id: string; content: string; confidence: number }> = [];
  if (candidate.shouldSave) {
    try {
      existing = await recallLessons(candidate.duplicateQuery, 5);
    } catch (e) {
      if (DEBUG)
        console.error(
          `[oh-am] lesson recall failed, proceeding with save:`,
          (e as Error).message,
        );
    }

    if (existing.length > 0) {
      // Duplicate content auto-strengthens per agentmemory API behavior.
      // We still save — agentmemory dedupes internally — but at lower confidence.
      if (DEBUG) {
        console.error(
          `[oh-am] ${filePath} existing lesson found (id=${existing[0].id}), saving duplicate for reinforcement`,
        );
      }
    }
  }

  let saved = false;
  if (candidate.shouldSave) {
    saved = await saveLesson(
      candidate.content,
      candidate.tags,
      candidate.confidence,
      project ?? undefined,
    );
  }

  // Always observe — records that the hook fired even when skipping the save,
  // so the learning phase is debuggable without OH_AM_DEBUG.
  await observe(sessionId, "oh_am_lesson_auto", project, {
    filePath,
    additions: edit.additions,
    deletions: edit.deletions,
    historyEntries: history.length,
    duplicateCount: existing.length,
    shouldSave: candidate.shouldSave,
    saved,
    skipReason: candidate.skipReason ?? null,
    preview: candidate.content.slice(0, 200),
  });

  if (DEBUG) {
    if (candidate.shouldSave) {
      console.error(
        `[oh-am] ${filePath} lesson ${saved ? "saved" : "save-failed"} (history=${history.length} dupes=${existing.length})`,
      );
    } else {
      console.error(
        `[oh-am] ${filePath} skipped: ${candidate.skipReason ?? "no-reason"}`,
      );
    }
  }
}

/** Test-only helper to reset internal caches between unit/integration runs. */
export function _resetCachesForTests(): void {
  historyCache.clear();
  recentEvaluations.clear();
}
