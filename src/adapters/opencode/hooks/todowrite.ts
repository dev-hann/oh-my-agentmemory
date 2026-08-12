/**
 * bridge — sync todowrite entries to agentmemory actions.
 *
 * opencode's `todowrite` tool captures structured work intent (the LLM
 * planning out subtasks). This hook mirrors **high-priority** entries as
 * agentmemory actions so the work chain shows up in frontiers, crystals,
 * and sessions.
 *
 * Why high-priority only?
 *   - opencode todos are session-local micro-tasks ("read package.json",
 *     "run lint"). agentmemory actions are permanent cross-session work
 *     items. Bridging every todo floods the action store with noise.
 *   - Crystals digest completed action chains; low-value actions produce
 *     low-signal crystals. Filtering at the bridge keeps crystal quality
 *     high.
 *
 * Mapping rules (applied to high-priority todos only):
 *   todo.status     → action.status
 *   ──────────────────────────────────
 *   pending         → pending
 *   in_progress     → active
 *   completed       → done
 *   cancelled       → cancelled
 *
 *   new high-priority todo (not seen before) → memory_action_create(title=content, tags="from-todo")
 *   status change on tracked todo            → memory_action_update(actionId, status, result?)
 *   medium/low priority todo                 → no action (counted in observation only)
 *   removed from list                        → no-op (preserve audit trail)
 *
 * Entries are matched across todowrite calls by `content` (string equality).
 *
 * Disabled via `OH_AM_DISABLE=bridge` or `disabled: ["bridge"]` in config.
 */

import type { ActionStatus, TodoEntry } from "../../../core/types.js";
import {
  createAction,
  createObservation,
  updateAction,
} from "../client.js";
import { isPhaseDisabled } from "./_shared.js";

const DEBUG = process.env.OH_AM_DEBUG === "1";

const PRIORITY_MAP: Record<TodoEntry["priority"], number> = {
  high: 8,
  medium: 5,
  low: 3,
};

const TODO_STATUS_TO_ACTION: Record<TodoEntry["status"], ActionStatus> = {
  pending: "pending",
  in_progress: "active",
  completed: "done",
  cancelled: "cancelled",
};

/** Only high-priority todos become persistent actions. */
const BRIDGE_MIN_PRIORITY: TodoEntry["priority"] = "high";

/** Per-session memory: content → { actionId, lastStatus } */
interface TrackedTodo {
  actionId: string;
  lastStatus: string;
}

interface SessionState {
  byContent: Map<string, TrackedTodo>;
  updatedAt: number;
}

const SESSION_STATE_TTL_MS = 60 * 60 * 1000; // 1 hour

const sessionState = new Map<string, SessionState>();

function getState(sessionId: string): SessionState {
  const now = Date.now();
  const existing = sessionState.get(sessionId);
  if (existing) {
    // Expire stale state to avoid unbounded growth across long-running
    // opencode processes that touch many sessions.
    if (now - existing.updatedAt > SESSION_STATE_TTL_MS) {
      sessionState.delete(sessionId);
    } else {
      existing.updatedAt = now;
      return existing;
    }
  }
  const fresh: SessionState = { byContent: new Map(), updatedAt: now };
  sessionState.set(sessionId, fresh);
  return fresh;
}

/** Drop state for a session that has gone idle. Called by plugin.ts event handler. */
export function dropSessionState(sessionId: string): void {
  sessionState.delete(sessionId);
}

/** Test-only: reset internal state between unit/integration runs. */
export function _resetStateForTests(): void {
  sessionState.clear();
}

export async function onTodowrite(params: {
  sessionId: string;
  project: string | null;
  todos: TodoEntry[];
}): Promise<void> {
  if (isPhaseDisabled("bridge")) return;

  const { sessionId, project, todos } = params;
  const state = getState(sessionId);

  // Split by priority — only high-priority todos get actions.
  const bridgeable = todos.filter((t) => t.priority === BRIDGE_MIN_PRIORITY);
  const skipped = todos.filter((t) => t.priority !== BRIDGE_MIN_PRIORITY);

  const created: Array<{ content: string; actionId: string }> = [];
  const updated: Array<{
    content: string;
    actionId: string;
    from: string;
    to: string;
  }> = [];
  const unchanged: string[] = [];
  const failed: Array<{ content: string; reason: string }> = [];

  for (const todo of bridgeable) {
    const actionStatus = TODO_STATUS_TO_ACTION[todo.status] ?? "pending";
    const existing = state.byContent.get(todo.content);

    if (!existing) {
      // New bridgeable todo — create action.
      let actionId: string | null = null;
      try {
        actionId = await createAction({
          title: todo.content,
          description: `Bridged from todowrite (priority: ${todo.priority}).`,
          priority: PRIORITY_MAP[todo.priority] ?? 5,
          tags: "from-todo",
          project: project ?? undefined,
        });
      } catch (e) {
        failed.push({
          content: todo.content,
          reason: (e as Error).message,
        });
        continue;
      }

      if (actionId) {
        state.byContent.set(todo.content, {
          actionId,
          lastStatus: actionStatus,
        });
        created.push({ content: todo.content, actionId });

        // If the todo started in a non-pending state, sync immediately.
        if (actionStatus !== "pending") {
          const ok = await updateAction(actionId, { status: actionStatus });
          if (!ok && DEBUG) {
            console.error(
              `[oh-am] initial status sync failed for ${actionId}`,
            );
          }
        }
      } else {
        failed.push({ content: todo.content, reason: "createAction returned null" });
      }
      continue;
    }

    // Existing bridgeable todo — check for status transition.
    if (existing.lastStatus !== actionStatus) {
      const ok = await updateAction(existing.actionId, {
        status: actionStatus,
        result:
          actionStatus === "done"
            ? `todo marked completed via todowrite`
            : actionStatus === "cancelled"
              ? `todo cancelled via todowrite`
              : undefined,
      });
      if (ok) {
        existing.lastStatus = actionStatus;
        updated.push({
          content: todo.content,
          actionId: existing.actionId,
          from: existing.lastStatus,
          to: actionStatus,
        });
      } else {
        failed.push({
          content: todo.content,
          reason: `updateAction failed for ${existing.actionId}`,
        });
      }
    } else {
      unchanged.push(todo.content);
    }
  }

  // Observe whenever there is signal — bridged activity OR skipped todos
  // worth recording for debugging the filter.
  if (
    created.length > 0 ||
    updated.length > 0 ||
    failed.length > 0 ||
    skipped.length > 0
  ) {
    await createObservation({
      sessionId,
      hookType: "oh_am_todo_bridge",
      project,
      data: {
        todosSeen: todos.length,
        bridgeableHigh: bridgeable.length,
        skippedNonHigh: skipped.length,
        skippedContents: skipped.map((t) => t.content).slice(0, 10),
        created: created.length,
        updated: updated.length,
        unchanged: unchanged.length,
        failed: failed.length,
        createdDetails: created.slice(0, 10),
        updatedDetails: updated.slice(0, 10),
        failedDetails: failed.slice(0, 5),
      },
    });
  }

  if (DEBUG) {
    console.error(
      `[oh-am] todowrite bridge: high=${bridgeable.length} skipped=${skipped.length} +${created.length} ~${updated.length} =${unchanged.length} !${failed.length}`,
    );
  }
}

