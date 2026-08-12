/**
 * Shared types — agent-agnostic. No I/O, no external deps.
 */

import type { PhaseId } from "./config-types.js";

export type { OhAmMode, PhaseId } from "./config-types.js";

export interface Slot {
  label: string;
  content: string;
  pinned: boolean;
  readOnly: boolean;
  scope: "project" | "global";
  sizeLimit: number;
  updatedAt: string;
}

/** Pinned slot identifiers used by agentmemory. */
export type SlotLabel =
  | "persona"
  | "project_context"
  | "user_preferences"
  | "tool_guidelines"
  | "pending_items"
  | "guidance"
  | "self_notes"
  | "session_patterns";

export type ActionStatus = "pending" | "active" | "done" | "blocked" | "cancelled";

export interface Action {
  id: string;
  title: string;
  status: ActionStatus;
  priority?: number;
  tags?: string[];
}

/** Filter for `listActions`. All fields optional. */
export interface ActionListFilter {
  status?: ActionStatus;
  limit?: number;
}

/** Parameters for `createAction`. */
export interface ActionCreateParams {
  title: string;
  description?: string;
  priority?: number;
  /** Comma-separated tag string (agentmemory convention). */
  tags?: string;
  parentId?: string;
  requires?: string;
  project?: string;
}

/** Parameters for `updateAction`. All fields optional except actionId. */
export interface ActionUpdateParams {
  status?: ActionStatus;
  priority?: number;
  result?: string;
}

export type KeywordAction = "save" | "forget" | "recall";

export interface KeywordMatch {
  /** The matched substring. */
  match: string;
  /** Index in the source string. */
  index: number;
  /** What the keyword implies the agent should do. */
  action: KeywordAction;
  /** Pattern id that matched (for debug). */
  patternId: string;
}

export interface LessonCandidate {
  filePath: string;
  content: string;
  tags: string;
  confidence: number;
  /** False when filters reject (no history, tiny edit, no error signal). */
  shouldSave: boolean;
  /** Query string for `lesson_recall` duplicate check. */
  duplicateQuery: string;
  /** Human-readable skip reason for logs when `shouldSave` is false. */
  skipReason?: string;
}

export interface DirectiveContext {
  emptySlots: string[];
  doneActionCount: number;
  crystalCandidateIds: string[];
  pendingKeywords: KeywordMatch[];
  /** Disabled phases via OH_AM_DISABLE env var or config file. */
  disabledPhases: Set<PhaseId>;
  /** True when running without agentmemory-capture.ts (MCP-only mode). */
  mcpOnly: boolean;
}

export interface FileHistoryEntry {
  sessionId: string;
  timestamp: string;
  data: {
    tool_name?: string;
    tool_input?: string;
    tool_output?: string;
    error?: string;
    [k: string]: unknown;
  };
}

export interface FileEditEvent {
  filePath: string;
  additions: number;
  deletions: number;
}

// ── Todo bridge ────────────────────────────────────────────────────────────

/** A single todo entry as emitted by opencode's `todowrite` tool. */
export interface TodoEntry {
  content: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  priority: "high" | "medium" | "low";
}

/** Snapshot of all todos in a session, keyed by stable index. */
export interface TodoSnapshot {
  sessionId: string;
  todos: TodoEntry[];
  capturedAt: number;
}
