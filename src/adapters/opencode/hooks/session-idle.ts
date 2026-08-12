/**
 * archive — auto-crystallize on session.idle.
 *
 * When session goes idle, run crystallize directly (the LLM is no longer
 * the writer for this). Records the outcome as an observation so the
 * archive phase stays debuggable.
 *
 * Threshold (tightened from 3 to 5 + priority gate):
 *   - ≥5 done actions AND
 *   - ≥1 of them has priority >= 7 (i.e. user-marked "high" intent)
 *
 * The priority gate prevents low-signal todo-bridge floods (medium/low
 * todos never become actions now, but manual createAction calls with
 * default priority 5 would still pile up — the gate filters those too).
 */

import type { Action } from "../../../core/types.js";
import {
  createCrystal,
  createObservation,
  listActions,
} from "../client.js";
import { isMcpOnly, isPhaseDisabled } from "./_shared.js";
import { invalidateSessionContext } from "./system-transform.js";

const DEBUG = process.env.OH_AM_DEBUG === "1";
const MIN_DONE_FOR_CRYSTAL = 5;
const MIN_HIGH_PRIORITY_ACTIONS = 1;
const HIGH_PRIORITY_THRESHOLD = 7;
const MAX_ACTIONS_PER_CRYSTAL = 12;

interface SessionStatusProperties {
  sessionID?: string;
  sessionId?: string;
  status?: { type?: string; attempt?: number; message?: string };
  project?: string | null;
}

export async function onSessionStatus(
  properties: SessionStatusProperties,
): Promise<void> {
  if (isPhaseDisabled("archive")) return;
  // In mcp-only mode, no capture plugin writes actions — skip the probe.
  if (isMcpOnly()) return;

  const status = properties.status;
  if (!status || status.type !== "idle") return;

  const sessionId = properties.sessionID ?? properties.sessionId ?? null;
  if (!sessionId) return;

  // Refresh the system-transform session context so the directive reflects
  // current done-action count on the next turn.
  invalidateSessionContext(sessionId);

  let doneActions: Action[] = [];
  try {
    doneActions = await listActions({ status: "done", limit: 25 });
  } catch (e) {
    if (DEBUG)
      console.error("[oh-am] actions list failed:", (e as Error).message);
    return;
  }

  const project = properties.project ?? null;

  // Threshold 1: total done count
  if (doneActions.length < MIN_DONE_FOR_CRYSTAL) {
    if (DEBUG) {
      console.error(
        `[oh-am] ${doneActions.length} done actions, need ${MIN_DONE_FOR_CRYSTAL} — skipping crystal`,
      );
    }
    return;
  }

  // Threshold 2: at least one high-priority action (priority >= 7)
  const highPriorityActions = doneActions.filter(
    (a) => typeof a.priority === "number" && a.priority >= HIGH_PRIORITY_THRESHOLD,
  );
  if (highPriorityActions.length < MIN_HIGH_PRIORITY_ACTIONS) {
    await createObservation({
      sessionId,
      hookType: "oh_am_crystal_skipped",
      project,
      data: {
        reason: "no_high_priority_action",
        doneActionCount: doneActions.length,
        highPriorityCount: highPriorityActions.length,
        threshold: MIN_DONE_FOR_CRYSTAL,
        highPriorityThreshold: HIGH_PRIORITY_THRESHOLD,
      },
    });
    if (DEBUG) {
      console.error(
        `[oh-am] ${doneActions.length} done but 0 high-priority — skipping crystal`,
      );
    }
    return;
  }

  const ids = doneActions.slice(0, MAX_ACTIONS_PER_CRYSTAL).map((a) => a.id);

  // Run crystallize directly — the LLM is no longer in the loop.
  let crystalOk = false;
  let crystalError: string | null = null;
  try {
    crystalOk = await createCrystal({
      actionIds: ids,
      project: project ?? undefined,
      sessionId,
    });
  } catch (e) {
    crystalError = (e as Error).message;
  }

  await createObservation({
    sessionId,
    hookType: crystalOk ? "oh_am_crystal_created" : "oh_am_crystal_failed",
    project,
    data: {
      doneActionCount: doneActions.length,
      highPriorityCount: highPriorityActions.length,
      actionIds: ids,
      threshold: MIN_DONE_FOR_CRYSTAL,
      success: crystalOk,
      error: crystalError,
    },
  });

  if (DEBUG) {
    if (crystalOk) {
      console.error(
        `[oh-am] crystal created from ${ids.length} done actions (${highPriorityActions.length} high-priority)`,
      );
    } else {
      console.error(
        `[oh-am] crystal create failed: ${crystalError ?? "unknown"}`,
      );
    }
  }
}

