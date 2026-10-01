/**
 * Observation compaction — pure decision logic.
 *
 * Scores come from a local System One decision model (jevos) answering one
 * noul question per observation: does knowing this observation happened
 * still matter for the session's goal? The verdict rule was calibrated on
 * a 106-observation labeled corpus (see ~/Documents/jevos/bench):
 *
 *   keep iff keep_call >= 0.35 OR importance >= 2
 *
 * which measured 0% missed keeps and 27.4% drop rate. Everything here is
 * data-in/data-out; the adapter owns fetch, file I/O, and timeouts.
 */

export const KEEP_CALL_INSTRUCTIONS =
  "Knowing that this event or tool call happened, with its input, still matters for the ongoing task.";

export interface CompactObservation {
  id: string;
  type?: string | null;
  title?: string | null;
  narrative?: string | null;
  facts?: string[];
  files?: string[];
  importance?: number;
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
    const { kept, guarded } = shouldKeep(keepCall, importance, thresholds);
    return { id: obs.id, keepCall, importance, kept, guarded };
  });
  const scoredCount = verdicts.filter((v) => v.keepCall !== null).length;
  const keptCount = verdicts.filter((v) => v.kept).length;
  return {
    sessionId: meta.sessionId,
    project: meta.project,
    goal,
    scoredCount,
    errorCount: verdicts.length - scoredCount,
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
