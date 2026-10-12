/**
 * enforcement — per-turn directive injection.
 *
 * Reads agentmemory state (slots, done actions) once per session, caches,
 * then on every context-model hook call pushes a directive string built by
 * core/directives.ts into event.system as a text SystemPart.
 *
 * Cheap on the hot path: no HTTP after first turn per session.
 */

import {
  buildDirective,
  directiveCacheKey,
} from "../../../core/directives.js";
import type { DirectiveContext } from "../../../core/types.js";
import type { PhaseId } from "../../../core/config-types.js";
import {
  drainSessionKeywords,
  listActions,
  listSlots,
  emptySlotLabels,
} from "../client.js";
import { isMcpOnly, getConfig } from "./_shared.js";

/** Narrow structural type for the OpenCode V2 session "context" hook event. */
interface SystemTransformEvent {
  readonly sessionID: string;
  system: Array<{ type: string; text?: string }>;
}

const DEBUG = process.env.OH_AM_DEBUG === "1";

const sessionDirectiveCache = new Map<string, string>();
const sessionContextCache = new Map<
  string,
  { emptySlots: string[]; doneActionIds: string[]; doneCount: number }
>();

function parseDisabledPhasesFromConfig(): Set<PhaseId> {
  return getConfig().disabled;
}

async function loadSessionContext(
  sessionId: string,
  project: string | null,
): Promise<{
  emptySlots: string[];
  doneActionIds: string[];
  doneCount: number;
}> {
  const cached = sessionContextCache.get(sessionId);
  if (cached) return cached;

  const [slots, done] = await Promise.all([
    listSlots(),
    listActions({ status: "done", limit: 25 }),
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

export const systemTransformHook = async (
  event: SystemTransformEvent,
): Promise<void> => {
  const sessionId = event?.sessionID ?? null;
  if (!sessionId) return;
  if (!event || !Array.isArray(event.system)) return;

  const disabled = parseDisabledPhasesFromConfig();
  if (disabled.has("enforcement")) return;

  const state = await loadSessionContext(sessionId, null);
  // Drain whatever the prompt hook queued for this turn.
  const pendingKeywords = drainSessionKeywords(sessionId);
  const mcpOnly = isMcpOnly();
  const ctx = buildCtx(state, pendingKeywords, disabled, mcpOnly);

  const cacheKey = `${sessionId}::${directiveCacheKey(ctx)}`;
  const cached = sessionDirectiveCache.get(sessionId);
  if (cached && sessionDirectiveCache.has(cacheKey)) {
    event.system.push({ type: "text", text: cached });
    return;
  }

  const directive = buildDirective(ctx, {
    mcpOnly,
  });
  sessionDirectiveCache.set(sessionId, directive);
  sessionDirectiveCache.set(cacheKey, directive);
  event.system.push({ type: "text", text: directive });
};

/** Called by session.created hook to drop caches when a new session starts. */
export function invalidateSessionContext(sessionId: string): void {
  sessionContextCache.delete(sessionId);
  sessionDirectiveCache.delete(sessionId);
}

function buildCtx(
  state: {
    emptySlots: string[];
    doneActionIds: string[];
    doneCount: number;
  },
  pendingKeywords: DirectiveContext["pendingKeywords"],
  disabledPhases: Set<PhaseId>,
  mcpOnly: boolean,
): DirectiveContext {
  return {
    emptySlots: state.emptySlots,
    doneActionCount: state.doneCount,
    crystalCandidateIds: state.doneActionIds,
    pendingKeywords,
    disabledPhases,
    mcpOnly,
  };
}
