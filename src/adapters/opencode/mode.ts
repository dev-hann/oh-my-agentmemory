/**
 * Mode detection — determine whether the plugin is running in
 * "full" mode (agentmemory-capture.ts loaded alongside) or "mcp-only".
 *
 * Cascade:
 *   1. config.mode === "full" | "mcp-only" → use as-is
 *   2. config.mode === "auto" → probe agentmemory server:
 *      a. Query recent sessions; if recent observation count > 0 → "full"
 *      b. Otherwise → "mcp-only"
 *   3. Probe runs once per process; result cached.
 *
 * The probe is heuristic, not authoritative. Capture.ts can be loaded
 * but not yet have written anything for this session — the probe looks
 * at the *global* observation volume to decide.
 */

import type { OhAmMode, ResolvedConfig } from "../../core/config-types.js";
import { getRecentSessions } from "./client.js";

const DEBUG = process.env.OH_AM_DEBUG === "1";

const AUTO_PROBE_SESSION_LIMIT = 10;
const AUTO_PROBE_OBSERVATION_THRESHOLD = 5;

let cachedResolvedMode: OhAmMode | null = null;

interface SessionRow {
  observationCount?: number;
}

/**
 * Probe the agentmemory server for evidence of capture.ts activity.
 * Returns true if it looks like capture.ts is loaded somewhere.
 */
async function probeCaptureActive(): Promise<boolean> {
  try {
    const sessions = await getRecentSessions(AUTO_PROBE_SESSION_LIMIT);
    if (!Array.isArray(sessions) || sessions.length === 0) {
      if (DEBUG) console.error("[oh-am] probe: no sessions → mcp-only");
      return false;
    }
    const totalObs = sessions.reduce(
      (sum, s: SessionRow) => sum + (typeof s.observationCount === "number" ? s.observationCount : 0),
      0,
    );
    const avg = totalObs / sessions.length;
    if (DEBUG) {
      console.error(
        `[oh-am] probe: ${sessions.length} sessions, avg ${avg.toFixed(1)} obs/session`,
      );
    }
    // If average observation count is below threshold, capture.ts is unlikely
    // to be the source — LLM-driven memory_save alone wouldn't produce that
    // volume consistently.
    return avg >= AUTO_PROBE_OBSERVATION_THRESHOLD;
  } catch (e) {
    if (DEBUG) console.error("[oh-am] probe failed, assuming full:", (e as Error).message);
    return true;
  }
}

export async function resolveMode(config: ResolvedConfig): Promise<OhAmMode> {
  if (cachedResolvedMode) return cachedResolvedMode;

  let mode: OhAmMode;
  if (config.mode === "auto") {
    const captureActive = await probeCaptureActive();
    mode = captureActive ? "full" : "mcp-only";
  } else {
    mode = config.mode;
  }

  cachedResolvedMode = mode;
  if (DEBUG) console.error(`[oh-am] resolved mode: ${mode}`);
  return mode;
}

/** Synchronous accessor for cached mode. Returns null if not yet resolved. */
export function getCachedMode(): OhAmMode | null {
  return cachedResolvedMode;
}

/** Test-only: reset cache + force a mode. */
export function _setModeForTests(mode: OhAmMode | null): void {
  cachedResolvedMode = mode;
}

export const INTERNAL = {
  AUTO_PROBE_OBSERVATION_THRESHOLD,
  AUTO_PROBE_SESSION_LIMIT,
};
