import { describe, expect, it } from "vitest";
import { buildDirective, directiveCacheKey } from "../../src/core/directives.js";
import type { DirectiveContext, PhaseId } from "../../src/core/types.js";

function baseCtx(overrides: Partial<DirectiveContext> = {}): DirectiveContext {
  return {
    emptySlots: [],
    doneActionCount: 0,
    crystalCandidateIds: [],
    pendingKeywords: [],
    disabledPhases: new Set<PhaseId>(),
    ...overrides,
  };
}

describe("buildDirective", () => {
  it("always contains the header and footer", () => {
    const out = buildDirective(baseCtx());
    expect(out).toContain("AGENTMEMORY POLICY ACTIVE");
    expect(out).toContain("false report (forbidden)");
  });

  it("includes policy bodies by default", () => {
    const out = buildDirective(baseCtx());
    expect(out).toContain("## Recall");
    expect(out).toContain("## Write");
    expect(out).toContain("## Crystal");
    expect(out).toMatch(/memory_slot_replace/);
  });

  it("omits policy bodies in compact mode", () => {
    const out = buildDirective(baseCtx(), { compact: true });
    expect(out).not.toContain("## Recall");
    expect(out).toContain("AGENTMEMORY POLICY ACTIVE");
  });

  it("shows empty slots line when slots are empty", () => {
    const out = buildDirective(
      baseCtx({ emptySlots: ["persona", "project_context"] }),
    );
    expect(out).toContain("[STATE] Pinned slots empty: persona, project_context");
  });

  it("hides empty slots line when all filled", () => {
    const out = buildDirective(baseCtx());
    expect(out).not.toContain("[STATE] Pinned slots empty");
  });

  it("suggests crystallize at threshold 3", () => {
    const out = buildDirective(
      baseCtx({
        doneActionCount: 3,
        crystalCandidateIds: ["a1", "a2", "a3"],
      }),
    );
    expect(out).toContain("3 done actions detected");
    expect(out).toContain("a1,a2,a3");
    expect(out).toMatch(/memory_crystallize/);
  });

  it("stays quiet below crystal threshold", () => {
    const out = buildDirective(
      baseCtx({ doneActionCount: 2, crystalCandidateIds: ["a1", "a2"] }),
    );
    expect(out).not.toContain("done actions detected");
  });

  it("surfaces pending keyword matches", () => {
    const out = buildDirective(
      baseCtx({
        pendingKeywords: [
          { match: "remember this", index: 0, action: "save", patternId: "x" },
        ],
      }),
    );
    expect(out).toContain("[USER INTENT]");
    expect(out).toContain('"remember this" → save');
  });

  it("lists disabled phases when present", () => {
    const out = buildDirective(
      baseCtx({
        disabledPhases: new Set<PhaseId>(["intent", "learning"]),
      }),
    );
    expect(out).toContain("[DEBUG] Disabled phases: intent, learning");
  });
});

describe("directiveCacheKey", () => {
  it("is stable for identical contexts", () => {
    const a = directiveCacheKey(baseCtx({ doneActionCount: 3 }));
    const b = directiveCacheKey(baseCtx({ doneActionCount: 3 }));
    expect(a).toBe(b);
  });

  it("changes when inputs change", () => {
    const a = directiveCacheKey(baseCtx({ doneActionCount: 3 }));
    const b = directiveCacheKey(baseCtx({ doneActionCount: 4 }));
    expect(a).not.toBe(b);
  });
});
