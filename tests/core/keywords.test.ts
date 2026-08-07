import { describe, expect, it } from "vitest";
import { matchKeywords, summarizeMatches } from "../../src/core/keywords.js";

describe("matchKeywords", () => {
  it("returns empty for plain text", () => {
    expect(matchKeywords("show me the login page")).toEqual([]);
  });

  it("returns empty for empty input", () => {
    expect(matchKeywords("")).toEqual([]);
  });

  it("detects english save intent", () => {
    const matches = matchKeywords("remember this for later");
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.some((m) => m.action === "save")).toBe(true);
  });

  it("detects korean save intent", () => {
    const matches = matchKeywords("이거 기억해 줘");
    expect(matches.some((m) => m.action === "save")).toBe(true);
    expect(matches.some((m) => m.match.includes("기억해"))).toBe(true);
  });

  it("detects recall intent", () => {
    const matches = matchKeywords("do you remember what we did last time?");
    expect(matches.some((m) => m.action === "recall")).toBe(true);
  });

  it("detects korean recall intent", () => {
    const matches = matchKeywords("저번에 한 거 기억나?");
    expect(matches.some((m) => m.action === "recall")).toBe(true);
  });

  it("detects forget intent", () => {
    const matches = matchKeywords("forget that last memory");
    expect(matches.some((m) => m.action === "forget")).toBe(true);
  });

  it("detects negation forget", () => {
    const matches = matchKeywords("don't save this");
    expect(matches.some((m) => m.action === "forget")).toBe(true);
  });

  it("dedupes identical matches", () => {
    const matches = matchKeywords("remember this. remember this. remember this.");
    const saves = matches.filter((m) => m.action === "save");
    expect(saves.length).toBe(1);
  });

  it("respects the per-turn cap", () => {
    const text = Array.from({ length: 20 }, (_, i) => `remember thing ${i}`).join(" ");
    const matches = matchKeywords(text);
    expect(matches.length).toBeLessThanOrEqual(5);
  });
});

describe("summarizeMatches", () => {
  it("returns empty string for no matches", () => {
    expect(summarizeMatches([])).toBe("");
  });

  it("formats matches as action:\"text\"", () => {
    const summary = summarizeMatches([
      { match: "remember this", index: 0, action: "save", patternId: "x" },
    ]);
    expect(summary).toBe('save:"remember this"');
  });
});
