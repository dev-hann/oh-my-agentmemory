/**
 * oh-my-agentmemory — OpenCode V2 plugin entry.
 *
 * Registers hooks alongside the existing agentmemory-capture.ts plugin
 * (which keeps doing passive observation). This plugin owns the WRITE side:
 *
 *   enforcement — ctx.session.hook("context")    → per-turn directive push
 *   init        — event: session.created         → bootstrap empty slots
 *   intent      — ctx.session.hook("prompt")     → keyword detection
 *   archive     — event: session.execution.*     → auto-crystallize
 *   learning    — ctx.tool.hook("execute.after") → auto lesson capture (edit/write)
 *   bridge      — ctx.tool.hook("execute.after") → sync todos to actions (todo tool)
 *
 * Plus a boot-time stale session GC (agentmemory-side only): ends sessions
 * untouched for sessionGc.maxAgeDays and reactivates them if a prompt later
 * arrives on an ended session. See hooks/session-gc.ts.
 *
 * Hooks are independently disable-able via OH_AM_DISABLE=intent,learning,bridge etc.
 */

import { Plugin } from "@opencode/plugin";
import { loadConfig } from "./config.js";
import { healthCheck } from "./client.js";
import { resolveMode } from "./mode.js";
import { onChatMessage } from "./hooks/chat-message.js";
import { onFileEdited } from "./hooks/file-edited.js";
import { onSessionCreated } from "./hooks/session-created.js";
import { onSessionEnd } from "./hooks/session-idle.js";
import { onTodowrite, dropSessionState } from "./hooks/todowrite.js";
import { reactivateIfEnded, sweepStaleSessions } from "./hooks/session-gc.js";
import { systemTransformHook } from "./hooks/system-transform.js";
import type { TodoEntry } from "../../core/types.js";

/**
 * Narrow structural type for OpenCode V2 public stream events this plugin
 * reads. The SDK's V2EventEncoded is opaque at the type level; at runtime
 * every event carries `type` plus a `data` payload whose session-bearing
 * field is `sessionID`.
 */
interface OpencodeEvent {
  type?: string;
  data?: { sessionID?: string };
}

export default {
  id: "oh-my-agentmemory",
  async setup(ctx) {
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
          return;
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

    // Stale session GC — one-shot sweep on boot. Ends agentmemory sessions
    // untouched for maxAgeDays (agentmemory-side only; opencode chat sessions
    // are never modified).
    if (cfg.sessionGc.enabled) {
      void sweepStaleSessions(cfg).catch((e) => {
        console.error("[oh-am] session gc failed:", (e as Error).message);
      });
    }

    const project =
      ctx.location.project?.id ?? ctx.location.directory ?? null;

    // ── enforcement: per-turn directive injection ─────────────────────────
    await ctx.session.hook("context", async (event) => {
      await systemTransformHook(event);
    });

    // ── intent: keyword detection on user prompts ─────────────────────────
    // gc: a prompt landing on an ended session (user resumed an old
    // conversation) reactivates its agentmemory record.
    await ctx.session.hook("prompt", async (event) => {
      reactivateIfEnded(event.sessionID, project);
      await onChatMessage({
        sessionId: event.sessionID,
        project,
        text: event.prompt.text,
      });
    });

    // ── learning: auto lesson capture on file edit ────────────────────────
    // ── bridge: todo tool → sync todos to actions ──────────────────────────
    // V2 has no todo.updated event, so the todo bridge also lives on the
    // tool hook now. onTodowrite dedupes by content, so repeated triggers
    // within the same session are safe.
    await ctx.tool.hook("execute.after", async (event) => {
      if (event.status !== "completed") return;
      const tool = (event.tool ?? "").toLowerCase();
      const sessionId = event.sessionID;
      const args = event.input as Record<string, unknown> | undefined;
      if (!sessionId || !args) return;

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

      // — todo tool → action bridge —
      if (tool.includes("todo")) {
        const todosRaw = args.todos;
        if (!Array.isArray(todosRaw)) return;
        const todos = parseTodos(todosRaw);
        if (todos.length === 0) return;
        await onTodowrite({ sessionId, project, todos });
      }
    });

    // ── init / archive: session lifecycle events ──────────────────────────
    // session.created bootstraps slots; session.execution.* end-of-turn
    // signals replace the V1 session.status(idle) archive trigger.
    const controller = new AbortController();
    void (async () => {
      for await (const raw of ctx.event.subscribe({ signal: controller.signal })) {
        const ev = raw as OpencodeEvent;
        if (!ev?.type) continue;

        if (ev.type === "session.created") {
          const sessionId = ev.data?.sessionID;
          if (!sessionId) continue;
          await onSessionCreated({ sessionId, cwd: project, project });
          continue;
        }

        if (
          ev.type === "session.execution.succeeded" ||
          ev.type === "session.execution.failed" ||
          ev.type === "session.execution.interrupted"
        ) {
          const sessionId = ev.data?.sessionID;
          if (!sessionId) continue;
          await onSessionEnd({ sessionID: sessionId, project });
          // Free per-session bridge state when the turn ends. Guards against
          // unbounded sessionState growth in long-running opencode processes.
          dropSessionState(sessionId);
        }
      }
    })().catch((e) => {
      if (cfg.debug) console.error("[oh-am] event stream failed:", (e as Error).message);
    });

    return () => {
      controller.abort();
    };
  },
} satisfies Plugin.Plugin;

// ── Helper types + utilities for tool-input parsing ────────────────────────

interface FileEditedProperties {
  file?: string;
  filePath?: string;
  path?: string;
  diff?: Array<{ additions?: number; deletions?: number; file?: string }>;
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
