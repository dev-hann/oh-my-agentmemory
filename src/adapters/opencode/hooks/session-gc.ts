/**
 * gc — stale session sweep + reactivation guard.
 *
 * On plugin boot, list agentmemory sessions and end every session that has
 * sat `active` with no updates for longer than sessionGc.maxAgeDays. This
 * is agentmemory-side bookkeeping only — the opencode chat session on disk
 * is never touched. Closing the record lets the summarize/crystallize/
 * consolidate pipelines treat it as terminated instead of accumulating
 * raw observations forever.
 *
 * Reactivation guard: session ids that are (or become) ended are kept in a
 * set. If a prompt later arrives for one of them — the user resumed an old
 * opencode conversation — POST /session/start flips it back to active so
 * new observations attach to a live record.
 */

import { endSession, listSessions, restartSession } from "../client.js";
import type { ResolvedConfig } from "../../../core/config-types.js";

const DEBUG = process.env.OH_AM_DEBUG === "1";

const endedSessionIds = new Set<string>();

export async function sweepStaleSessions(cfg: ResolvedConfig): Promise<void> {
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
        } else if (DEBUG) {
          console.error(`[oh-am] session-gc: end failed for ${s.id}`);
        }
      }
    } else {
      endedSessionIds.add(s.id);
    }
  }

  if (staleCount > 0 || DEBUG) {
    console.error(
      `[oh-am] session-gc: ended ${staleCount} stale session(s) ` +
        `(${sessions.length} total, threshold ${cfg.sessionGc.maxAgeDays}d)`,
    );
  }
}

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
  void restartSession(sessionId, project).then((ok) => {
    if (ok) {
      console.error(`[oh-am] session-gc: reactivated ended session ${sessionId}`);
    } else if (DEBUG) {
      console.error(`[oh-am] session-gc: reactivation failed for ${sessionId}`);
    }
  });
}
