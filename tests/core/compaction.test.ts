import { describe, expect, it } from "vitest";
import {
  buildState,
  compactObservations,
  dropRate,
  shouldKeep,
  structuralDropReason,
  truncate,
  type CompactObservation,
} from "../../src/core/compaction.js";

const THRESHOLDS = { keepThreshold: 0.35, importanceGuard: 2 };

describe("shouldKeep", () => {
  it("keeps when keep_call is at or above the threshold", () => {
    expect(shouldKeep(0.35, 0, THRESHOLDS).kept).toBe(true);
    expect(shouldKeep(0.9, 0, THRESHOLDS).kept).toBe(true);
  });

  it("drops when keep_call is below the threshold and importance is low", () => {
    const r = shouldKeep(0.34, 1, THRESHOLDS);
    expect(r.kept).toBe(false);
    expect(r.guarded).toBe(false);
  });

  it("guards by importance regardless of keep_call", () => {
    const r = shouldKeep(0.01, 2, THRESHOLDS);
    expect(r.kept).toBe(true);
    expect(r.guarded).toBe(true);
  });

  it("keeps conservatively when the score is null (scoring error)", () => {
    const r = shouldKeep(null, 0, THRESHOLDS);
    expect(r.kept).toBe(true);
    expect(r.guarded).toBe(false);
  });

  it("treats missing importance as zero", () => {
    expect(shouldKeep(0.1, undefined as unknown as number, THRESHOLDS).kept).toBe(false);
  });
});

describe("compactObservations", () => {
  const observations: CompactObservation[] = [
    { id: "a", importance: 4, title: "t-a", narrative: "n-a" },
    { id: "b", importance: 1, title: "t-b", narrative: "n-b" },
    { id: "c", importance: 0, title: "t-c", narrative: "n-c" },
    { id: "d", importance: 3, title: "t-d", narrative: "n-d" },
  ];
  const scores = new Map<string, number | null>([
    ["a", 0.01],
    ["b", 0.8],
    ["c", 0.2],
    ["d", null],
  ]);

  const result = compactObservations("goal", observations, scores, THRESHOLDS, {
    sessionId: "ses_x",
    project: "/p",
    createdAt: "2026-10-01T00:00:00Z",
  });

  it("classifies keep/drop/guard/error per observation", () => {
    const byId = new Map(result.verdicts.map((v) => [v.id, v]));
    expect(byId.get("a")?.kept).toBe(true);
    expect(byId.get("a")?.guarded).toBe(true);
    expect(byId.get("b")?.kept).toBe(true);
    expect(byId.get("b")?.guarded).toBe(false);
    expect(byId.get("c")?.kept).toBe(false);
    expect(byId.get("d")?.kept).toBe(true);
  });

  it("counts stats consistently", () => {
    expect(result.scoredCount).toBe(3);
    expect(result.errorCount).toBe(1);
    expect(result.keptCount).toBe(3);
    expect(result.droppedCount).toBe(1);
    expect(dropRate(result)).toBeCloseTo(0.25);
  });

  it("carries session metadata", () => {
    expect(result.sessionId).toBe("ses_x");
    expect(result.project).toBe("/p");
    expect(result.goal).toBe("goal");
  });

  it("handles empty input", () => {
    const empty = compactObservations("g", [], new Map(), THRESHOLDS, {
      sessionId: "s",
      project: null,
    });
    expect(empty.verdicts).toHaveLength(0);
    expect(dropRate(empty)).toBe(0);
  });
});

