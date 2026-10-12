/**
 * Core GC — shared by the opencode boot sweep and the jcode session hook.
 *
 * What it does (each step fails independently):
 *   1. End stale `active` sessions (no updates for sessionGc.maxAgeDays)
 *      with compaction catch-up for sessions the idle hook missed.
 *   2. Cancel zombie actions: `active` for longer than maxAgeDays — these
 *      are finished-but-never-closed work items. Marked `cancelled` (not
 *      `done`: completion is unknowable and marking done would pollute
 *      crystal quality) with an explanatory result.
 *   3. Backfill missing project scopes on memories via the server's
 *      /migrate endpoint (one-shot; safe to re-run).
 *
 * Throttle: callers use maybeRunGc(), which checks the shared marker file
 * (~/.config/oh-am/gc-last-run) and runs at most once per 24h across both
 * adapters. The marker is written BEFORE running (claim-then-run) so a
 * crash mid-GC retries the next day rather than hammering on every boot.
 *
 * Server route notes:
 *   - POST /migrate {"step": "infer-memory-projects"} — suggested by
 *     memory_diagnose output when project coverage is low.
 *   - "active but no lease" actions are found by filtering active actions
 *     on age; a leased action refreshes its updatedAt, so age alone is an
 *     adequate proxy for "no live lease".
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { ResolvedConfig } from "./config-types.js";

const DEBUG = process.env.OH_AM_DEBUG === "1";

export const GC_MARKER_PATH = path.join(
  os.homedir(),
  ".config",
  "oh-am",
  "gc-last-run",
);

const THROTTLE_MS = 24 * 60 * 60 * 1000;

export interface GcReport {
  sessionsEnded: number;
  actionsCancelled: number;
  projectBackfilled: boolean;
  skipped?: "throttled";
}

/** True when the last GC run is older than the throttle window (or absent). */
export function shouldRunGc(now = Date.now()): boolean {
  try {
    const last = parseInt(fs.readFileSync(GC_MARKER_PATH, "utf8"), 10);
    return !Number.isFinite(last) || now - last > THROTTLE_MS;
  } catch {
    return true;
  }
}

function markGcRun(now = Date.now()): void {
  fs.mkdirSync(path.dirname(GC_MARKER_PATH), { recursive: true });
  fs.writeFileSync(GC_MARKER_PATH, String(now));
}

function log(msg: string): void {
  if (DEBUG) console.error(`[oh-am] gc: ${msg}`);
}

/**
 * Run the full GC sweep. Never throws — each stage is independently
 * guarded and failures are logged via OH_AM_DEBUG.
 */
export async function runGc(
  cfg: ResolvedConfig,
  fns: {
    endStaleSessions: (cfg: ResolvedConfig) => Promise<number>;
    cancelZombieActions: (cfg: ResolvedConfig) => Promise<number>;
    backfillMemoryProjects: () => Promise<boolean>;
  },
): Promise<GcReport> {
  const report: GcReport = {
    sessionsEnded: 0,
    actionsCancelled: 0,
    projectBackfilled: false,
  };

  try {
    report.sessionsEnded = await fns.endStaleSessions(cfg);
  } catch (e) {
    log(`stale-session sweep failed: ${(e as Error).message}`);
  }
  try {
    report.actionsCancelled = await fns.cancelZombieActions(cfg);
  } catch (e) {
    log(`zombie-action sweep failed: ${(e as Error).message}`);
  }
  try {
    report.projectBackfilled = await fns.backfillMemoryProjects();
  } catch (e) {
    log(`project backfill failed: ${(e as Error).message}`);
  }

  log(
    `${report.sessionsEnded} sessions ended, ` +
      `${report.actionsCancelled} zombie actions cancelled, ` +
      `project backfill=${report.projectBackfilled}`,
  );
  return report;
}

/**
 * Throttled entry point for adapters: runs the sweep at most once per 24h
 * across both adapters (shared marker file). Always resolves; never throws.
 */
export async function maybeRunGc(
  cfg: ResolvedConfig,
  fns: {
    endStaleSessions: (cfg: ResolvedConfig) => Promise<number>;
    cancelZombieActions: (cfg: ResolvedConfig) => Promise<number>;
    backfillMemoryProjects: () => Promise<boolean>;
  },
): Promise<GcReport | null> {
  if (!shouldRunGc()) {
    log("skipped (ran within the last 24h)");
    return { sessionsEnded: 0, actionsCancelled: 0, projectBackfilled: false, skipped: "throttled" };
  }
  // Claim first: concurrent adapters won't double-run, and a failed run
  // retries tomorrow instead of on every boot.
  markGcRun();
  return runGc(cfg, fns);
}
