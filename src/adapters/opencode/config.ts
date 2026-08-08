/**
 * Config loader for oh-my-agentmemory.
 *
 * Reads ~/.config/opencode/oh-am.jsonc (JSONC = JSON with comments),
 * merges with env vars and built-in defaults per the precedence rules
 * documented in README.md.
 *
 *   precedence: env var > config file > built-in default
 *
 * Pure parsing logic lives here; I/O (file read) is mocked-able for tests
 * via the readFile parameter.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  DEFAULT_CONFIG,
  type OhAmConfig,
  type OhAmMode,
  type PhaseId,
  type ResolvedConfig,
} from "../../core/config-types.js";

const VALID_PHASES: readonly PhaseId[] = [
  "enforcement",
  "init",
  "intent",
  "archive",
  "learning",
];

const VALID_MODES: readonly OhAmMode[] = ["auto", "full", "mcp-only"];

/**
 * Strip JSONC comments (// line and /* block *​/) and trailing commas,
 * then JSON.parse. Throws on malformed JSONC.
 */
export function parseJsonc(input: string): unknown {
  // Strategy: walk char-by-char, track string state, drop comments outside strings.
  let out = "";
  let i = 0;
  let inString = false;
  let stringChar = "";
  while (i < input.length) {
    const c = input[i];
    const next = input[i + 1];

    if (inString) {
      out += c;
      if (c === "\\" && next) {
        out += next;
        i += 2;
        continue;
      }
      if (c === stringChar) inString = false;
      i += 1;
      continue;
    }

    if (c === '"' || c === "'") {
      inString = true;
      stringChar = c;
      out += c;
      i += 1;
      continue;
    }

    if (c === "/" && next === "/") {
      // line comment
      while (i < input.length && input[i] !== "\n") i += 1;
      continue;
    }

    if (c === "/" && next === "*") {
      i += 2;
      while (i < input.length && !(input[i] === "*" && input[i + 1] === "/")) {
        i += 1;
      }
      i += 2;
      continue;
    }

    out += c;
    i += 1;
  }
  // Strip trailing commas — naive but works for valid JSONC.
  const trimmed = out.replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(trimmed);
}

export function defaultConfigPath(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg ? path.join(xdg, "opencode") : path.join(os.homedir(), ".config", "opencode");
  return path.join(base, "oh-am.jsonc");
}

/**
 * Validate a raw parsed config object. Throws on structural errors.
 * Returns the same object cast to OhAmConfig for type narrowing.
 */
export function validateConfig(raw: unknown): OhAmConfig {
  if (raw === null || typeof raw !== "object") {
    throw new Error("oh-am.jsonc must be an object");
  }
  const cfg = raw as Record<string, unknown>;
  const errors: string[] = [];

  if (cfg.url !== undefined && typeof cfg.url !== "string") errors.push("url must be a string");
  if (cfg.secret !== undefined && typeof cfg.secret !== "string") errors.push("secret must be a string");
  if (cfg.mode !== undefined && !VALID_MODES.includes(cfg.mode as OhAmMode)) {
    errors.push(`mode must be one of ${VALID_MODES.join("|")}`);
  }
  if (cfg.disabled !== undefined) {
    if (!Array.isArray(cfg.disabled)) {
      errors.push("disabled must be an array");
    } else {
      for (const p of cfg.disabled) {
        if (!VALID_PHASES.includes(p as PhaseId)) {
          errors.push(`disabled entry "${String(p)}" is not a valid phase id`);
        }
      }
    }
  }
  if (cfg.projectMap !== undefined) {
    if (!Array.isArray(cfg.projectMap)) {
      errors.push("projectMap must be an array");
    } else {
      cfg.projectMap.forEach((entry, idx) => {
        if (typeof entry !== "object" || entry === null) {
          errors.push(`projectMap[${idx}] must be an object`);
          return;
        }
        const e = entry as Record<string, unknown>;
        if (typeof e.match !== "string") errors.push(`projectMap[${idx}].match must be a string`);
        if (typeof e.projectId !== "string") errors.push(`projectMap[${idx}].projectId must be a string`);
        if (typeof e.displayName !== "string") errors.push(`projectMap[${idx}].displayName must be a string`);
        if (e.stack !== undefined && !Array.isArray(e.stack)) errors.push(`projectMap[${idx}].stack must be an array`);
      });
    }
  }
  if (cfg.healthCheckOnBoot !== undefined && typeof cfg.healthCheckOnBoot !== "boolean") {
    errors.push("healthCheckOnBoot must be a boolean");
  }
  if (cfg.healthCheckTimeoutMs !== undefined && typeof cfg.healthCheckTimeoutMs !== "number") {
    errors.push("healthCheckTimeoutMs must be a number");
  }
  if (cfg.healthCheckFatal !== undefined && typeof cfg.healthCheckFatal !== "boolean") {
    errors.push("healthCheckFatal must be a boolean");
  }
  if (cfg.debug !== undefined && typeof cfg.debug !== "boolean") {
    errors.push("debug must be a boolean");
  }

  if (errors.length > 0) {
    throw new Error(`invalid oh-am.jsonc:\n  - ${errors.join("\n  - ")}`);
  }
  return cfg as unknown as OhAmConfig;
}

