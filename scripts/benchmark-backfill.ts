/**
 * benchmark-backfill — jev compaction 과거 데이터 벤치마크 도구.
 *
 * Usage:
 *   bun scripts/benchmark-backfill.ts score   # corpus 세션 jev 스코어링 → benchmark/reports/
 *   bun scripts/benchmark-backfill.ts export  # corpus + 기존 리포트 세션 관찰 내용 → benchmark/content/
 *
 * score 는 runSessionCompaction(read-only 스코어링)을 재사용하고,
 * 생성된 리포트를 benchmark/reports/ 로 이동해 프로덕션 리포트와 분리한다.
 * export 는 판정 비교용 관찰 원문을 세션별 JSONL로 덤프한다.
 */

import { readFileSync, mkdirSync, writeFileSync, existsSync, renameSync, readdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { runSessionCompaction } from "../src/adapters/opencode/compaction-runner.js";
import { listObservations } from "../src/adapters/opencode/client.js";

const ROOT = path.join(os.homedir(), ".local/share/oh-am/benchmark");
const REPORTS = path.join(ROOT, "reports");
const CONTENT = path.join(ROOT, "content");
const COMPACTION_DIR = path.join(os.homedir(), ".local/share/oh-am/compaction");

interface CorpusEntry {
  id: string;
  project: string;
}

function loadCorpus(): CorpusEntry[] {
  const raw = readFileSync(path.join(import.meta.dir, "benchmark-corpus.json"), "utf8");
  return JSON.parse(raw) as CorpusEntry[];
}

function existingReportSessions(): string[] {
  return readdirSync(COMPACTION_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));
}

async function score(only?: Set<string>): Promise<void> {
  mkdirSync(REPORTS, { recursive: true });
  const corpus = loadCorpus().filter((e) => !only || only.has(e.id));
  for (const [i, entry] of corpus.entries()) {
    const dest = path.join(REPORTS, `${entry.id}.json`);
    if (existsSync(dest)) {
      console.log(`[${i + 1}/${corpus.length}] skip (report exists): ${entry.id}`);
      continue;
    }
    console.log(`[${i + 1}/${corpus.length}] scoring: ${entry.id} (${entry.project})`);
    const t0 = Date.now();
    const result = await runSessionCompaction(entry.id, entry.project);
    if (!result) {
      console.log(`  -> null (no observations / jevos unreachable)`);
      continue;
    }
    const src = path.join(COMPACTION_DIR, `${entry.id}.json`);
    if (existsSync(src)) {
      renameSync(src, dest);
      console.log(
        `  -> kept ${result.keptCount}/${result.verdicts.length}, drop ${(result.droppedCount / result.scoredCount * 100).toFixed(1)}% (${((Date.now() - t0) / 1000).toFixed(1)}s)`,
      );
    }
  }
  console.log("score done.");
}

async function exportContent(): Promise<void> {
  mkdirSync(CONTENT, { recursive: true });
  const sessions = new Map<string, string | null>();
  for (const entry of loadCorpus()) sessions.set(entry.id, entry.project);
  for (const sid of existingReportSessions()) {
    if (!sessions.has(sid)) sessions.set(sid, null);
  }
  for (const [sid, project] of sessions) {
    const dest = path.join(CONTENT, `${sid}.jsonl`);
    if (existsSync(dest)) {
      console.log(`skip (content exists): ${sid}`);
      continue;
    }
    const obs = await listObservations(sid, 1000);
    if (obs.length === 0) {
      console.log(`no observations: ${sid}`);
      continue;
    }
    const lines = obs.map((o) =>
      JSON.stringify({
        id: o.id,
        type: o.type ?? null,
        title: o.title ?? null,
        narrative: o.narrative ?? null,
        facts: o.facts ?? [],
        files: o.files ?? [],
        importance: o.importance ?? null,
      }),
    );
    writeFileSync(dest, lines.join("\n") + "\n", "utf8");
    console.log(`exported ${obs.length} obs -> content/${sid}.jsonl${project ? ` (${project})` : ""}`);
  }
  console.log("export done.");
}

const mode = process.argv[2];
if (mode === "score") {
  const ids = process.argv.slice(3).filter((a) => a.startsWith("ses_"));
  await score(ids.size > 0 ? new Set(ids) : undefined);
} else if (mode === "export") {
  await exportContent();
} else {
  console.error("usage: bun scripts/benchmark-backfill.ts score|export");
  process.exit(1);
}
