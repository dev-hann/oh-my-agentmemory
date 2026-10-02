/**
 * e2e-compaction-check — live E2E for the compaction v2 pipeline.
 *
 * Creates a synthetic agentmemory session, seeds it through /observe with
 * telemetry + real observations (mimicking vendor capture payloads), runs the
 * full pipeline (L1 structural filter, jev scoring, deletion via /forget,
 * report rewrite, re-summarize), verifies the post-state, cleans up.
 *
 * Usage: bun scripts/e2e-compaction-check.ts
 */

import { loadConfig } from "../src/adapters/opencode/config.js";
import { forgetObservations, listObservations } from "../src/adapters/opencode/client.js";
import { runSessionCompaction } from "../src/adapters/opencode/compaction-runner.js";
import { readFileSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const SID = "ses_oh_am_e2e_compaction_check";
const REPORT = path.join(
  os.homedir(),
  ".local/share/oh-am/compaction",
  `${SID}.json`,
);

const cfg = loadConfig();

function headers(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.secret) h["Authorization"] = `Bearer ${cfg.secret}`;
  return h;
}

async function post(route: string, body: Record<string, unknown>): Promise<boolean> {
  const res = await fetch(`${cfg.url}/agentmemory${route}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
  return res.ok;
}

async function observe(
  hookType: string,
  data: Record<string, unknown>,
  ageMs = 0,
): Promise<boolean> {
  return post("/observe", {
    hookType,
    sessionId: SID,
    project: "/",
    cwd: "/",
    timestamp: new Date(Date.now() - ageMs).toISOString(),
    data,
  });
}

const NONCE = Date.now();

interface Seed {
  key: string;
  hookType: string;
  data: Record<string, unknown>;
  expect: "deleted" | "kept";
}

const SEEDS: Seed[] = [
  {
    key: "config-loaded-telemetry",
    expect: "deleted",
    hookType: "config",
    // capture.ts "config_loaded" payload shape
    data: { event: "config_loaded", theme: "dark", model: null, agents: ["build"], mcp_servers: [], providers: [], tool_input: { run: NONCE, n: 1 } },
  },
  {
    key: "llm-params-telemetry",
    expect: "deleted",
    hookType: "chat.params",
    data: { event: "llm_params", agent: "build", model: "zai/glm-5.3", temperature: 0.7, topP: 1, cost_1k_input: 0, cost_1k_output: 0, tool_input: { run: NONCE, n: 2 } },
  },
  {
    key: "step-finish-telemetry",
    expect: "deleted",
    hookType: "message.part.updated",
    data: { event: "step_finish", reason: "stop", cost: 0.01, input_tokens: 100, output_tokens: 50, reasoning_tokens: 10, tool_input: { run: NONCE, n: 3 } },
  },
  {
    key: "real-tool-use",
    expect: "kept",
    hookType: "message.part.updated",
    data: {
      event: "post_tool_use",
      tool_name: "edit",
      call_id: "call_e2e_1",
      tool_input: { filePath: "src/app/layout.tsx", oldString: "padding: 16px", newString: "padding: var(--space-4)", run: NONCE },
      tool_output: "Edit applied successfully to src/app/layout.tsx",
      duration_ms: 120,
    },
  },
  {
    key: "real-decision",
    expect: "kept",
    hookType: "message.part.updated",
    data: {
      event: "decision",
      title: "Adopted token-based spacing",
      narrative: "Migrated hardcoded spacing values to the design token map because three components drifted from the Figma spec.",
      importance: 2,
      tool_input: { run: NONCE, n: 5 },
    },
  },
];

async function main(): Promise<void> {
  // fresh state — session-level forget (no ids) wipes all observations
  await post("/forget", { sessionId: SID });
  if (existsSync(REPORT)) rmSync(REPORT);
  await post("/session/start", { sessionId: SID, title: "e2e compaction check", project: "/", cwd: "/" });

  for (const s of SEEDS) {
    // telemetry seeds are aged past the enrichment grace so L1 can drop them;
    // real seeds stay fresh (their value must survive regardless of state)
    const ageMs = s.expect === "deleted" ? 10 * 60 * 1000 : 0;
    const ok = await observe(s.hookType, s.data, ageMs);
    if (!ok) throw new Error(`seed failed: ${s.key}`);
  }
  const before = await listObservations(SID, 100);
  console.log(`seeded ${before.length} observations`);
  if (before.length < SEEDS.length) throw new Error("seeds missing after observe");

  const result = await runSessionCompaction(SID, "/");
  if (!result) throw new Error("compaction returned null");

  const after = await listObservations(SID, 100);
  const afterIds = new Set(after.map((o) => o.id));
  const report = JSON.parse(readFileSync(REPORT, "utf8"));

  let failures = 0;
  for (let i = 0; i < SEEDS.length; i++) {
    const id = before[i].id;
    const seed = SEEDS[i];
    const stillThere = afterIds.has(id);
    const verdict = report.verdicts.find((v: { id: string }) => v.id === id);
    const ok =
      (seed.expect === "deleted" && !stillThere && verdict?.deletedAt) ||
      (seed.expect === "kept" && stillThere && !verdict?.deletedAt);
    if (!ok) failures++;
    console.log(
      `${ok ? "PASS" : "FAIL"}  ${seed.key.padEnd(24)} expect=${seed.expect} present=${stillThere} reason=${verdict?.reason} deletedAt=${verdict?.deletedAt ?? "-"}`,
    );
  }
  console.log(
    `report: scored=${result.scoredCount} errors=${result.errorCount} kept=${result.keptCount} dropped=${result.droppedCount}`,
  );

  // cleanup: forget all remaining observations + session
  await post("/forget", { sessionId: SID });
  if (existsSync(REPORT)) rmSync(REPORT);
  console.log(failures === 0 ? "E2E OK" : `E2E FAILURES: ${failures}`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
