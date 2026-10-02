/**
 * Config types — shape of the JSONC file at ~/.config/opencode/oh-am.jsonc
 *
 * Agent-agnostic. Adapters parse this shape via loadConfig() in
 * adapters/opencode/config.ts.
 */

export type OhAmMode = "auto" | "full" | "mcp-only";

export type PhaseId =
  | "enforcement"
  | "init"
  | "intent"
  | "archive"
  | "learning"
  | "bridge";

export interface ProjectMapEntry {
  /** RegExp source string — matched against cwd. */
  match: string;
  projectId: string;
  displayName: string;
  stack?: string[];
}

export interface SessionGcConfig {
  /** End stale active sessions in agentmemory on boot. Default false. */
  enabled?: boolean;
  /** An active session with no updates older than this is stale. Default 7. */
  maxAgeDays?: number;
}

export interface CompactionConfig {
  /** Score observations with a local jevos decision model on session idle. Default false. */
  enabled?: boolean;
  /** jevos /v1/systemone endpoint. */
  baseUrl?: string;
  /** Minimum keep_call noul probability to keep an observation. Default 0.35. */
  keepThreshold?: number;
  /** Observations with importance >= this are always kept. Default 2. */
  importanceGuard?: number;
  /** Per-request jevos timeout in ms. Default 15000. */
  timeoutMs?: number;
  /** Max observations scored per session. Default 500. */
  maxObservations?: number;
  /** Directory for compaction reports. `~` expanded at runtime. */
  outputDir?: string;
}

export interface OhAmConfig {
  /** agentmemory server URL. Env AGENTMEMORY_URL takes precedence. */
  url?: string;
  /** Bearer token. Env AGENTMEMORY_SECRET takes precedence. */
  secret?: string;

  /** Plugin operating mode (default "auto"). */
  mode?: OhAmMode;

  /** Hook purpose names to disable. Replaces OH_AM_DISABLE env. */
  disabled?: PhaseId[];

  /** Extend built-in project map (always merged — prepends before built-ins). */
  projectMap?: ProjectMapEntry[];

  /** Ping agentmemory server on plugin init. Default true. */
  healthCheckOnBoot?: boolean;
  /** Health check timeout in ms. Default 2000. */
  healthCheckTimeoutMs?: number;
  /** If true, plugin self-disables when health check fails. Default false. */
  healthCheckFatal?: boolean;

  /** Stale session GC (agentmemory-side only). */
  sessionGc?: SessionGcConfig;

  /** Observation compaction via local jevos decision model. */
  compaction?: CompactionConfig;

  /** Verbose stderr logging. Env OH_AM_DEBUG=1 takes precedence. */
  debug?: boolean;
}

/** Resolved config after env+file+default merge. All fields defined. */
export interface ResolvedConfig {
  url: string;
  secret: string;
  mode: OhAmMode;
  disabled: Set<PhaseId>;
  projectMap: ProjectMapEntry[];
  healthCheckOnBoot: boolean;
  healthCheckTimeoutMs: number;
  healthCheckFatal: boolean;
  sessionGc: { enabled: boolean; maxAgeDays: number };
  compaction: {
    enabled: boolean;
    baseUrl: string;
    keepThreshold: number;
    importanceGuard: number;
    timeoutMs: number;
    maxObservations: number;
    outputDir: string;
  };
  debug: boolean;
  /** Where each top-level field came from, for debug logging. */
  sources: Record<string, "env" | "config" | "default">;
}

export const DEFAULT_CONFIG: ResolvedConfig = {
  url: "http://localhost:3111",
  secret: "",
  mode: "auto",
  disabled: new Set<PhaseId>(),
  projectMap: [],
  healthCheckOnBoot: true,
  healthCheckTimeoutMs: 2000,
  healthCheckFatal: false,
  sessionGc: { enabled: false, maxAgeDays: 7 },
  compaction: {
    enabled: false,
    baseUrl: "http://127.0.0.1:8017",
    keepThreshold: 0.35,
    importanceGuard: 2,
    timeoutMs: 15000,
    maxObservations: 500,
    outputDir: "~/.local/share/oh-am/compaction",
  },
  debug: false,
  sources: {},
};
