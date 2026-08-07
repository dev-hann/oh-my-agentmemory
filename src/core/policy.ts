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
    id: "no-false-report",
    text: "Never claim 'memory updated' without an actual memory_* tool call in this turn.",
  },
] as const;

export const CRYSTAL_POLICY: readonly PolicyRule[] = [
  {
    id: "crystal-threshold",
    text: "Three or more actions with status=done? Call memory_recall first to check for an existing crystal, then memory_crystallize with the done action IDs.",
  },
  {
    id: "crystal-skip",
    text: "Fewer than three done actions, or pure exploration with zero file changes → skip crystallize.",
  },
] as const;

export const DIRECTIVE_HEADER =
  "AGENTMEMORY POLICY ACTIVE. Use agentmemory MCP tools proactively. Rules below override default behavior.";

export const DIRECTIVE_FOOTER =
  "Pinned slots are already in your context — do not re-recall them. Calling memory_* without an actual tool call in this turn = false report (forbidden).";
