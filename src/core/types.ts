/**
 * Shared types — agent-agnostic. No I/O, no external deps.
 */

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

export interface Slot {
  label: SlotLabel;
  content: string;
  pinned: boolean;
  readOnly: boolean;
  scope: "project" | "global";
  sizeLimit: number;
  updatedAt: string;
}

export interface Action {
  id: string;
  title: string;
  status: "pending" | "active" | "done" | "blocked" | "cancelled";
  priority?: number;
  tags?: string[];
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
  emptySlots: SlotLabel[];
  doneActionCount: number;
  crystalCandidateIds: string[];
  pendingKeywords: KeywordMatch[];
  /** Disabled phases via OH_AM_DISABLE env var. */
  disabledPhases: Set<PhaseId>;
}

export type PhaseId =
  | "phase1"
  | "phase2"
  | "phase3"
  | "phase4"
  | "phase5";

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
