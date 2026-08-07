/**
 * Phase 1 — per-turn directive injection.
 *
 * Reads agentmemory state (slots, done actions) once per session, caches,
 * then on every system-transform call pushes a directive string built by
 * core/directives.ts into output.system.
 *
 * Cheap on the hot path: no HTTP after first turn per session.
 */

import type { Plugin } from "@opencode-ai/plugin";
import {
  buildDirective,
  directiveCacheKey,
} from "../../../core/directives.js";
import type { DirectiveContext, PhaseId, SlotLabel } from "../../../core/types.js";
import {
  drainSessionKeywords,
  getDoneActions,
  listSlots,
  emptySlotLabels,
} from "../client.js";

const DEBUG = process.env.OH_AM_DEBUG === "1";

const sessionDirectiveCache = new Map<string, string>();
const sessionContextCache = new Map<
  string,
  { emptySlots: SlotLabel[]; doneActionIds: string[]; doneCount: number }
>();

function parseDisabledPhases(): Set<PhaseId> {
  const raw = process.env.OH_AM_DISABLE ?? "";
  if (!raw) return new Set();
  const valid: PhaseId[] = [
    "phase1",
    "phase2",
    "phase3",
    "phase4",
    "phase5",
  ];
  const out = new Set<PhaseId>();
  for (const part of raw.split(/[,\s]+/)) {
    const p = part.trim().toLowerCase() as PhaseId;
    if (valid.includes(p)) out.add(p);
  }
  return out;
}

async function loadSessionContext(
  sessionId: string,
  project: string | null,
): Promise<{
  emptySlots: SlotLabel[];
  doneActionIds: string[];
  doneCount: number;
}> {
  const cached = sessionContextCache.get(sessionId);
  if (cached) return cached;

  const [slots, done] = await Promise.all([
    listSlots(),
    getDoneActions(25),
  ]);

  const value = {
    emptySlots: emptySlotLabels(slots),
    doneActionIds: done.map((a) => a.id),
    doneCount: done.length,
  };
  sessionContextCache.set(sessionId, value);
  if (DEBUG) {
    console.error(
      `[oh-am] ctx loaded for ${sessionId}: empty=${value.emptySlots.length} done=${value.doneCount}`,
    );
  }
  void project;
  return value;
}

function buildCtx(
  state: {
    emptySlots: SlotLabel[];
    doneActionIds: string[];
    doneCount: number;
  },
  pendingKeywords: DirectiveContext["pendingKeywords"],
  disabledPhases: Set<PhaseId>,
): DirectiveContext {
  return {
    emptySlots: state.emptySlots,
    doneActionCount: state.doneCount,
    crystalCandidateIds: state.doneActionIds,
    pendingKeywords,
    disabledPhases,
  };
}

export const systemTransformHook: NonNullable<
  Awaited<ReturnType<Plugin>>["experimental.chat.system.transform"]
> = async (input, output) => {
  const sessionId =
    (input as { sessionID?: string })?.sessionID ??
    (input as { sessionId?: string })?.sessionId ??
    null;
  if (!sessionId) return;
  if (!output || !Array.isArray(output.system)) return;

  const disabled = parseDisabledPhases();
  if (disabled.has("phase1")) return;

  const state = await loadSessionContext(sessionId, null);
  // Drain whatever the chat-message hook queued for this turn.
  const pendingKeywords = drainSessionKeywords(sessionId);
  const ctx = buildCtx(state, pendingKeywords, disabled);

  const cacheKey = `${sessionId}::${directiveCacheKey(ctx)}`;
  const cached = sessionDirectiveCache.get(sessionId);
  if (cached && sessionDirectiveCache.has(cacheKey)) {
    output.system.push(cached);
    return;
  }

  const directive = buildDirective(ctx);
  sessionDirectiveCache.set(sessionId, directive);
  sessionDirectiveCache.set(cacheKey, directive);
  output.system.push(directive);
};

/** Called by session.created hook to drop caches when a new session starts. */
export function invalidateSessionContext(sessionId: string): void {
  sessionContextCache.delete(sessionId);
  sessionDirectiveCache.delete(sessionId);
}
