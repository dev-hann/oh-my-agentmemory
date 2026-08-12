/**
 * Combined probe: status transitions + OH_AM_DISABLE=bridge.
 *
 * Part A — Status transitions:
 *   pending → active → done (normal path)
 *   pending → cancelled (abandoned)
 *   active → pending (revival — should work)
 *
 * Part B — OH_AM_DISABLE=bridge:
 *   Set env, call onTodowrite, verify no action created
 */

import {
  createAction,
  listActions,
  updateAction,
} from "../../src/adapters/opencode/client.js";
import { onTodowrite, _resetStateForTests } from "../../src/adapters/opencode/hooks/todowrite.js";
import { _setModeForTests } from "../../src/adapters/opencode/mode.js";
import type { TodoEntry } from "../../src/core/types.js";

const PROBE = "probe-transitions";

async function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

async function partA() {
  console.log("\n=== Part A: status transitions ===\n");

  // Path 1: pending → active → done
  console.log("▶ Path 1: pending → active → done");
  const id1 = await createAction({
    title: `${PROBE}-p1`,
    priority: 8,
    tags: "probe-transition",
  });
  assert(!!id1, "create returns id");

  await updateAction(id1!, { status: "active" });
  let actions = await listActions({ status: "active", limit: 50 });
  assert(
    actions.some((a) => a.id === id1),
    "action shows as active",
  );

  await updateAction(id1!, { status: "done", result: "completed normally" });
  actions = await listActions({ status: "done", limit: 100 });
  assert(actions.some((a) => a.id === id1), "action shows as done");

  // Path 2: pending → cancelled
  console.log("\n▶ Path 2: pending → cancelled");
  const id2 = await createAction({
    title: `${PROBE}-p2`,
    priority: 8,
    tags: "probe-transition",
  });
  await updateAction(id2!, { status: "cancelled", result: "abandoned" });
  actions = await listActions({ status: "cancelled", limit: 100 });
  assert(
    actions.some((a) => a.id === id2),
    "action shows as cancelled",
  );

  // Path 3: revival — done → pending again (edge case)
  console.log("\n▶ Path 3: done → pending (revival)");
  await updateAction(id1!, { status: "pending" });
  actions = await listActions({ status: "pending", limit: 100 });
  assert(
    actions.some((a) => a.id === id1),
    "done action revived back to pending",
  );

  // Cleanup
  await updateAction(id1!, { status: "cancelled", result: "cleanup" });
  console.log("\n✓ Part A passed");
}

async function partB() {
  console.log("\n=== Part B: OH_AM_DISABLE=bridge ===\n");

  // Save original, set env
  const origDisable = process.env.OH_AM_DISABLE;
  process.env.OH_AM_DISABLE = "bridge";

  // Reset config cache + state to pick up env change
  const { _setConfigForTests } = await import("../../src/adapters/opencode/config.js");
  const { mergeConfig } = await import("../../src/adapters/opencode/config.js");
  _setConfigForTests(
    mergeConfig(null, { OH_AM_DISABLE: "bridge" }),
  );
  _resetStateForTests();
  _setModeForTests("full");

  console.log("▶ calling onTodowrite with bridge disabled...");
  const todos: TodoEntry[] = [
    { content: `${PROBE}-disabled-test`, status: "pending", priority: "high" },
  ];
  await onTodowrite({ sessionId: "ses_disabled", project: null, todos });

  // Check no action created
  const actions = await listActions({ status: "pending", limit: 100 });
  const found = actions.find(
    (a) => a.title === `${PROBE}-disabled-test`,
  );
  assert(!found, "no action created when bridge disabled");

  // Restore
  process.env.OH_AM_DISABLE = origDisable;
  _setConfigForTests(
    mergeConfig(null, { OH_AM_DISABLE: origDisable ?? "" }),
  );

  console.log("\n✓ Part B passed");
}

async function main() {
  try {
    await partA();
    await partB();
    console.log("\n=== ALL TESTS PASSED ===");
  } catch (e) {
    console.error("\n✗", (e as Error).message);
    process.exit(1);
  }
}

main();
