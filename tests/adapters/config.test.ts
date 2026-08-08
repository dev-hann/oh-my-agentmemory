import { describe, expect, it } from "vitest";
import { mergeConfig, parseJsonc, validateConfig } from "../../src/adapters/opencode/config.js";
import type { OhAmConfig } from "../../src/core/config-types.js";

describe("parseJsonc", () => {
  it("strips line comments", () => {
    const out = parseJsonc('{ "a": 1 // hi\n }') as { a: number };
    expect(out.a).toBe(1);
  });

  it("strips block comments", () => {
    const out = parseJsonc('{ "a": /* hi */ 2 }') as { a: number };
    expect(out.a).toBe(2);
  });

  it("strips trailing commas", () => {
    const out = parseJsonc('{ "a": 3, "b": [1, 2,], }') as { a: number; b: number[] };
    expect(out.a).toBe(3);
    expect(out.b).toEqual([1, 2]);
  });

  it("preserves // inside strings", () => {
    const out = parseJsonc('{ "url": "http://example.com/x" }') as { url: string };
    expect(out.url).toBe("http://example.com/x");
  });

  it("preserves /* inside strings", () => {
    const out = parseJsonc('{ "regex": "/a/*b/" }') as { regex: string };
    expect(out.regex).toBe("/a/*b/");
  });

  it("throws on invalid json", () => {
    expect(() => parseJsonc("{")).toThrow();
  });
});

describe("validateConfig", () => {
  it("accepts empty object", () => {
    expect(() => validateConfig({})).not.toThrow();
  });

  it("accepts valid mode", () => {
    expect(() => validateConfig({ mode: "mcp-only" })).not.toThrow();
  });

  it("rejects invalid mode", () => {
    expect(() => validateConfig({ mode: "wat" })).toThrow(/mode/);
  });

  it("rejects invalid phase in disabled", () => {
    expect(() => validateConfig({ disabled: ["phase1"] })).toThrow(/disabled entry/);
  });

  it("accepts valid phase in disabled", () => {
    expect(() => validateConfig({ disabled: ["learning", "intent"] })).not.toThrow();
  });

  it("rejects malformed projectMap entry", () => {
    expect(() =>
      validateConfig({
        projectMap: [{ match: "x" }],
      }),
    ).toThrow(/projectId/);
  });

  it("rejects non-object root", () => {
    expect(() => validateConfig("nope")).toThrow();
  });
});

describe("mergeConfig", () => {
  it("uses defaults when no env, no config", () => {
    const r = mergeConfig(null, {});
    expect(r.url).toBe("http://localhost:3111");
    expect(r.mode).toBe("auto");
    expect(r.disabled.size).toBe(0);
    expect(r.sources.url).toBe("default");
  });

  it("AGENTMEMORY_URL env wins over config.url", () => {
    const cfg: OhAmConfig = { url: "http://from-file:1" };
    const r = mergeConfig(cfg, { AGENTMEMORY_URL: "http://from-env:2" });
    expect(r.url).toBe("http://from-env:2");
    expect(r.sources.url).toBe("env");
  });

  it("config.url wins over default", () => {
    const cfg: OhAmConfig = { url: "http://from-file:1" };
    const r = mergeConfig(cfg, {});
    expect(r.url).toBe("http://from-file:1");
    expect(r.sources.url).toBe("config");
  });

  it("OH_AM_DISABLE env wins over config.disabled", () => {
    const cfg: OhAmConfig = { disabled: ["learning"] };
    const r = mergeConfig(cfg, { OH_AM_DISABLE: "intent" });
    expect(r.disabled.has("intent")).toBe(true);
    expect(r.disabled.has("learning")).toBe(false); // env overwrote
    expect(r.sources.disabled).toBe("env");
  });

  it("config.disabled used when no env", () => {
    const cfg: OhAmConfig = { disabled: ["learning", "archive"] };
    const r = mergeConfig(cfg, {});
    expect(r.disabled.size).toBe(2);
    expect(r.disabled.has("learning")).toBe(true);
    expect(r.disabled.has("archive")).toBe(true);
    expect(r.sources.disabled).toBe("config");
  });

  it("OH_AM_MODE env wins over config.mode", () => {
    const cfg: OhAmConfig = { mode: "full" };
    const r = mergeConfig(cfg, { OH_AM_MODE: "mcp-only" });
    expect(r.mode).toBe("mcp-only");
    expect(r.sources.mode).toBe("env");
  });

  it("OH_AM_DEBUG=1 wins over config.debug=false", () => {
    const cfg: OhAmConfig = { debug: false };
    const r = mergeConfig(cfg, { OH_AM_DEBUG: "1" });
    expect(r.debug).toBe(true);
    expect(r.sources.debug).toBe("env");
  });
});
