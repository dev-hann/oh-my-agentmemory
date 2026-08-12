/**
 * oh-my-agentmemory — opencode plugin entry.
 *
 * Registers six hooks alongside the existing agentmemory-capture.ts plugin
 * (which keeps doing passive observation). This plugin owns the WRITE side:
 *
 *   enforcement — experimental.chat.system.transform → per-turn directive push
 *   init        — event: session.created             → bootstrap empty slots
 *   intent      — chat.message                       → keyword detection
 *   archive     — event: session.status(idle)        → auto-crystallize
 *   learning    — event: file.edited                 → auto lesson capture
 *   bridge      — tool.execute.after(todowrite)      → sync todos to actions
 *
 * Hooks are independently disable-able via OH_AM_DISABLE=intent,learning,bridge etc.
 */

import type { Plugin } from "@opencode-ai/plugin";
import { loadConfig } from "./config.js";
import { healthCheck } from "./client.js";
import { resolveMode } from "./mode.js";
import { onChatMessage } from "./hooks/chat-message.js";
import { onFileEdited } from "./hooks/file-edited.js";
import { onSessionCreated } from "./hooks/session-created.js";
import { onSessionStatus } from "./hooks/session-idle.js";
import { onTodowrite } from "./hooks/todowrite.js";
import { dropSessionState } from "./hooks/todowrite.js";
import { systemTransformHook } from "./hooks/system-transform.js";
import type { TodoEntry } from "../../core/types.js";

export const OhMyAgentmemoryPlugin: Plugin = async (ctx) => {
  const cfg = loadConfig();

  if (cfg.debug) {
    console.error(`[oh-am] plugin loaded (mode=${cfg.mode}, url=${cfg.url})`);
  }

  // Health check — non-fatal unless healthCheckFatal is set.
  if (cfg.healthCheckOnBoot) {
    const ok = await healthCheck(cfg.healthCheckTimeoutMs);
    if (!ok) {
      console.error(
        `[oh-am] health check failed — agentmemory server not reachable at ${cfg.url}`,
      );
      if (cfg.healthCheckFatal) {
        console.error("[oh-am] healthCheckFatal=true, plugin self-disabling");
        return {};
      }
    } else if (cfg.debug) {
      console.error("[oh-am] health check ok");
    }
  }

  // Resolve operating mode. async, fire-and-forget — first turn may run
  // before this resolves (treated as "full" by default, switches to mcp-only
  // once probe completes).
  void resolveMode(cfg).catch((e) => {
    if (cfg.debug) console.error("[oh-am] mode resolve failed:", (e as Error).message);
  });

  const project =
    (ctx as { worktree?: string; project?: { id?: string } }).worktree ??
    ctx.project?.id ??
    process.cwd() ??
    null;

  return {
    // ── enforcement: per-turn directive injection ─────────────────────────
    "experimental.chat.system.transform": systemTransformHook,

    // ── intent: keyword detection on user prompts ─────────────────────────
    "chat.message": async (input, output) => {
      await onChatMessage(
        input as { sessionID?: string; sessionId?: string; project?: string | null },
        output as { parts?: Array<{ type: string; text?: string }> },
      );
    },

    // ── learning: auto lesson capture on file edit ────────────────────────
    // Primary path is tool.execute.after (fires reliably). The legacy
    // event:file.edited handler below is kept as a backup in case opencode
    // emits those events in some configurations.
    "tool.execute.after": async (input) => {
      const tool = ((input as { tool?: string }).tool ?? "").toLowerCase();
      const sessionId = (input as { sessionID?: string }).sessionID;
      if (!sessionId) return;
      const args = (input as { args?: Record<string, unknown> }).args;
      if (!args) return;

      // — file edit/ write → lesson auto-capture —
      if (tool === "edit" || tool === "write") {
        const filePath = pickFilePath(args as FileEditedProperties);
        if (!filePath) return;

        let additions = 0;
        let deletions = 0;
        const ns = args.newString;
        const os = args.oldString;
        if (typeof ns === "string" && typeof os === "string") {
          additions = ns.split("\n").length;
          deletions = os.split("\n").length;
        } else if (typeof args.content === "string") {
          additions = args.content.split("\n").length;
        }

        await onFileEdited({
          sessionId,
          project,
          filePath,
          additions,
          deletions,
        });
        return;
      }

      // NOTE: todowrite is handled via the dedicated `todo.updated` event
      // in the event handler below. Subscribing here too causes a race
      // condition where both fire simultaneously and bypass the per-session
      // dedup map, producing duplicate actions.
    },

    // ── init / archive / learning: session + file lifecycle events ────────
    event: async ({ event }: { event?: OpencodeEvent } = {}) => {
      if (!event) return;
      const type = event.type;
      const props = (event.properties ?? {}) as Record<string, unknown>;

      if (type === "session.created") {
        const p = props as unknown as SessionCreatedProperties;
        const sessionId = pickSessionId(
          p.info?.id,
          p.sessionID,
          (props as { sessionID?: string }).sessionID,
        );
        if (!sessionId) return;
        await onSessionCreated({ sessionId, cwd: project, project });
        return;
      }

      if (type === "session.status") {
        const p = props as unknown as SessionStatusProperties;
        await onSessionStatus({
          sessionID: p.sessionID,
          sessionId: p.sessionId,
          status: p.status,
          project,
        });
        // Free per-session bridge state when the session goes idle.
        // Guards against unbounded sessionState growth in long-running
        // opencode processes.
        const statusType = p.status?.type;
        const sid = p.sessionID ?? p.sessionId ?? null;
        if ((statusType === "idle" || statusType === "completed") && sid) {
          dropSessionState(sid);
        }
        return;
      }

      if (type === "file.edited") {
        const p = props as unknown as FileEditedProperties;
        const sessionId = pickSessionId(
          p.sessionID,
          p.sessionId,
          (props as { sessionID?: string }).sessionID,
        );
        if (!sessionId) return;
        const filePath = pickFilePath(p);
        if (!filePath) return;

        let additions = p.additions ?? 0;
        let deletions = p.deletions ?? 0;
        if (Array.isArray(p.diff)) {
          for (const d of p.diff) {
            additions += d.additions ?? 0;
            deletions += d.deletions ?? 0;
          }
        }

        await onFileEdited({
          sessionId,
          project,
          filePath,
          additions,
          deletions,
        });
        return;
      }

      // ── bridge: todo.updated event (opencode-native todo signal) ────────
      // Belt-and-suspenders alongside the tool.execute.after(todowrite)
      // handler above. Whichever fires first wins; onTodowrite dedupes by
      // content so duplicate triggers within the same session are safe.
      if (type === "todo.updated") {
        const p = props as unknown as TodoUpdatedProperties;
        const sessionId = pickSessionId(
          p.sessionID,
          p.sessionId,
          (props as { sessionID?: string }).sessionID,
        );
        if (!sessionId) return;
        const todosRaw = (p.todos ?? p.list ?? []) as unknown;
        if (!Array.isArray(todosRaw)) return;
        const todos = parseTodos(todosRaw);
        if (todos.length === 0) return;
        await onTodowrite({ sessionId, project, todos });
        return;
      }
    },
  };
};

