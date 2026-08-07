/**
 * Directive builder — pure function. Adapter calls this with current
 * DirectiveContext, gets back a single string to push into the system prompt.
 *
 * Keep output stable across calls when context hasn't changed — the adapter
 * caches the result per session.
 */

import {
  CRYSTAL_POLICY,
  DIRECTIVE_FOOTER,
  DIRECTIVE_HEADER,
  RECALL_POLICY,
  WRITE_POLICY,
} from "./policy.js";
import type { DirectiveContext, KeywordMatch, PhaseId } from "./types.js";

const SEPARATOR = "\n---\n";

function bullets(rules: readonly { text: string }[]): string {
  return rules.map((r) => `• ${r.text}`).join("\n");
}

function emptySlotsLine(emptySlots: string[]): string {
  if (emptySlots.length === 0) return "";
  const list = emptySlots.join(", ");
  return `\n\n[STATE] Pinned slots empty: ${list}. If session.created bootstrap missed them, fill via memory_slot_replace before session ends.`;
}

function crystalLine(ctx: DirectiveContext): string {
  if (ctx.doneActionCount < 3) return "";
  const ids = ctx.crystalCandidateIds.slice(0, 12).join(",");
  return `\n\n[STATE] ${ctx.doneActionCount} done actions detected (ids: ${ids}). Per crystal-threshold rule, consider memory_crystallize this turn.`;
}

function keywordLine(pending: KeywordMatch[]): string {
  if (pending.length === 0) return "";
  const summary = pending
    .map((k) => `"${k.match}" → ${k.action}`)
    .slice(0, 5)
    .join("; ");
  return `\n\n[USER INTENT] User said: ${summary}. Act on it via the matching memory_* tool this turn.`;
}

function disabledNote(phases: Set<PhaseId>): string {
  if (phases.size === 0) return "";
  return `\n\n[DEBUG] Disabled phases: ${[...phases].join(", ")}.`;
}

export interface DirectiveBuildOptions {
  /** When true, omit the policy bodies and emit only the state/keyword lines. */
  compact?: boolean;
}

export function buildDirective(
  ctx: DirectiveContext,
  options: DirectiveBuildOptions = {},
): string {
  const parts: string[] = [DIRECTIVE_HEADER];

  if (!options.compact) {
    parts.push(
      `## Recall\n${bullets(RECALL_POLICY)}`,
      `## Write\n${bullets(WRITE_POLICY)}`,
      `## Crystal\n${bullets(CRYSTAL_POLICY)}`,
    );
  }

  const state = [
    emptySlotsLine(ctx.emptySlots),
    crystalLine(ctx),
    keywordLine(ctx.pendingKeywords),
    disabledNote(ctx.disabledPhases),
  ]
    .filter(Boolean)
    .join("");

  if (state) parts.push(state);

  parts.push(DIRECTIVE_FOOTER);

  return parts.join(SEPARATOR);
}

/** Hash the inputs that affect directive content — used by adapters for caching. */
export function directiveCacheKey(ctx: DirectiveContext): string {
  return [
    ctx.emptySlots.join(","),
    `${ctx.doneActionCount}`,
    ctx.crystalCandidateIds.join(","),
    ctx.pendingKeywords.map((k) => `${k.action}:${k.match}`).join("|"),
    [...ctx.disabledPhases].sort().join(","),
  ].join("::");
}
