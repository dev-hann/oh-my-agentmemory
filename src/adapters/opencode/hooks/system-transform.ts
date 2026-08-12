/**
 * enforcement — per-turn directive injection.
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
import type { DirectiveContext } from "../../../core/types.js";
import type { PhaseId } from "../../../core/config-types.js";
import {
  drainSessionKeywords,
  listActions,
  listSlots,
  emptySlotLabels,
} from "../client.js";
import { isMcpOnly, getConfig } from "./_shared.js";

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

export const systemTransformHook: NonNullable<
  Awaited<ReturnType<Plugin>>["experimental.chat.system.transform"]
> = async (input, output) => {
  const sessionId =
    (input as { sessionID?: string })?.sessionID ??
    (input as { sessionId?: string })?.sessionId ??
    null;
  if (!sessionId) return;
  if (!output || !Array.isArray(output.system)) return;

  const disabled = parseDisabledPhasesFromConfig();
  if (disabled.has("enforcement")) return;

  const state = await loadSessionContext(sessionId, null);
  // Drain whatever the chat-message hook queued for this turn.
  const pendingKeywords = drainSessionKeywords(sessionId);
  const mcpOnly = isMcpOnly();
  const ctx = buildCtx(state, pendingKeywords, disabled, mcpOnly);

  const cacheKey = `${sessionId}::${directiveCacheKey(ctx)}`;
  const cached = sessionDirectiveCache.get(sessionId);
  if (cached && sessionDirectiveCache.has(cacheKey)) {
    output.system.push(cached);
    return;
  }

  const directive = buildDirective(ctx, {
    mcpOnly,
  });
  sessionDirectiveCache.set(sessionId, directive);
  sessionDirectiveCache.set(cacheKey, directive);
  output.system.push(directive);
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