export default OhMyAgentmemoryPlugin;

// ── Helper types + utilities for event parsing ──────────────────────────────

interface OpencodeEvent {
  type: string;
  properties?: Record<string, unknown>;
}

interface SessionCreatedProperties {
  info?: { id?: string; title?: string };
  sessionID?: string;
}

interface TodoUpdatedProperties {
  sessionID?: string;
  sessionId?: string;
  /** Optional list of todos carried by the event. */
  todos?: unknown;
  /** Alternative field name some opencode builds use. */
  list?: unknown;
}

interface FileEditedProperties {
  sessionID?: string;
  sessionId?: string;
  file?: string;
  filePath?: string;
  path?: string;
  additions?: number;
  deletions?: number;
  diff?: Array<{ additions?: number; deletions?: number; file?: string }>;
}

interface SessionStatusProperties {
  sessionID?: string;
  sessionId?: string;
  status?: { type?: string; attempt?: number; message?: string };
}

function pickFilePath(props: FileEditedProperties): string | null {
  if (typeof props.file === "string") return props.file;
  if (typeof props.filePath === "string") return props.filePath;
  if (typeof props.path === "string") return props.path;
  if (Array.isArray(props.diff) && props.diff.length > 0) {
    const first = props.diff[0];
    if (first && typeof first.file === "string") return first.file;
  }
  return null;
}

function pickSessionId(...candidates: Array<unknown>): string | null {
  for (const c of candidates) {
    if (typeof c === "string" && c.length > 0) return c;
  }
  return null;
}

/**
 * Parse raw todowrite args.todos array into typed TodoEntry[].
 * Tolerates missing fields by defaulting to pending/medium.
 */
function parseTodos(raw: unknown[]): TodoEntry[] {
  return raw
    .map((entry): TodoEntry | null => {
      if (typeof entry !== "object" || entry === null) return null;
      const e = entry as Record<string, unknown>;
      const content = typeof e.content === "string" ? e.content : "";
      if (content.length === 0) return null;
      const status = (
        typeof e.status === "string" ? e.status : "pending"
      ) as TodoEntry["status"];
      const priority = (
        typeof e.priority === "string" ? e.priority : "medium"
      ) as TodoEntry["priority"];
      return {
        content,
        status: TODO_STATUS_SET.has(status) ? status : "pending",
        priority: TODO_PRIORITY_SET.has(priority) ? priority : "medium",
      };
    })
    .filter((t): t is TodoEntry => t !== null);
}

const TODO_STATUS_SET = new Set<TodoEntry["status"]>([
  "pending",
  "in_progress",
  "completed",
  "cancelled",
]);
const TODO_PRIORITY_SET = new Set<TodoEntry["priority"]>([
  "high",
  "medium",
  "low",
]);
