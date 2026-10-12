/**
 * Adapter GC — wires core/gc.ts to the opencode client endpoints.
 *
 * Both adapters call the exported runGc/maybeRunGc variants here:
 *   - opencode: plugin boot sweep (was: inline sweepStaleSessions logic)
 *   - jcode:    session_start hook, fire-and-forget after bootstrap
 *
 * The 24h throttle lives in core (shared marker file) so running one
 * adapter suppresses the other's sweep for the same day.
 */

import {
  endSession,
  listActions,
  listSessions,
  migrateStep,
  restartSession,
  updateAction,
} from "../client.js";
import { runSessionCompaction, reportExists } from "../compaction-runner.js";
import type { ResolvedConfig } from "../../../core/config-types.js";
import { shouldRunGc } from "../../../core/gc.js";

export { shouldRunGc };

const DEBUG = process.env.OH_AM_DEBUG === "1";

const endedSessionIds = new Set<string>();

/**
 * Fire-and-forget guard for chat.message. Restart the agentmemory record
 * when a prompt lands on a session this process knows to be ended.
 */
export function reactivateIfEnded(
  sessionId: string,
  project: string | null,
): void {
  if (!endedSessionIds.has(sessionId)) return;
  endedSessionIds.delete(sessionId);
  void restartSession(sessionId, project).then((ok: boolean) => {
    if (DEBUG) {
      console.error(
        ok
          ? `[oh-am] session-gc: reactivated ended session ${sessionId}`
          : `[oh-am] session-gc: reactivation failed for ${sessionId}`,
      );
    }
  });
}

/** Existing sweep: end `active` sessions untouched for maxAgeDays. */
async function endStaleSessions(cfg: ResolvedConfig): Promise<number> {
  const maxAgeMs = cfg.sessionGc.maxAgeDays * 24 * 60 * 60 * 1000;
  const sessions = await listSessions(1000);
  const now = Date.now();

  let staleCount = 0;
  for (const s of sessions) {
    if (!s.id) continue;
    if (s.status === "active") {
      const updated = s.updatedAt ? Date.parse(s.updatedAt) : NaN;
      if (Number.isFinite(updated) && now - updated > maxAgeMs) {
        staleCount++;
        if (await endSession(s.id)) {
          endedSessionIds.add(s.id);
          // Compaction catch-up: sessions the idle hook missed (crashed or
          // abandoned) get scored + cleaned here. Skips sessions that
          // already have a report so a sweep never re-scores the world.
          if (cfg.compaction.enabled) {
            try {
              if (!(await reportExists(cfg.compaction.outputDir, s.id))) {
                await runSessionCompaction(s.id, null);
              }
            } catch (e) {
              if (DEBUG) {
                console.error(
                  `[oh-am] session-gc: compaction failed for ${s.id}:`,
                  (e as Error).message,
                );
              }
            }
          }
        } else if (DEBUG) {
          console.error(`[oh-am] session-gc: end failed for ${s.id}`);
        }
      }
    } else {
      endedSessionIds.add(s.id);
    }
  }

  if (DEBUG) {
    console.error(
      `[oh-am] session-gc: ended ${staleCount} stale session(s) ` +
        `(${sessions.length} total, threshold ${cfg.sessionGc.maxAgeDays}d)`,
    );
  }
  return staleCount;
}

/**
 * Cancel `active` actions untouched for maxAgeDays. A live lease refreshes
 * updatedAt, so age alone selects the same set diagnose reports as
 * "active but no lease". Cancelled (not done): completion is unknowable.
 */
async function cancelZombieActions(cfg: ResolvedConfig): Promise<number> {
  const maxAgeMs = cfg.sessionGc.maxAgeDays * 24 * 60 * 60 * 1000;
  const actions = await listActions({ status: "active", limit: 500 });
  const now = Date.now();

  let cancelled = 0;
  for (const a of actions) {
    const updated = Date.parse(a.updatedAt ?? a.createdAt ?? "");
    if (!(Number.isFinite(updated) && now - updated > maxAgeMs)) continue;
    const ok = await updateAction(a.id, {
      status: "cancelled",
      result: `oh-am gc: stale active (no update for ${cfg.sessionGc.maxAgeDays}d), auto-cancelled`,
    });
    if (ok) cancelled++;
    else if (DEBUG) console.error(`[oh-am] gc: cancel failed for ${a.id}`);
  }

  if (DEBUG) {
    console.error(
      `[oh-am] gc: cancelled ${cancelled}/${actions.length} zombie action(s)`,
    );
  }
  return cancelled;
}

/** One-shot server migration: infer project scopes for unscoped memories. */
async function backfillMemoryProjects(): Promise<boolean> {
  return migrateStep("infer-memory-projects");
}

export const gcFns = {
  endStaleSessions,
  cancelZombieActions,
  backfillMemoryProjects,
};

/**
 * Throttled sweep — at most once per 24h across both adapters.
 * opencode calls this on boot; jcode calls it fire-and-forget on
 * session_start.
 */
export async function maybeRunGcAdapter(cfg: ResolvedConfig): Promise<void> {
  const { maybeRunGc } = await import("../../../core/gc.js");
  await maybeRunGc(cfg, gcFns);
}

/** Unthrottled — for manual/one-shot runs. */
export async function runGcAdapter(cfg: ResolvedConfig): Promise<void> {
  const { runGc } = await import("../../../core/gc.js");
  await runGc(cfg, gcFns);
}

/** Back-compat alias for the old plugin.ts boot call. */
export async function sweepStaleSessions(cfg: ResolvedConfig): Promise<void> {
  return maybeRunGcAdapter(cfg);
}
