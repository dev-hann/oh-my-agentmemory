import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the client BEFORE importing the deleter so it picks up our stubs.
vi.mock("../../src/adapters/opencode/client.js", () => ({
  forgetObservations: vi.fn(),
  summarizeSession: vi.fn().mockResolvedValue(true),
}));

// Mock the runner's writeReport so no real files are touched.
vi.mock("../../src/adapters/opencode/compaction-runner.js", () => ({
  writeReport: vi.fn().mockResolvedValue(undefined),
  reportExists: vi.fn().mockResolvedValue(false),
}));

import { deleteDroppedObservations, deletionEnabled } from "../../src/adapters/opencode/compaction-deleter.js";
import { forgetObservations, summarizeSession } from "../../src/adapters/opencode/client.js";
import { writeReport } from "../../src/adapters/opencode/compaction-runner.js";
import type { CompactionConfig } from "../../src/core/config-types.js";
import type { CompactionResult } from "../../src/core/compaction.js";

const mockedForget = vi.mocked(forgetObservations);
const mockedSummarize = vi.mocked(summarizeSession);
const mockedWriteReport = vi.mocked(writeReport);

const CFG: CompactionConfig = { delete: true, outputDir: "/tmp/oh-am-test" };

function makeResult(verdicts: CompactionResult["verdicts"]): CompactionResult {
  return {
    sessionId: "ses_test",
    project: null,
    goal: "g",
    scoredCount: verdicts.filter((v) => v.reason === "jev").length,
    errorCount: 0,
    keptCount: verdicts.filter((v) => v.kept).length,
    droppedCount: verdicts.filter((v) => !v.kept).length,
    verdicts,
    createdAt: "2026-10-02T00:00:00Z",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.OH_AM_COMPACTION_DELETE;
});

describe("deletionEnabled", () => {
  it("follows config by default", () => {
    expect(deletionEnabled({ delete: true })).toBe(true);
    expect(deletionEnabled({ delete: false })).toBe(false);
    expect(deletionEnabled({})).toBe(true); // default on
  });

  it("env off overrides config on", () => {
    process.env.OH_AM_COMPACTION_DELETE = "off";
    expect(deletionEnabled({ delete: true })).toBe(false);
  });

  it("env on overrides config off", () => {
    process.env.OH_AM_COMPACTION_DELETE = "on";
    expect(deletionEnabled({ delete: false })).toBe(true);
  });
});

describe("deleteDroppedObservations", () => {
  it("deletes drop verdicts, stamps deletedAt, rewrites report, re-summarizes", async () => {
    mockedForget.mockResolvedValueOnce(true);
    const result = makeResult([
      { id: "keep1", keepCall: 0.8, importance: 1, kept: true, guarded: false, reason: "jev" },
      { id: "drop1", keepCall: 0.2, importance: 1, kept: false, guarded: false, reason: "jev" },
      { id: "drop2", keepCall: null, importance: 0, kept: false, guarded: false, reason: "empty" },
    ]);

    const n = await deleteDroppedObservations(result, CFG);

    expect(n).toBe(2);
    expect(mockedForget).toHaveBeenCalledWith("ses_test", ["drop1", "drop2"]);
    expect(result.verdicts[1].deletedAt).toBeTruthy();
    expect(result.verdicts[2].deletedAt).toBeTruthy();
    expect(result.verdicts[0].deletedAt).toBeUndefined();
    expect(mockedWriteReport).toHaveBeenCalledTimes(1);
    expect(mockedSummarize).toHaveBeenCalledWith("ses_test");
  });

  it("never deletes guarded verdicts (they are kept by construction)", async () => {
    const result = makeResult([
      { id: "guard1", keepCall: 0.01, importance: 5, kept: true, guarded: true, reason: "jev" },
    ]);

    const n = await deleteDroppedObservations(result, CFG);

    expect(n).toBe(0);
    expect(mockedForget).not.toHaveBeenCalled();
  });

  it("skips already-deleted verdicts (retry idempotence)", async () => {
    mockedForget.mockResolvedValueOnce(true);
    const result = makeResult([
      { id: "done", keepCall: 0.2, importance: 1, kept: false, guarded: false, reason: "jev", deletedAt: "2026-10-01T00:00:00Z" },
      { id: "pending", keepCall: 0.2, importance: 1, kept: false, guarded: false, reason: "jev" },
    ]);

    const n = await deleteDroppedObservations(result, CFG);

    expect(n).toBe(1);
    expect(mockedForget).toHaveBeenCalledWith("ses_test", ["pending"]);
  });

  it("returns 0 without side effects when deletion is disabled", async () => {
    const result = makeResult([
      { id: "drop1", keepCall: 0.2, importance: 1, kept: false, guarded: false, reason: "jev" },
    ]);

    const n = await deleteDroppedObservations(result, { delete: false });

    expect(n).toBe(0);
    expect(mockedForget).not.toHaveBeenCalled();
    expect(result.verdicts[0].deletedAt).toBeUndefined();
  });

  it("fail-open: API failure leaves verdicts unmarked for retry", async () => {
    mockedForget.mockResolvedValue(false);
    const result = makeResult([
      { id: "drop1", keepCall: 0.2, importance: 1, kept: false, guarded: false, reason: "jev" },
    ]);

    const n = await deleteDroppedObservations(result, CFG);

    expect(n).toBe(0);
    expect(result.verdicts[0].deletedAt).toBeUndefined();
    expect(mockedWriteReport).not.toHaveBeenCalled();
    expect(mockedSummarize).not.toHaveBeenCalled();
  });

  it("no-op when nothing is droppable", async () => {
    const result = makeResult([
      { id: "keep1", keepCall: 0.8, importance: 1, kept: true, guarded: false, reason: "jev" },
    ]);

    const n = await deleteDroppedObservations(result, CFG);

    expect(n).toBe(0);
    expect(mockedForget).not.toHaveBeenCalled();
  });
});
