/**
 * Config loader for the jcode adapter.
 *
 * Reads ~/.jcode/oh-am.jsonc first, falling back to the opencode location
 * (~/.config/opencode/oh-am.jsonc) so an existing opencode install works
 * without duplicating settings. Reuses the opencode adapter's parsing and
 * validation wholesale.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  defaultConfigPath as opencodeDefaultConfigPath,
  loadConfig as loadOpencodeConfig,
  type ResolvedConfig,
} from "../opencode/config.js";

export function jcodeConfigPath(): string {
  return path.join(os.homedir(), ".jcode", "oh-am.jsonc");
}

export function defaultConfigPath(): string {
  return jcodeConfigPath();
}

/**
 * Load config with jcode-first precedence:
 *   ~/.jcode/oh-am.jsonc  >  ~/.config/opencode/oh-am.jsonc  >  defaults
 */
export function loadConfig(): ResolvedConfig {
  if (existsSync(jcodeConfigPath())) {
    return loadOpencodeConfig(jcodeConfigPath());
  }
  return loadOpencodeConfig(opencodeDefaultConfigPath());
}
