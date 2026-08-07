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
  | "learning";

export interface ProjectMapEntry {
  /** RegExp source string — matched against cwd. */
  match: string;
  projectId: string;
  displayName: string;
  stack?: string[];
}

export interface PolicyRuleOverride {
  id: string;
  text: string;
}

export interface PolicyOverride {
  /** Override the directive header. null = drop entirely. */
  header?: string | null;
  /** Override the directive footer. null = drop entirely. */
  footer?: string | null;
  /** Replace recall rules. Empty array = drop the section. */
  recall?: PolicyRuleOverride[];
  /** Replace write rules. Empty array = drop the section. */
  write?: PolicyRuleOverride[];
  /** Replace crystal rules. Empty array = drop the section. */
  crystal?: PolicyRuleOverride[];
}

export interface McpOnlyOptions {
  /** Push a stronger directive when running in mcp-only mode (default true). */
  strengthenDirective?: boolean;
  /**
   * When intent hook matches "remember"/"save" keywords, call memory_save
   * directly instead of queueing for the directive. Default false (LLM stays
   * the writer; matches full-mode behavior).
   */
  autoSaveOnKeyword?: boolean;
}

export interface ProfileEntry {
  url?: string;
  secret?: string;
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

  /** MCP-only mode sub-options. */
  mcpOnly?: McpOnlyOptions;

  /** Named connection profiles for quick switching. */
  profiles?: Record<string, ProfileEntry>;
  /** Profile name to use; merged into url/secret. */
  activeProfile?: string;

  /** Extend or replace the built-in project map. */
  projectMap?: ProjectMapEntry[];
  /** "merge" (default, prepends before built-ins) or "replace". */
  projectMapMode?: "merge" | "replace";

  /** Override built-in directive policy text. */
  policy?: PolicyOverride;

  /** Ping agentmemory server on plugin init. Default true. */
  healthCheckOnBoot?: boolean;
  /** Health check timeout in ms. Default 2000. */
  healthCheckTimeoutMs?: number;
  /** If true, plugin self-disables when health check fails. Default false. */
  healthCheckFatal?: boolean;

  /** Verbose stderr logging. Env OH_AM_DEBUG=1 takes precedence. */
  debug?: boolean;
}

/** Resolved config after env+file+default merge. All fields defined. */
export interface ResolvedConfig {
  url: string;
  secret: string;
  mode: OhAmMode;
  disabled: Set<PhaseId>;
  mcpOnly: Required<McpOnlyOptions>;
  profiles: Record<string, ProfileEntry>;
  activeProfile: string | null;
  projectMap: ProjectMapEntry[];
  projectMapMode: "merge" | "replace";
  policy: PolicyOverride;
  healthCheckOnBoot: boolean;
  healthCheckTimeoutMs: number;
  healthCheckFatal: boolean;
  debug: boolean;
  /** Where each top-level field came from, for debug logging. */
  sources: Record<string, "env" | "config" | "default">;
}

export const DEFAULT_CONFIG: ResolvedConfig = {
  url: "http://localhost:3111",
  secret: "",
  mode: "auto",
  disabled: new Set<PhaseId>(),
  mcpOnly: {
    strengthenDirective: true,
    autoSaveOnKeyword: false,
  },
  profiles: {},
  activeProfile: null,
  projectMap: [],
  projectMapMode: "merge",
  policy: {},
  healthCheckOnBoot: true,
  healthCheckTimeoutMs: 2000,
  healthCheckFatal: false,
  debug: false,
  sources: {},
};
