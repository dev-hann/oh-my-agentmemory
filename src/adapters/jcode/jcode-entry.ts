/**
 * oh-my-agentmemory — jcode adapter entry.
 *
 * A single Bun script registered under multiple jcode lifecycle hooks
 * (each hook key accepts a string or an array; see jcode docs/HOOKS.md).
 * The event arrives via JCODE_HOOK_EVENT; routing happens here so all
 * phases share one process image and one config load.
 *
 *   session_start → init        (bootstrap empty pinned slots)
 *   post_tool     → learning    (lesson capture from touched files)
 *                   + bridge    (todo tool writes → agentmemory actions)
 *   turn_end      → archive     (crystallize when enough done actions)
 *   session_end   → cleanup     (drop per-session bridge state)
 *
 * jcode contract (docs/HOOKS.md):
 *   JCODE_HOOK_EVENT, JCODE_HOOK_SESSION_ID, JCODE_HOOK_CWD,
 *   JCODE_HOOK_PAYLOAD (JSON mirror), JCODE_HOOK_TOOL_NAME,
 *   JCODE_HOOK_TOUCHED_PATHS (newline-separated), JCODE_HOOKS_DISABLED=1.
 *
 * Observers are fire-and-forget: failures are logged, never fatal.
 * Enable diagnostics with OH_AM_DEBUG=1.
 *
 * Usage (installed by scripts/install-jcode.sh):
 *   bun ~/.jcode/plugins/oh-am/jcode-entry.ts
 */

import { loadConfig } from "./config.js";
import { healthCheck } from "../opencode/client.js";
import { onSessionCreated } from "../opencode/hooks/session-created.js";
import { onFileEdited } from "../opencode/hooks/file-edited.js";
import { onTodowrite, dropSessionState } from "../opencode/hooks/todowrite.js";
import type { TodoEntry } from "../../core/types.js";
import { onSessionEnd } from "../opencode/hooks/session-idle.js";

const DEBUG = process.env.OH_AM_DEBUG === "1";

interface ToolInput {
  file_path?: string;
  path?: string;
  oldString?: string;
  newString?: string;
  content?: string;
  todos?: Array<{
    content?: string;
    status?: string;
    priority?: string | number;
  }>;
}

function log(msg: string): void {
  if (DEBUG) console.error(`[oh-am] ${msg}`);
}

function touchedPaths(): string[] {
  return (process.env.JCODE_HOOK_TOUCHED_PATHS ?? "")
    .split("\n")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

async function readStdinJson(): Promise<ToolInput | null> {
  // Only post_tool/feedback hooks receive stdin. Read defensively: empty or
  // invalid stdin must never crash an observer.
  try {
    const raw = await readAllStdin();
    if (!raw.trim()) return null;
    return JSON.parse(raw) as ToolInput;
  } catch {
    return null;
  }
}

async function readAllStdin(): Promise<string> {
  // Bun global is not typed in this repo (tsconfig types: ["node"]); access
  // it defensively so tsc stays clean and non-Bun runtimes degrade to empty.
  const b = (globalThis as Record<string, unknown>).Bun as
    | { stdin: { stream(): unknown } }
    | undefined;
  if (!b) return "";
  try {
    return await new Response(b.stdin.stream() as ReadableStream).text();
  } catch {
    return "";
  }
}

/** Map jcode todo-tool priority (number or string) onto oh-am's high/medium/low. */
function normalizePriority(priority: string | number | undefined): TodoEntry["priority"] {
  if (typeof priority === "number") {
    if (priority >= 8) return "high";
    if (priority >= 5) return "medium";
    return "low";
  }
  switch ((priority ?? "").toLowerCase()) {
    case "high":
    case "8":
    case "9":
    case "10":
      return "high";
    case "low":
    case "1":
    case "2":
    case "3":
      return "low";
    default:
      return "medium";
  }
}

function normalizeStatus(status: string | undefined): TodoEntry["status"] {
  switch ((status ?? "").toLowerCase()) {
    case "in_progress":
    case "in-progress":
    case "active":
      return "in_progress";
    case "completed":
    case "done":
      return "completed";
    case "cancelled":
    case "canceled":
      return "cancelled";
    default:
      return "pending";
  }
}

async function handlePostTool(sessionId: string, cwd: string): Promise<void> {
  const tool = (process.env.JCODE_HOOK_TOOL_NAME ?? "").toLowerCase();
  const project = cwd;

  // bridge: jcode's todo tool input carries the todo list.
  if (tool.includes("todo")) {
    const input = await readStdinJson();
    const todos = input?.todos;
    if (Array.isArray(todos) && todos.length > 0) {
      await onTodowrite({
        sessionId,
        project,
        todos: todos.map((t) => ({
          content: t.content ?? "",
          status: normalizeStatus(t.status),
          priority: normalizePriority(t.priority),
        })),
      });
    }
    return;
  }

  // learning: file writes/edits with meaningful size.
  if (tool === "write" || tool === "edit" || tool === "apply_patch" || tool === "multiedit") {
    const input = await readStdinJson();
    const paths = touchedPaths();
    if (paths.length === 0) return;
    const additions =
      (input?.newString ?? input?.content ?? "").split("\n").length || 0;
    const deletions = (input?.oldString ?? "").split("\n").length || 0;
    // Skip trivial edits (< 3 added lines), mirroring the opencode gate.
    if (additions < 3) return;
    await onFileEdited({
      sessionId,
      project,
      filePath: paths[0],
      additions,
      deletions,
    });
  }
}

async function main(): Promise<void> {
  const event = process.env.JCODE_HOOK_EVENT ?? "";
  if (!event) {
    console.error("[oh-am] JCODE_HOOK_EVENT missing; nothing to do");
    process.exit(0);
  }
  const sessionId = process.env.JCODE_HOOK_SESSION_ID ?? `jcode-${Date.now()}`;
  const cwd = process.env.JCODE_HOOK_CWD ?? process.cwd();

  const cfg = loadConfig();
  if (cfg.debug) log(`event=${event} session=${sessionId.slice(0, 12)} cwd=${cwd}`);

  // Cheap guard: if agentmemory is unreachable, exit silently. Observers
  // must never add latency or noise to jcode.
  const ok = await healthCheck(1500).catch(() => false);
  if (!ok) {
    log("agentmemory unreachable; skipping");
    process.exit(0);
  }

  switch (event) {
    case "session_start":
      await onSessionCreated({ sessionId, cwd, project: cwd });
      break;
    case "post_tool":
      await handlePostTool(sessionId, cwd);
      break;
    case "turn_end":
      // Session-idle equivalent: crystallize check after each completed turn.
      await onSessionEnd({
        sessionID: sessionId,
        project: cwd,
      });
      break;
    case "session_end":
      dropSessionState(sessionId);
      break;
    default:
      log(`unhandled event ${event}`);
  }
}

main()
  .catch((e) => {
    if (DEBUG) console.error("[oh-am] fatal:", (e as Error).message);
    process.exit(0); // observers fail open, always
  })
  .finally(() => process.exit(0));
