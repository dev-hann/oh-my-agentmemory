/**
 * Phase 4 — crystal suggestion on session.idle.
 *
 * When session goes idle and ≥3 done actions exist, record a hint in
 * session-scoped state. The next system-transform directive will surface
 * "consider memory_crystallize this turn" to the LLM.
 *
 * The LLM is still the writer — we only reinforce intent. Done actions
 * with status=cancelled or pure-exploration sessions are skipped per
 * rules/memory.md crystal policy.
 */

import type { Action } from "../../../core/types.js";
import { getDoneActions, observe } from "../client.js";
import { invalidateSessionContext } from "./system-transform.js";

const DEBUG = process.env.OH_AM_DEBUG === "1";
const MIN_DONE_FOR_CRYSTAL = 3;

function parseDisabledPhases(): Set<string> {
  const raw = process.env.OH_AM_DISABLE ?? "";
  return new Set(
    raw
      .split(/[,\s]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

interface SessionStatusProperties {
  sessionID?: string;
  sessionId?: string;
  status?: { type?: string; attempt?: number; message?: string };
  project?: string | null;
}

export async function onSessionStatus(
  properties: SessionStatusProperties,
): Promise<void> {
  const disabled = parseDisabledPhases();
  if (disabled.has("phase4")) return;

  const status = properties.status;
  if (!status || status.type !== "idle") return;

  const sessionId = properties.sessionID ?? properties.sessionId ?? null;
  if (!sessionId) return;

  // Refresh the system-transform session context so the directive reflects
  // current done-action count on the next turn.
  invalidateSessionContext(sessionId);

  let doneActions: Action[] = [];
  try {
    doneActions = await getDoneActions(25);
  } catch (e) {
    if (DEBUG)
      console.error("[oh-am] frontier fetch failed:", (e as Error).message);
    return;
  }

  if (doneActions.length < MIN_DONE_FOR_CRYSTAL) {
    if (DEBUG) {
      console.error(
        `[oh-am] ${doneActions.length} done actions, crystal threshold not met`,
      );
    }
    return;
  }

  const ids = doneActions.slice(0, 12).map((a) => a.id);
  await observe(sessionId, "oh_am_crystal_candidate", properties.project ?? null, {
    doneActionCount: doneActions.length,
    actionIds: ids,
    threshold: MIN_DONE_FOR_CRYSTAL,
    hint: `Per crystal-threshold rule, consider memory_crystallize(actionIds="${ids.join(",")}") this turn or before session ends.`,
  });

  if (DEBUG) {
    console.error(
      `[oh-am] crystal candidate recorded: ${doneActions.length} done actions`,
    );
  }
}
