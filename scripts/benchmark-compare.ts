/**
 * benchmark-compare — jev 판정 vs LLM 판정 비교 리포트.
 *
 * 대상: benchmark/reports/ (jev, 과거분 포함) × benchmark/llm-verdicts/ (LLM TSV)
 * 조인 키: 관찰 id (jev 리포트의 verdict 범위로 한정)
 * 산출:
 *   - 세션별/전체 일치 행렬
 *   - false-drop (jev=DROP, LLM=KEEP) 목록 — 치명적 방향
 *   - false-keep (jev=KEEP, LLM=DROP) 목록 — 비용 방향
 *
 * Usage: bun scripts/benchmark-compare.ts [--full]
 */

import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const ROOT = path.join(os.homedir(), ".local/share/oh-am/benchmark");
const REPORTS = path.join(ROOT, "reports");
const VERDICTS = path.join(ROOT, "llm-verdicts");

interface JevVerdict {
  id: string;
  keepCall: number | null;
  importance: number | null;
  kept: boolean;
  guarded: boolean;
}

interface JevReport {
  sessionId: string;
  scoredCount: number;
  errorCount: number;
  keptCount: number;
  droppedCount: number;
  verdicts: JevVerdict[];
}

function loadJev(sessionId: string): JevReport | null {
  const p = path.join(REPORTS, `${sessionId}.json`);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8")) as JevReport;
}

function loadLlm(sessionId: string): Map<string, { v: "KEEP" | "DROP"; reason: string }> {
  const p = path.join(VERDICTS, `${sessionId}.tsv`);
  const m = new Map<string, { v: "KEEP" | "DROP"; reason: string }>();
  if (!existsSync(p)) return m;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const [id, v, ...rest] = line.split("\t");
    if (id && (v === "KEEP" || v === "DROP")) {
      m.set(id, { v, reason: rest.join("\t").trim() });
    }
  }
  return m;
}

const full = process.argv.includes("--full");
const sessionIds = readdirSync(REPORTS)
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""));

const totals = { both: 0, kk: 0, dd: 0, falseDrop: 0, falseKeep: 0, llmOnly: 0, jevOnly: 0 };
const falseDrops: Array<{ sid: string; id: string; keepCall: number | null; importance: number | null; guarded: boolean; reason: string }> = [];
const falseKeeps: Array<{ sid: string; id: string; keepCall: number | null; importance: number | null; guarded: boolean; reason: string }> = [];

for (const sid of sessionIds) {
  const jev = loadJev(sid);
  const llm = loadLlm(sid);
  if (!jev || llm.size === 0) continue;

  const s = { kk: 0, dd: 0, fd: 0, fk: 0, llmOnly: 0 };
  for (const v of jev.verdicts) {
    const l = llm.get(v.id);
    if (!l) {
      s.llmOnly++;
      totals.llmOnly++;
      continue;
    }
    totals.both++;
    if (v.kept && l.v === "KEEP") {
      s.kk++;
      totals.kk++;
    } else if (!v.kept && l.v === "DROP") {
      s.dd++;
      totals.dd++;
    } else if (!v.kept && l.v === "KEEP") {
      s.fd++;
      totals.falseDrop++;
      falseDrops.push({ sid, id: v.id, keepCall: v.keepCall, importance: v.importance, guarded: v.guarded, reason: l.reason });
    } else {
      s.fk++;
      totals.falseKeep++;
      falseKeeps.push({ sid, id: v.id, keepCall: v.keepCall, importance: v.importance, guarded: v.guarded, reason: l.reason });
    }
  }
  for (const id of llm.keys()) {
    if (!jev.verdicts.some((v) => v.id === id)) totals.jevOnly++;
  }
  const agree = ((s.kk + s.dd) / Math.max(1, s.kk + s.dd + s.fd + s.fk) * 100).toFixed(1);
  console.log(`${sid}  agree=${agree}%  kk=${s.kk} dd=${s.dd} false-drop=${s.fd} false-keep=${s.fk}${s.llmOnly ? ` (llm-only+${s.llmOnly})` : ""}`);
}

console.log("\n== TOTALS ==");
console.log(`비교 대상: ${totals.both}`);
console.log(`일치: ${totals.kk + totals.dd} (${((totals.kk + totals.dd) / Math.max(1, totals.both) * 100).toFixed(1)}%)`);
console.log(`keep/keep: ${totals.kk}  drop/drop: ${totals.dd}`);
console.log(`FALSE-DROP (jev=drop, LLM=keep — 유실 위험): ${totals.falseDrop}`);
console.log(`false-keep (jev=keep, LLM=drop — 비용만): ${totals.falseKeep}`);
if (totals.llmOnly) console.log(`(리포트 스코프 밖 LLM 판정: ${totals.llmOnly}, jev 스코프 밖: ${totals.jevOnly})`);

if (full) {
  console.log("\n== FALSE-DROPS (전체) ==");
  for (const f of falseDrops) {
    console.log(`${f.id}  keepCall=${f.keepCall?.toFixed(3)} imp=${f.importance} [${f.sid.slice(0, 12)}] ${f.reason}`);
  }
  console.log("\n== FALSE-KEEPS (최대 200) ==");
  for (const f of falseKeeps.slice(0, 200)) {
    console.log(`${f.id}  keepCall=${f.keepCall?.toFixed(3)} imp=${f.importance} [${f.sid.slice(0, 12)}] ${f.reason}`);
  }
}

writeFileSync(
  path.join(ROOT, "compare-result.json"),
  JSON.stringify({ totals, falseDrops, falseKeeps }, null, 2),
  "utf8",
);
console.log("\nsaved -> benchmark/compare-result.json");
