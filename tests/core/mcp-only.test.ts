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
    mcpOnly: false,
    ...overrides,
  };
}

describe("buildDirective mcp-only mode", () => {
  it("adds mcp-only banner when mcpOnly=true", () => {
    const out = buildDirective(baseCtx({ mcpOnly: true }), { mcpOnly: true });
    expect(out).toContain("⚠️ MCP-ONLY MODE");
    expect(out).toContain("shift entirely to you");
  });

  it("adds mcp-only specific rules", () => {
    const out = buildDirective(baseCtx({ mcpOnly: true }), { mcpOnly: true });
    expect(out).toContain("Every architectural / non-obvious decision");
    expect(out).toContain("Every bug + fix");
    expect(out).toContain("memory_file_history / memory_timeline will return empty");
  });

  it("omits banner when mcpOnly=false in ctx", () => {
    const out = buildDirective(baseCtx({ mcpOnly: false }), { mcpOnly: false });
    expect(out).not.toContain("⚠️ MCP-ONLY MODE");
  });

  it("directiveCacheKey differentiates mcp-only", () => {
    const fullKey = directiveCacheKey(baseCtx({ mcpOnly: false }));
    const mcpKey = directiveCacheKey(baseCtx({ mcpOnly: true }));
    expect(fullKey).not.toBe(mcpKey);
  });
});
