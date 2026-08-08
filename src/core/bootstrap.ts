/**
 * Slot bootstrap — fills empty pinned slots with sane defaults derived from cwd.
 *
 * Agent-agnostic: takes a cwd string, returns slot update payloads. The adapter
 * layer is responsible for actually POSTing to agentmemory.
 */

import type { SlotLabel } from "./types.js";

export interface SlotUpdate {
  label: SlotLabel;
  content: string;
}

export interface ProjectDetection {
  /** Stable identifier for project_context slot, e.g. "my-app". */
  projectId: string;
  /** Human-readable project name shown to the LLM. */
  displayName: string;
  /** Stack hints detected from cwd path heuristics. */
  stack: string[];
}

/**
 * Cwd → project mapping. Extend via `oh-am.jsonc` `projectMap` (mode: "merge"
 * prepends user entries so they win over these built-ins). Falls back to
 * basename of cwd when no entry matches.
 *
 * Built-ins are illustrative only — add your real projects to the config.
 */
const PROJECT_MAP: Array<{
  match: RegExp;
  detection: ProjectDetection;
}> = [
  {
    match: /my-app/i,
    detection: {
      projectId: "my-app",
      displayName: "my app",
      stack: ["TypeScript", "React"],
    },
  },
  {
    match: /my-api/i,
    detection: {
      projectId: "my-api",
      displayName: "my API service",
      stack: ["Go", "Postgres"],
    },
  },
];

export function detectProject(cwd: string): ProjectDetection {
  for (const entry of PROJECT_MAP) {
    if (entry.match.test(cwd)) return entry.detection;
  }
  const base = cwd.split("/").filter(Boolean).pop() ?? "unknown";
  return {
    projectId: base,
    displayName: base,
    stack: [],
  };
}

const PERSONA_DEFAULT = `You are a senior fullstack engineering assistant embedded in the user's editor (opencode).

Working style:
- Caveman mode aware — match the user's terse style when active
- Use agentmemory proactively (memory_recall, memory_save, memory_slot_replace, memory_lesson_save, memory_crystallize) per the policy directive injected every turn
- Read pinned slots before recalling — they are already in your context
- Never claim "memory updated" without an actual memory_* tool call in the turn

Communicate in Korean when the user writes Korean, English otherwise.`;

function buildProjectContext(detection: ProjectDetection): string {
  const stack =
    detection.stack.length > 0 ? detection.stack.join(", ") : "auto-detect";
  return `Project: ${detection.displayName} (id: ${detection.projectId})
Stack (heuristic): ${stack}
Source root: detected at session start

Conventions:
- Follow existing patterns in the repo — do not impose new libraries without checking package.json / equivalents
- Run lint/typecheck before claiming work done (prefer existing scripts)
- When in doubt about past decisions, recall agentmemory before re-discovering`;
}

const USER_PREFERENCES_DEFAULT = `Communication:
- Caveman terse style when active (drop articles, fragments OK)
- Korean↔English mixed codebase tolerated

Tools:
- Images / screenshots → zai MCP (do NOT use Read on binary)
- Figma files → figma-bridge MCP (do NOT webfetch Figma URLs)
- Past context → agentmemory (memory_recall / memory_smart_search) before file exploration
- File changes → confirm with user before writing (per AGENTS.md global rule)`;

const TOOL_GUIDELINES_DEFAULT = `Tool selection priority:
1. agentmemory MCP for past context (memory_recall, memory_smart_search)
2. zai MCP for any image / screenshot / video
3. figma-bridge MCP for Figma designs
4. Explore / Read / Grep only when memory lacks the answer
5. Edit / Write only after user confirms

Forbidden:
- Read on image files (use zai)
- webfetch on figma.com URLs (use figma-bridge)
- Claiming "memory updated" without a memory_* tool call
- Force-committing without explicit user request`;

/** Build slot updates for any of the four core slots that are empty. */
export function buildBootstrapUpdates(
  cwd: string,
  emptySlots: string[],
): SlotUpdate[] {
  if (emptySlots.length === 0) return [];
  const detection = detectProject(cwd);
  const updates: SlotUpdate[] = [];

  if (emptySlots.includes("persona")) {
    updates.push({ label: "persona", content: PERSONA_DEFAULT });
  }
  if (emptySlots.includes("project_context")) {
    updates.push({
      label: "project_context",
      content: buildProjectContext(detection),
    });
  }
  if (emptySlots.includes("user_preferences")) {
    updates.push({
      label: "user_preferences",
      content: USER_PREFERENCES_DEFAULT,
    });
  }
  if (emptySlots.includes("tool_guidelines")) {
    updates.push({
      label: "tool_guidelines",
      content: TOOL_GUIDELINES_DEFAULT,
    });
  }

  // pending_items / guidance / self_notes / session_patterns are intentionally
  // left empty — they are filled by the LLM at session-end / on-demand.
  return updates;
}
