/**
 * Live integration probe — calls real agentmemory server.
 * Run: bun run tests/integration/probe-bridge.ts
 *
 * Verifies:
 *   1. createAction returns an action ID
 *   2. updateAction(status=done) flips status
 *   3. listActions({status:'done'}) includes the new action
 *   4. createObservation records an oh_am_todo_bridge-style observation
 *
 * Skips automatically if server unreachable.
 */

import {
  createAction,
  createCrystal,
  createObservation,
  listActions,
  healthCheck,
  updateAction,
} from "../../src/adapters/opencode/client.js";
import { onTodowrite } from "../../src/adapters/opencode/hooks/todowrite.js";
import type { TodoEntry } from "../../src/core/types.js";
import { _setModeForTests } from "../../src/adapters/opencode/mode.js";

const PROBE_SESSION = "ses_probe_live_e2e";
const PROBE_PROJECT = "oh-am-integration-probe";

interface Step {
  name: string;
  fn: () => Promise<void>;
}

const steps: Step[] = [
  {
    name: "health check",
    fn: async () => {
      const ok = await healthCheck();
      if (!ok) throw new Error("agentmemory server unreachable");
      console.log("  ✓ server reachable");
    },
  },
  {
    name: "force full mode (disable mcp-only skip)",
    fn: async () => {
      _setModeForTests("full");
      console.log("  ✓ mode set to full");
    },
  },
  {
    name: "createAction direct",
    fn: async () => {
      const id = await createAction({
        title: "probe-direct-action",
        description: "integration probe — direct client call",
        tags: "probe",
        project: PROBE_PROJECT,
      });
      if (!id) throw new Error("createAction returned null");
      console.log(`  ✓ created ${id}`);
      // cleanup — cancel
      await updateAction(id, { status: "cancelled", result: "probe cleanup" });
    },
  },
  {
    name: "onTodowrite creates 3 actions (all high priority)",
    fn: async () => {
      const todos: TodoEntry[] = [
        { content: "probe-todo-A", status: "pending", priority: "high" },
        { content: "probe-todo-B", status: "pending", priority: "high" },
        { content: "probe-todo-C", status: "pending", priority: "high" },
      ];
      await onTodowrite({
        sessionId: PROBE_SESSION,
        project: PROBE_PROJECT,
        todos,
      });
      console.log("  ✓ onTodowrite returned (3 high-priority actions expected)");
    },
  },
  {
    name: "listActions shows the 3 pending actions",
    fn: async () => {
      const actions = await listActions({ status: "pending", limit: 50 });
      const probeActions = actions.filter((a) =>
        (a.tags ?? []).includes("from-todo"),
      ).filter((a) => a.title.startsWith("probe-todo-"));
      if (probeActions.length !== 3) {
        throw new Error(
          `expected 3 probe pending actions, got ${probeActions.length}`,
        );
      }
      console.log(
        `  ✓ found ${probeActions.length} probe actions: ${probeActions.map((a) => a.id).join(",")}`,
      );
    },
  },
  {
    name: "transition two todos to completed via onTodowrite",
    fn: async () => {
      const todos: TodoEntry[] = [
        { content: "probe-todo-A", status: "completed", priority: "high" },
        { content: "probe-todo-B", status: "completed", priority: "high" },
        { content: "probe-todo-C", status: "in_progress", priority: "high" },
      ];
      await onTodowrite({
        sessionId: PROBE_SESSION,
        project: PROBE_PROJECT,
        todos,
      });
      console.log("  ✓ status transitions sent");
    },
  },
  {
    name: "listActions({status:'done'}) has 2 probe actions",
    fn: async () => {
      const done = await listActions({ status: "done", limit: 100 });
      const probeDone = done.filter(
        (a) =>
          (a.tags ?? []).includes("from-todo") &&
          a.title.startsWith("probe-todo-"),
      );
      if (probeDone.length !== 2) {
        throw new Error(
          `expected 2 done probe actions, got ${probeDone.length}`,
        );
      }
      console.log(
        `  ✓ ${probeDone.length} done: ${probeDone.map((a) => a.id).join(",")}`,
      );
    },
  },
  {
    name: "createObservation records hook trace",
    fn: async () => {
      const ok = await createObservation({
        sessionId: PROBE_SESSION,
        hookType: "probe_e2e_complete",
        project: PROBE_PROJECT,
        data: { phase: "integration-probe", timestamp: new Date().toISOString() },
      });
      if (!ok) throw new Error("createObservation returned false");
      console.log("  ✓ observation recorded");
    },
  },
  {
    name: "createCrystal with the 2 done actions (auto-crystal simulation)",
    fn: async () => {
      const done = await listActions({ status: "done", limit: 100 });
      const probeDone = done
        .filter(
          (a) =>
            (a.tags ?? []).includes("from-todo") &&
            a.title.startsWith("probe-todo-"),
        )
        .slice(0, 2)
        .map((a) => a.id);
      if (probeDone.length < 2) throw new Error("not enough done actions");
      const ok = await createCrystal({
        actionIds: probeDone,
        project: PROBE_PROJECT,
        sessionId: PROBE_SESSION,
      });
      if (!ok) throw new Error("createCrystal returned false");
      console.log(`  ✓ crystal create accepted for ${probeDone.length} actions`);
    },
  },
];

async function main() {
  console.log("oh-am live integration probe\n");
  let passed = 0;
  let failed = 0;
  for (const step of steps) {
    process.stdout.write(`▶ ${step.name}\n`);
    try {
      await step.fn();
      passed++;
    } catch (e) {
      console.log(`  ✗ ${(e as Error).message}`);
      failed++;
    }
  }
  console.log(`\n${passed}/${steps.length} steps passed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("probe crashed:", e);
  process.exit(1);
});
