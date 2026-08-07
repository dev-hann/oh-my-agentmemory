/**
 * oh-my-agentmemory — opencode plugin entry.
 *
 * Registers five hooks alongside the existing agentmemory-capture.ts plugin
 * (which keeps doing passive observation). This plugin owns the WRITE side:
 *
 *   enforcement — experimental.chat.system.transform → per-turn directive push
 *   init        — event: session.created             → bootstrap empty slots
 *   intent      — chat.message                       → keyword detection
 *   archive     — event: session.status(idle)        → crystal suggestion
 *   learning    — event: file.edited                 → auto lesson capture
 *
 * Hooks are independently disable-able via OH_AM_DISABLE=intent,learning etc.
 */

import type { Plugin } from "@opencode-ai/plugin";
import { onChatMessage } from "./hooks/chat-message.js";
import { onFileEdited } from "./hooks/file-edited.js";
import { onSessionCreated } from "./hooks/session-created.js";
import { onSessionStatus } from "./hooks/session-idle.js";
import { systemTransformHook } from "./hooks/system-transform.js";

const DEBUG = process.env.OH_AM_DEBUG === "1";

interface OpencodeEvent {
  type: string;
  properties?: Record<string, unknown>;
}

interface SessionCreatedProperties {
  info?: { id?: string; title?: string };
  sessionID?: string;
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

export const OhMyAgentmemoryPlugin: Plugin = async (ctx) => {
  if (DEBUG) {
    console.error("[oh-am] plugin loaded");
  }

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
    },
  };
};

export default OhMyAgentmemoryPlugin;
