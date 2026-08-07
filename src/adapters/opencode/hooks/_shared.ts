/**
 * Shared utilities for adapter hooks.
 *
 * Centralizes config loading + disabled-phase lookup so each hook stays
 * focused on its own logic.
 */

import { loadConfig } from "../config.js";
import { getCachedMode } from "../mode.js";
import type { PhaseId, ResolvedConfig } from "../../../core/config-types.js";

/**
 * Returns true if the given phase is disabled (via env OH_AM_DISABLE
 * or config file `disabled` array).
 */
export function isPhaseDisabled(phase: PhaseId): boolean {
  const cfg = loadConfig();
  return cfg.disabled.has(phase);
}

/**
 * Returns true if the plugin is currently running in mcp-only mode.
 * Synchronous — returns null before resolveMode() has been called.
 */
export function isMcpOnly(): boolean {
  return getCachedMode() === "mcp-only";
}

/** Convenience accessor for the resolved config. */
export function getConfig(): ResolvedConfig {
  return loadConfig();
}