function readConfigFile(filePath: string): OhAmConfig | null {
  try {
    const raw = readFileSync(filePath, "utf8");
    return validateConfig(parseJsonc(raw));
  } catch (e) {
    if (process.env.OH_AM_DEBUG === "1") {
      console.error(`[oh-am] config load failed (${filePath}):`, (e as Error).message);
    }
    return null;
  }
}

/**
 * Merge env vars, config file, and defaults into a single ResolvedConfig.
 * Pure function (file read is injected).
 *
 * Precedence per field:
 *   env var > config file > default
 *
 * For url/secret: AGENTMEMORY_URL / AGENTMEMORY_SECRET env vars win.
 * For mode: OH_AM_MODE env var > config.mode > "auto".
 * For disabled: OH_AM_DISABLE env (comma list) > config.disabled > empty set.
 *   OH_AM_DISABLE takes precedence so users can override without editing
 *   the file for one-shot runs.
 * For debug: OH_AM_DEBUG=1 env > config.debug > false.
 */
export function mergeConfig(
  fileConfig: OhAmConfig | null,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedConfig {
  const sources: Record<string, "env" | "config" | "default"> = {};

  // url
  let url = DEFAULT_CONFIG.url;
  if (env.AGENTMEMORY_URL) {
    url = env.AGENTMEMORY_URL;
    sources.url = "env";
  } else if (fileConfig?.url) {
    url = fileConfig.url;
    sources.url = "config";
  } else {
    sources.url = "default";
  }

  // secret
  let secret = DEFAULT_CONFIG.secret;
  if (env.AGENTMEMORY_SECRET) {
    secret = env.AGENTMEMORY_SECRET;
    sources.secret = "env";
  } else if (fileConfig?.secret) {
    secret = fileConfig.secret;
    sources.secret = "config";
  } else {
    sources.secret = "default";
  }

  // mode
  let mode: OhAmMode = DEFAULT_CONFIG.mode;
  if (env.OH_AM_MODE && VALID_MODES.includes(env.OH_AM_MODE as OhAmMode)) {
    mode = env.OH_AM_MODE as OhAmMode;
    sources.mode = "env";
  } else if (fileConfig?.mode) {
    mode = fileConfig.mode;
    sources.mode = "config";
  } else {
    sources.mode = "default";
  }

  // disabled (env OH_AM_DISABLE wins, then union with config.disabled)
  const disabled = new Set<PhaseId>();
  if (env.OH_AM_DISABLE) {
    for (const part of env.OH_AM_DISABLE.split(/[,\s]+/)) {
      const p = part.trim().toLowerCase() as PhaseId;
      if (VALID_PHASES.includes(p)) disabled.add(p);
    }
    sources.disabled = "env";
  } else if (fileConfig?.disabled && fileConfig.disabled.length > 0) {
    for (const p of fileConfig.disabled) disabled.add(p);
    sources.disabled = "config";
  } else {
    sources.disabled = "default";
  }

  // projectMap (always merged — config prepends over built-ins in bootstrap.ts)
  const projectMap = fileConfig?.projectMap ?? DEFAULT_CONFIG.projectMap;

  // healthCheck
  const healthCheckOnBoot = fileConfig?.healthCheckOnBoot ?? DEFAULT_CONFIG.healthCheckOnBoot;
  const healthCheckTimeoutMs = fileConfig?.healthCheckTimeoutMs ?? DEFAULT_CONFIG.healthCheckTimeoutMs;
  const healthCheckFatal = fileConfig?.healthCheckFatal ?? DEFAULT_CONFIG.healthCheckFatal;

  // debug
  let debug = DEFAULT_CONFIG.debug;
  if (env.OH_AM_DEBUG === "1") {
    debug = true;
    sources.debug = "env";
  } else if (fileConfig?.debug) {
    debug = true;
    sources.debug = "config";
  } else {
    sources.debug = "default";
  }

  return {
    url,
    secret,
    mode,
    disabled,
    projectMap,
    healthCheckOnBoot,
    healthCheckTimeoutMs,
    healthCheckFatal,
    debug,
    sources,
  };
}

let cachedConfig: ResolvedConfig | null = null;

/** Load + cache the resolved config. Reads the file once per process. */
export function loadConfig(filePath: string = defaultConfigPath()): ResolvedConfig {
  if (cachedConfig) return cachedConfig;
  const fileConfig = readConfigFile(filePath);
  cachedConfig = mergeConfig(fileConfig);
  return cachedConfig;
}

/** Test-only: reset cache + inject a fake resolved config. */
export function _setConfigForTests(cfg: ResolvedConfig | null): void {
  cachedConfig = cfg;
}
