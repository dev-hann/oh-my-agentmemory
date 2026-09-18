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

/**
 * Structural slice of the opencode SDK client — just the TUI toast call.
 * Kept local so this hook does not depend on @opencode-ai/sdk types
 * directly (the plugin passes its PluginInput.client through).
 */
interface ToastClient {
  tui: {
    showToast: (data: {
      body?: {
        title?: string;
        message: string;
        variant: "info" | "success" | "warning" | "error";
        duration?: number;
      };
    }) => Promise<unknown>;
  };
}

const endedSessionIds = new Set<string>();

async function showGcToast(client: ToastClient, ended: number): Promise<void> {
  try {
    await client.tui.showToast({
      body: {
        title: "oh-am session GC",
        message: `Ended ${ended} stale session(s)`,
        variant: "info",
        duration: 8000,
      },
    });
  } catch {
    // Headless run or no TUI attached — toast is best-effort.
  }
}

export async function sweepStaleSessions(
  cfg: ResolvedConfig,
  client?: ToastClient,
): Promise<void> {
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

  if (DEBUG) {
    console.error(
      `[oh-am] session-gc: ended ${staleCount} stale session(s) ` +
        `(${sessions.length} total, threshold ${cfg.sessionGc.maxAgeDays}d)`,
    );
  }
  if (staleCount > 0 && client) {
    void showGcToast(client, staleCount);
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
    if (DEBUG) {
      console.error(
        ok
          ? `[oh-am] session-gc: reactivated ended session ${sessionId}`
          : `[oh-am] session-gc: reactivation failed for ${sessionId}`,
      );
    }
  });
}
