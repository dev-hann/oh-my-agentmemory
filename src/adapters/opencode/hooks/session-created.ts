/**
 * init — bootstrap empty pinned slots on session.created.
 *
 * Triggered when a new opencode session starts. Reads the slot list,
 * finds empties among the four core slots (persona / project_context /
 * user_preferences / tool_guidelines), and POSTs replacements built from
 * core/bootstrap.ts.
 */

import { buildBootstrapUpdates } from "../../../core/bootstrap.js";
import { emptySlotLabels, listSlots, observe, replaceSlot } from "../client.js";
import { invalidateSessionContext } from "./system-transform.js";
import { isPhaseDisabled } from "./_shared.js";

const DEBUG = process.env.OH_AM_DEBUG === "1";

export async function onSessionCreated(params: {
  sessionId: string;
  cwd: string | null;
  project: string | null;
}): Promise<void> {
  if (isPhaseDisabled("init")) return;

  // Drop system-transform caches so the new session reloads slot state.
  invalidateSessionContext(params.sessionId);

  let slots;
  try {
    slots = await listSlots();
  } catch (e) {
    if (DEBUG) console.error("[oh-am] slot list failed:", (e as Error).message);
    return;
  }

  const empties: string[] = emptySlotLabels(slots);
  if (empties.length === 0) {
    if (DEBUG) console.error("[oh-am] no empty pinned slots, skipping bootstrap");
    return;
  }

  const cwd = params.cwd ?? params.project ?? process.cwd() ?? "";
  const updates = buildBootstrapUpdates(cwd, empties);
  if (updates.length === 0) {
    if (DEBUG)
      console.error(
        `[oh-am] ${empties.length} empties but no bootstrap template matches (pending_items/guidance/self_notes/session_patterns left for LLM)`,
      );
    return;
  }

  const filled: string[] = [];
  for (const update of updates) {
    const ok = await replaceSlot(update.label, update.content);
    if (ok) filled.push(update.label);
  }

  await observe(
    params.sessionId,
    "oh_am_bootstrap",
    params.project,
    {
      cwd,
      emptySlots: empties,
      filledSlots: filled,
      skippedSlots: updates
        .filter((u) => !filled.includes(u.label))
        .map((u) => u.label),
    },
  );

  if (DEBUG) {
    console.error(
      `[oh-am] bootstrap filled ${filled.length}/${updates.length} slots`,
    );
  }
}