describe("structuralDropReason (layer 1)", () => {
  it("flags observations with neither title nor narrative as empty", () => {
    expect(structuralDropReason({ id: "x" })).toBe("empty");
    expect(structuralDropReason({ id: "x", title: "  ", narrative: "" })).toBe("empty");
    expect(
      structuralDropReason({ id: "x", timestamp: "2026-01-01T00:00:00Z" }),
    ).toBe("empty");
  });

  it("age-gates empty observations inside the enrichment grace window", () => {
    const fresh = new Date(Date.now() - 30_000).toISOString();
    expect(structuralDropReason({ id: "x", timestamp: fresh })).toBeNull();
    const justOutside = new Date(Date.now() - 6 * 60 * 1000).toISOString();
    expect(structuralDropReason({ id: "x", timestamp: justOutside })).toBe("empty");
  });

  it("does not flag observations with any content", () => {
    expect(structuralDropReason({ id: "x", title: "t" })).toBeNull();
    expect(structuralDropReason({ id: "x", narrative: "n" })).toBeNull();
  });

  it("flags lifecycle telemetry types regardless of content", () => {
    for (const type of ["config_loaded", "llm_params", "step_finish"]) {
      expect(structuralDropReason({ id: "x", type, title: "t", narrative: "n" })).toBe(
        "lifecycle-telemetry",
      );
    }
  });

  it("leaves content-bearing types to layer 2", () => {
    expect(
      structuralDropReason({ id: "x", type: "post_tool_use", title: "t", narrative: "n" }),
    ).toBeNull();
  });
});

describe("compactObservations with structural noise", () => {
  const observations: CompactObservation[] = [
    { id: "empty", title: null, narrative: null },
    { id: "telemetry", type: "llm_params", title: "LLM params", narrative: "temp=0.7" },
    { id: "real", type: "post_tool_use", title: "t", narrative: "n", importance: 0 },
  ];

  it("forces structural drops without a jev score", () => {
    const result = compactObservations("g", observations, new Map(), THRESHOLDS, {
      sessionId: "s",
      project: null,
    });
    const byId = new Map(result.verdicts.map((v) => [v.id, v]));
    expect(byId.get("empty")?.kept).toBe(false);
    expect(byId.get("empty")?.reason).toBe("empty");
    expect(byId.get("telemetry")?.kept).toBe(false);
    expect(byId.get("telemetry")?.reason).toBe("lifecycle-telemetry");
    expect(byId.get("real")?.reason).toBe("jev-error"); // no score provided
    expect(byId.get("real")?.kept).toBe(true); // fail-open keeps unscored
  });

  it("attaches snapshots only to drop verdicts", () => {
    const result = compactObservations(
      "g",
      observations,
      new Map([["real", 0.9]]),
      THRESHOLDS,
      { sessionId: "s", project: null },
    );
    const byId = new Map(result.verdicts.map((v) => [v.id, v]));
    expect(byId.get("empty")?.snapshot?.title).toBeNull();
    expect(byId.get("real")?.snapshot).toBeUndefined();
  });

  it("counts stats with structural drops separated from errors", () => {
    const result = compactObservations(
      "g",
      observations,
      new Map([["real", 0.2]]),
      THRESHOLDS,
      { sessionId: "s", project: null },
    );
    expect(result.scoredCount).toBe(1);
    expect(result.errorCount).toBe(0);
    expect(result.droppedCount).toBe(3); // empty + telemetry + real(0.2 < 0.35)
  });
});

describe("buildState", () => {
  it("truncates long fields to the calibrated limits", () => {
    const obs: CompactObservation = {
      id: "x",
      type: "file_read",
      title: "t".repeat(500),
      narrative: "n".repeat(1000),
      facts: ["f1", "f2", "f3", "f4", "f5"],
      files: ["a.ts", "b.ts", "c.ts", "d.ts"],
      importance: 1,
    };
    const state = buildState("goal", obs) as Record<string, unknown>;
    expect((state.title as string).length).toBe(120);
    expect((state.narrative as string).length).toBe(400);
    expect((state.facts as string).length).toBeLessThanOrEqual(300);
    expect(state.files).toEqual(["a.ts", "b.ts", "c.ts"]);
  });

  it("defaults nullish fields to empty shapes", () => {
    const state = buildState("g", { id: "x" }) as Record<string, unknown>;
    expect(state.title).toBe("");
    expect(state.files).toEqual([]);
    expect(state.type).toBe(null);
  });
});

describe("truncate", () => {
  it("passes short strings through unchanged", () => {
    expect(truncate("abc", 5)).toBe("abc");
  });
  it("cuts long strings at max", () => {
    expect(truncate("abcdef", 3)).toBe("abc");
  });
});
