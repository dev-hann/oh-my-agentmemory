/**
 * compaction-runner — adapter glue for observation compaction.
 *
 * On session idle, fetches the session's observations from agentmemory,
 * scores each with the local jevos decision model (/v1/systemone), applies
 * the calibrated verdict rule from core/compaction, and writes a report
 * file. v1 is read-only: agentmemory data is never mutated — the report
 * lists the preserved set and drop candidates for later review.
 *
 * Every failure path returns null so the hook degrades to "compaction
 * did not run" (the existing pipeline is untouched).
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  KEEP_CALL_INSTRUCTIONS,
  buildState,
  compactObservations,
  dropRate,
  type CompactObservation,
  type CompactionResult,
} from "../../core/compaction.js";
import { findSession, listObservations } from "./client.js";
import { getConfig } from "./hooks/_shared.js";

const DEBUG = process.env.OH_AM_DEBUG === "1";
const CONCURRENCY = 4;

interface SystemOneAnswer {
  answers?: Record<string, { noul?: number }>;
}

export async function runSessionCompaction(
  sessionId: string,
  project: string | null,
): Promise<CompactionResult | null> {
  const cfg = getConfig().compaction;
  if (!cfg.enabled) return null;

  try {
    const [sessionRow, rawObservations] = await Promise.all([
      findSession(sessionId),
      listObservations(sessionId, cfg.maxObservations),
    ]);
    if (rawObservations.length === 0) return null;

    const observations: CompactObservation[] = rawObservations.map((o) => ({
      id: o.id,
      type: o.type,
      title: o.title,
      narrative: o.narrative,
      facts: o.facts,
      files: o.files,
      importance: o.importance,
    }));

    const goal = (sessionRow?.firstPrompt ?? "").slice(0, 200) ||
      "recent coding session observations";

    const scores = new Map<string, number | null>();
    const queue = observations.map(
      (o) => async (): Promise<void> => {
        try {
          scores.set(o.id, await scoreKeepCall(cfg.baseUrl, cfg.timeoutMs, buildState(goal, o)));
        } catch {
          scores.set(o.id, null);
        }
      },
    );
    await runWithConcurrency(queue, CONCURRENCY);

    const result = compactObservations(
      goal,
      observations,
      scores,
      { keepThreshold: cfg.keepThreshold, importanceGuard: cfg.importanceGuard },
      { sessionId, project },
    );

    if (result.scoredCount === 0 && result.verdicts.length > 0) {
      if (DEBUG) {
        console.error(
          `[oh-am] compaction skipped for ${sessionId}: jevos unreachable (${result.errorCount} errors)`,
        );
      }
      return null;
    }

    await writeReport(cfg.outputDir, result);

    if (DEBUG) {
      console.error(
        `[oh-am] compaction ${sessionId}: kept ${result.keptCount}/${result.verdicts.length}, drop ${(dropRate(result) * 100).toFixed(1)}%, errors ${result.errorCount}`,
      );
    }
    return result;
  } catch (e) {
    if (DEBUG) {
      console.error(
        `[oh-am] compaction failed for ${sessionId}:`,
        (e as Error).message,
      );
    }
    return null;
  }
}

async function scoreKeepCall(
  baseUrl: string,
  timeoutMs: number,
  state: Record<string, unknown>,
): Promise<number> {
  const res = await fetch(`${baseUrl}/v1/systemone`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "jev-latest",
      state,
      questions: {
        keep_call: { type: "noul", instructions: KEEP_CALL_INSTRUCTIONS },
      },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    throw new Error(`jevos ${res.status}`);
  }
  const data = (await res.json()) as SystemOneAnswer;
  const noul = data.answers?.keep_call?.noul;
  if (typeof noul !== "number") {
    throw new Error("jevos returned no noul");
  }
  return noul;
}

async function runWithConcurrency(
  tasks: Array<() => Promise<void>>,
  limit: number,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (next < tasks.length) {
      const task = tasks[next++];
      await task();
    }
  });
  await Promise.all(workers);
}

async function writeReport(
  outputDir: string,
  result: CompactionResult,
): Promise<void> {
  const dir = outputDir.startsWith("~")
    ? path.join(os.homedir(), outputDir.slice(1))
    : outputDir;
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${result.sessionId}.json`);
  await writeFile(file, JSON.stringify(result, null, 2), "utf8");
}
