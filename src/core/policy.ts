/**
 * Policy — rules/memory.md encoded as data so directives stay consistent
 * across turns and adapters. Edit text here to retune the agent's behavior.
 *
 * Keep strings short — these get pushed into the system prompt every turn.
 */

export interface PolicyRule {
  id: string;
  /** Imperative one-liner shown to the LLM. */
  text: string;
}

export const RECALL_POLICY: readonly PolicyRule[] = [
  {
    id: "recall-first",
    text: "Need past context (recent work, decisions, prior bugs)? Call memory_recall or memory_smart_search BEFORE exploring files.",
  },
  {
    id: "pinned-skip",
    text: "Pinned slots (persona, project_context, user_preferences, tool_guidelines, pending_items, guidance) are auto-injected every turn — do NOT re-recall them.",
  },
  {
    id: "trivial-skip",
    text: "Trivial tasks (single-file read, arithmetic, grep) skip memory calls.",
  },
] as const;

export const WRITE_POLICY: readonly PolicyRule[] = [
  {
    id: "arch-decision",
    text: "After architectural or non-obvious technical decisions, call memory_save with the decision and concepts.",
  },
  {
    id: "lesson-on-pattern",
    text: "Discovered an effective or ineffective approach? Call memory_lesson_save with what worked / what to avoid.",
  },
  {
    id: "slot-on-structural-change",
    text: "Project structure / build pipeline / new module added? Call memory_slot_replace on project_context.",
  },
  {
    id: "slot-on-pending",
    text: "Unfinished work or follow-up promised? Call memory_slot_replace on pending_items.",
  },
  {
    id: "slot-on-handoff",
    text: "Session about to end with loose ends? Call memory_slot_replace on guidance for the next session.",
  },
  {
    id: "action-on-multistep",
    text: "Starting multi-step work that spans sessions or has cross-cutting impact? Create memory_action entries with priority >= 7 (high). Use todowrite for session-local micro-tasks — oh-am bridges high-priority todos only.",
  },
  {
    id: "action-from-todos",
    text: "oh-am auto-bridges high-priority todowrite entries to actions (tags: from-todo). Medium/low todos stay session-local. For non-todo persistent work (debugging, design, investigations), create memory_action manually with high priority.",
  },
  {
    id: "no-false-report",
    text: "Never claim 'memory updated' without an actual memory_* tool call in this turn.",
  },
] as const;

export const CRYSTAL_POLICY: readonly PolicyRule[] = [
  {
    id: "crystal-threshold",
    text: "Five or more actions with status=done, at least one of them high-priority (≥7)? oh-am's archive hook auto-crystallizes on session.idle — no manual memory_crystallize needed.",
  },
  {
    id: "crystal-skip",
    text: "Fewer than five done actions, or zero high-priority done actions, or pure exploration with zero file changes → skip crystallize.",
  },
] as const;

export const DIRECTIVE_HEADER =
  "AGENTMEMORY POLICY ACTIVE. Use agentmemory MCP tools proactively. Rules below override default behavior.";

export const DIRECTIVE_FOOTER =
  "Pinned slots are already in your context — do not re-recall them. Calling memory_* without an actual tool call in this turn = false report (forbidden).";
