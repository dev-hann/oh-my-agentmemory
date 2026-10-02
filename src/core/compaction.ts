/**
 * Observation compaction — two-layer decision logic.
 *
 * Layer 1 (structural, no model): empty observations and lifecycle telemetry
 * event types are dropped outright without calling jev. Benchmark (2026-10-02,
 * 3,274 obs) showed ~85% of noise is identifiable by type/emptiness alone, and
 * jev returns a uniform 0.512 on empty state which no threshold can filter.
 *
 * Layer 2 (model): remaining observations are scored by a local System One
 * decision model (jevos) answering one noul question per observation. The
 * verdict rule was calibrated on a 106-observation labeled corpus and
 * re-validated by full LLM cross-judgment (false-drop 0/3,274):
 *
 *   keep iff keep_call >= 0.35 OR importance >= 2
 *
 * Everything here is data-in/data-out; the adapter owns fetch, file I/O,
 * deletion, and timeouts.
 */

export const KEEP_CALL_INSTRUCTIONS =
  "Knowing that this event or tool call happened, with its input, still matters for the ongoing task.";

/** Event types that are pure lifecycle telemetry regardless of payload. */
const LIFECYCLE_TELEMETRY_TYPES = new Set([
  "config_loaded",
  "llm_params",
  "step_finish",
]);

export type StructuralDropReason = "empty" | "lifecycle-telemetry";
export type VerdictReason = StructuralDropReason | "jev" | "jev-error";

export interface CompactObservation {
  id: string;
  type?: string | null;
  title?: string | null;
  narrative?: string | null;
  facts?: string[];
  files?: string[];
  importance?: number;
  /** ISO timestamp — used to age-gate the empty-observation rule. */
  timestamp?: string | null;
}

export interface ObservationScore {
  id: string;
  keepCall: number | null;
}

export interface CompactionThresholds {
  keepThreshold: number;
  importanceGuard: number;
}

export interface CompactionVerdict {
  id: string;
  keepCall: number | null;
  importance: number;
  kept: boolean;
  guarded: boolean;
  /** Why this verdict was reached. */
  reason: VerdictReason;
  /** Content snapshot for dropped observations — post-deletion audit/re-ingest. */
  snapshot?: { title: string | null; excerpt: string };
  /** Set by the deleter after the observation was actually removed. */
  deletedAt?: string;
}

export interface CompactionResult {
  sessionId: string;
  project: string | null;
  goal: string;
  scoredCount: number;
  errorCount: number;
  keptCount: number;
  droppedCount: number;
  verdicts: CompactionVerdict[];
  createdAt: string;
}

export function buildState(
  goal: string,
  obs: CompactObservation,
): Record<string, unknown> {
  return {
    goal,
    type: obs.type ?? null,
    title: truncate(obs.title ?? "", 120),
    narrative: truncate(obs.narrative ?? "", 400),
    facts: truncate((obs.facts ?? []).slice(0, 4).join("; "), 300),
    files: (obs.files ?? []).slice(0, 3),
  };
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max);
}

/**
 * Observations younger than this are never structurally dropped as "empty":
 * the agentmemory server enriches raw observations asynchronously, so a fresh
 * null-title observation may simply not be enriched yet. Only observations
 * that stayed empty well past any plausible enrichment lag are true noise
 * (the August-corpus nulls sat un-enriched for weeks).
 */
export const ENRICHMENT_GRACE_MS = 5 * 60 * 1000;

/**
 * Layer-1 structural filter. Returns the forced-drop reason, or null when the
 * observation needs Layer-2 (jev) judgment.
 *
 * The "empty" verdict is age-gated (see ENRICHMENT_GRACE_MS) so pending
 * enrichment can never be mistaken for permanent emptiness. Type-blocklisted
 * telemetry needs no gate — a null type simply never matches the blocklist
 * and falls through to jev (fail-open keep) until enrichment assigns a type.
 */
export function structuralDropReason(
  obs: CompactObservation,
  nowMs: number = Date.now(),
): StructuralDropReason | null {
  const title = (obs.title ?? "").trim();
  const narrative = (obs.narrative ?? "").trim();
  if (!title && !narrative) {
    const ts = obs.timestamp ? Date.parse(obs.timestamp) : NaN;
    if (Number.isFinite(ts) && nowMs - ts < ENRICHMENT_GRACE_MS) return null;
    return "empty";
  }
  if (LIFECYCLE_TELEMETRY_TYPES.has(obs.type ?? "")) {
    return "lifecycle-telemetry";
  }
  return null;
}

function snapshotOf(obs: CompactObservation): {
  title: string | null;
  excerpt: string;
} {
  const facts = (obs.facts ?? []).slice(0, 4).join("; ");
  const excerpt = truncate(
    [obs.narrative ?? "", facts].filter((s) => s.length > 0).join(" | "),
    500,
  );
  return { title: obs.title ?? null, excerpt };
}

export function shouldKeep(
  keepCall: number | null,
  importance: number,
  thresholds: CompactionThresholds,
): { kept: boolean; guarded: boolean } {
  if ((importance ?? 0) >= thresholds.importanceGuard) {
    return { kept: true, guarded: true };
  }
  if (keepCall === null) {
    return { kept: true, guarded: false };
  }
  return { kept: keepCall >= thresholds.keepThreshold, guarded: false };
}

export function compactObservations(
  goal: string,
  observations: CompactObservation[],
  scores: Map<string, number | null>,
  thresholds: CompactionThresholds,
  meta: { sessionId: string; project: string | null; createdAt?: string },
): CompactionResult {
  const verdicts: CompactionVerdict[] = observations.map((obs) => {
    const keepCall = scores.get(obs.id) ?? null;
    const importance = obs.importance ?? 0;
    const structural = structuralDropReason(obs);
    if (structural) {
      return {
        id: obs.id,
        keepCall: null,
        importance,
        kept: false,
        guarded: false,
        reason: structural,
        snapshot: snapshotOf(obs),
      };
    }
    const { kept, guarded } = shouldKeep(keepCall, importance, thresholds);
    const reason: VerdictReason = keepCall === null ? "jev-error" : "jev";
    const verdict: CompactionVerdict = {
      id: obs.id,
      keepCall,
      importance,
      kept,
      guarded,
      reason,
    };
    if (!kept) verdict.snapshot = snapshotOf(obs);
    return verdict;
  });
  const scoredCount = verdicts.filter((v) => v.reason === "jev").length;
  const keptCount = verdicts.filter((v) => v.kept).length;
  return {
    sessionId: meta.sessionId,
    project: meta.project,
    goal,
    scoredCount,
    errorCount: verdicts.filter((v) => v.reason === "jev-error").length,
    keptCount,
    droppedCount: verdicts.length - keptCount,
    verdicts,
    createdAt: meta.createdAt ?? new Date().toISOString(),
  };
}

export function dropRate(result: CompactionResult): number {
  const total = result.verdicts.length;
  if (total === 0) return 0;
  return result.droppedCount / total;
}
