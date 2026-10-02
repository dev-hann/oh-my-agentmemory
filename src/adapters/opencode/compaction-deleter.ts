/**
 * compaction-deleter — executes drop verdicts via the agentmemory forget API.
 *
 * Runs inside the compaction pipeline right after scoring: every drop-verdict
 * observation that is not guarded and not already deleted is removed in one
 * batch call (audit-logged server-side), the report is annotated with
 * deletedAt stamps, and the session summary is regenerated so it no longer
 * references deleted noise.
 *
 * Safety:
 *   - config compaction.delete=false or env OH_AM_COMPACTION_DELETE=off
 *     disables execution entirely (shadow mode — reports only).
 *   - guarded verdicts (importance >= guard) are never in the drop set.
 *   - Every failure path returns without throwing; verdicts left unmarked
 *     are retried on the next compaction run (idle or GC sweep).
 */

import { forgetObservations, summarizeSession } from "./client.js";
import { writeReport } from "./compaction-runner.js";
import type { CompactionConfig } from "../../core/config-types.js";
import type { CompactionResult, CompactionVerdict } from "../../core/compaction.js";

const DEBUG = process.env.OH_AM_DEBUG === "1";

export function deletionEnabled(cfg: CompactionConfig): boolean {
  if (process.env.OH_AM_COMPACTION_DELETE === "off") return false;
  if (process.env.OH_AM_COMPACTION_DELETE === "on") return true;
  return cfg.delete !== false;
}

function deletableCandidates(result: CompactionResult): CompactionVerdict[] {
  return result.verdicts.filter((v) => !v.kept && !v.deletedAt);
}

/**
 * Delete all pending drop verdicts for a scored session. Mutates `result`
 * (adds deletedAt stamps) and rewrites the report file on success.
 * Returns the number of observations actually deleted.
 */
export async function deleteDroppedObservations(
  result: CompactionResult,
  cfg: CompactionConfig,
): Promise<number> {
  if (!deletionEnabled(cfg)) return 0;

  const candidates = deletableCandidates(result);
  if (candidates.length === 0) return 0;

  const ids = candidates.map((v) => v.id);
  const ok = await forgetObservations(result.sessionId, ids);
  if (!ok) {
    if (DEBUG) {
      console.error(
        `[oh-am] compaction delete failed for ${result.sessionId} (${ids.length} ids) — will retry on next run`,
      );
    }
    return 0;
  }

  const deletedAt = new Date().toISOString();
  for (const v of candidates) v.deletedAt = deletedAt;
  await writeReport(cfg.outputDir ?? "~/.local/share/oh-am/compaction", result);
  await summarizeSession(result.sessionId);

  if (DEBUG) {
    console.error(
      `[oh-am] compaction deleted ${ids.length} observations from ${result.sessionId}`,
    );
  }
  return ids.length;
}
