import { describe, expect, it } from "vitest";
import {
  buildBootstrapUpdates,
  detectProject,
} from "../../src/core/bootstrap.js";
import type { FileEditEvent, FileHistoryEntry } from "../../src/core/types.js";
import { buildLessonFromFileHistory } from "../../src/core/lessons.js";

describe("detectProject", () => {
  it("matches known langdy-student", () => {
    const d = detectProject("/Users/x/Documents/langdy-student-v3");
    expect(d.projectId).toBe("langdy-student");
    expect(d.stack).toContain("Next.js");
  });

  it("matches known langdy-figma-plugins", () => {
    const d = detectProject("/Users/x/work/langdy-figma-plugins");
    expect(d.projectId).toBe("langdy-figma-plugins");
  });

  it("falls back to basename", () => {
    const d = detectProject("/Users/x/some-random-repo");
    expect(d.projectId).toBe("some-random-repo");
    expect(d.stack).toEqual([]);
  });
});

describe("buildBootstrapUpdates", () => {
  it("returns no updates when no empties", () => {
    expect(buildBootstrapUpdates("/cwd", [])).toEqual([]);
  });

  it("fills all four core slots when empty", () => {
    const updates = buildBootstrapUpdates(
      "/Users/x/Documents/langdy-student-v3",
      ["persona", "project_context", "user_preferences", "tool_guidelines"],
    );
    expect(updates).toHaveLength(4);
    expect(updates.map((u) => u.label).sort()).toEqual([
      "persona",
      "project_context",
      "tool_guidelines",
      "user_preferences",
    ]);
  });

  it("skips pending_items / guidance / self_notes / session_patterns", () => {
    const updates = buildBootstrapUpdates("/cwd", [
      "pending_items",
      "guidance",
      "self_notes",
      "session_patterns",
    ]);
    expect(updates).toEqual([]);
  });

  it("injects detected project name into project_context", () => {
    const updates = buildBootstrapUpdates(
      "/Users/x/Documents/langdy-student-v3",
      ["project_context"],
    );
    expect(updates[0].content).toContain("langdy student app");
  });
});

function makeEntry(partial: Partial<FileHistoryEntry["data"]> = {}): FileHistoryEntry {
  return {
    sessionId: "ses_test",
    timestamp: "2026-08-07T00:00:00.000Z",
    data: { ...partial },
  };
}

describe("buildLessonFromFileHistory", () => {
  const edit: FileEditEvent = {
    filePath: "/repo/src/auth.ts",
    additions: 10,
    deletions: 5,
  };

  it("skips when no history", () => {
    const out = buildLessonFromFileHistory("/x.ts", [], edit);
    expect(out.shouldSave).toBe(false);
    expect(out.skipReason).toBe("no-file-history");
  });

  it("skips when edit is tiny", () => {
    const history = [makeEntry({ error: "TypeError" })];
    const out = buildLessonFromFileHistory(
      "/x.ts",
      history,
      { filePath: "/x.ts", additions: 1, deletions: 0 },
    );
    expect(out.shouldSave).toBe(false);
    expect(out.skipReason).toMatch(/edit-too-small/);
  });

  it("skips when history has no error signal", () => {
    const history = [makeEntry({ tool_output: "all good, working" })];
    const out = buildLessonFromFileHistory("/x.ts", history, edit);
    expect(out.shouldSave).toBe(false);
    expect(out.skipReason).toBe("no-error-signal-in-history");
  });

  it("saves when history shows error and edit is meaningful", () => {
    const history = [
      makeEntry({ tool_name: "bash", error: "TypeError: undefined is not a function" }),
      makeEntry({ tool_output: "fix applied" }),
    ];
    const out = buildLessonFromFileHistory("/x.ts", history, edit);
    expect(out.shouldSave).toBe(true);
    expect(out.content).toContain("x.ts");
    expect(out.content).toContain("occurrences");
    expect(out.duplicateQuery).toContain("x.ts");
  });

  it("captures korean error keywords", () => {
    const history = [makeEntry({ tool_output: "빌드 실패 — 에러 발생" })];
    const out = buildLessonFromFileHistory("/x.ts", history, edit);
    expect(out.shouldSave).toBe(true);
  });
});
