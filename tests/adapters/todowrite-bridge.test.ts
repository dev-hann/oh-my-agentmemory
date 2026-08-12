import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the client BEFORE importing the hook so the hook picks up our stubs.
vi.mock("../../src/adapters/opencode/client.js", () => ({
  createAction: vi.fn(),
  updateAction: vi.fn(),
  createObservation: vi.fn().mockResolvedValue(true),
}));

import { onTodowrite, _resetStateForTests } from "../../src/adapters/opencode/hooks/todowrite.js";
import { createAction, updateAction, createObservation } from "../../src/adapters/opencode/client.js";
import type { TodoEntry } from "../../src/core/types.js";

const mockedCreateAction = vi.mocked(createAction);
const mockedUpdateAction = vi.mocked(updateAction);
const mockedCreateObservation = vi.mocked(createObservation);

beforeEach(() => {
  _resetStateForTests();
  vi.clearAllMocks();
});

afterEach(() => {
  _resetStateForTests();
});

describe("onTodowrite — priority filter", () => {
  it("creates actions for high-priority todos only", async () => {
    mockedCreateAction.mockResolvedValueOnce("act_1");

    const todos: TodoEntry[] = [
      { content: "High task", status: "pending", priority: "high" },
      { content: "Med task", status: "pending", priority: "medium" },
      { content: "Low task", status: "pending", priority: "low" },
    ];

    await onTodowrite({ sessionId: "ses1", project: null, todos });

    expect(mockedCreateAction).toHaveBeenCalledTimes(1);
    expect(mockedCreateAction).toHaveBeenCalledWith({
      title: "High task",
      description: expect.stringContaining("high"),
      priority: 8,
      tags: "from-todo",
      project: undefined,
    });
  });

  it("records skipped medium/low todos in observation", async () => {
    mockedCreateAction.mockResolvedValueOnce("act_x");

    const todos: TodoEntry[] = [
      { content: "High", status: "pending", priority: "high" },
      { content: "Med", status: "pending", priority: "medium" },
      { content: "Low", status: "pending", priority: "low" },
    ];

    await onTodowrite({ sessionId: "ses1", project: null, todos });

    expect(mockedCreateObservation).toHaveBeenCalledTimes(1);
    const obs = mockedCreateObservation.mock.calls[0][0];
    expect(obs.data.bridgeableHigh).toBe(1);
    expect(obs.data.skippedNonHigh).toBe(2);
    expect(obs.data.skippedContents).toEqual(["Med", "Low"]);
  });

  it("skips ALL todos when none are high priority", async () => {
    const todos: TodoEntry[] = [
      { content: "Med", status: "pending", priority: "medium" },
      { content: "Low", status: "pending", priority: "low" },
    ];

    await onTodowrite({ sessionId: "ses1", project: null, todos });

    expect(mockedCreateAction).not.toHaveBeenCalled();
    // Observation still fires to record the skipped filter decision.
    expect(mockedCreateObservation).toHaveBeenCalledTimes(1);
    const obs = mockedCreateObservation.mock.calls[0][0];
    expect(obs.data.bridgeableHigh).toBe(0);
    expect(obs.data.skippedNonHigh).toBe(2);
  });
});

describe("onTodowrite — bridge logic", () => {
  it("creates actions for new pending high-priority todos", async () => {
    mockedCreateAction.mockResolvedValueOnce("act_1");
    mockedCreateAction.mockResolvedValueOnce("act_2");

    const todos: TodoEntry[] = [
      { content: "Task A", status: "pending", priority: "high" },
      { content: "Task B", status: "pending", priority: "high" },
    ];

    await onTodowrite({ sessionId: "ses1", project: null, todos });

    expect(mockedCreateAction).toHaveBeenCalledTimes(2);
    expect(mockedCreateAction).toHaveBeenCalledWith({
      title: "Task A",
      description: expect.stringContaining("high"),
      priority: 8,
      tags: "from-todo",
      project: undefined,
    });
    expect(mockedCreateAction).toHaveBeenCalledWith({
      title: "Task B",
      description: expect.stringContaining("high"),
      priority: 8,
      tags: "from-todo",
      project: undefined,
    });

    // Pending todos do not trigger an immediate update — only non-pending.
    expect(mockedUpdateAction).not.toHaveBeenCalled();
    expect(mockedCreateObservation).toHaveBeenCalledTimes(1);
  });

  it("creates action + immediately syncs status for non-pending new high-priority todo", async () => {
    mockedCreateAction.mockResolvedValueOnce("act_active");

    const todos: TodoEntry[] = [
      { content: "In-flight task", status: "in_progress", priority: "high" },
    ];

    await onTodowrite({ sessionId: "ses1", project: null, todos });

    expect(mockedCreateAction).toHaveBeenCalledTimes(1);
    expect(mockedUpdateAction).toHaveBeenCalledTimes(1);
    expect(mockedUpdateAction).toHaveBeenCalledWith("act_active", {
      status: "active",
    });
  });

  it("updates action when high-priority todo transitions to completed", async () => {
    // First call: create the todo as pending.
    mockedCreateAction.mockResolvedValueOnce("act_done");
    await onTodowrite({
      sessionId: "ses1",
      project: null,
      todos: [{ content: "Task", status: "pending", priority: "high" }],
    });

    vi.clearAllMocks();

    // Second call: same todo, now completed.
    await onTodowrite({
      sessionId: "ses1",
      project: null,
      todos: [{ content: "Task", status: "completed", priority: "high" }],
    });

    expect(mockedCreateAction).not.toHaveBeenCalled();
    expect(mockedUpdateAction).toHaveBeenCalledTimes(1);
    expect(mockedUpdateAction).toHaveBeenCalledWith("act_done", {
      status: "done",
      result: "todo marked completed via todowrite",
    });
  });

  it("no-op when high-priority todo is unchanged", async () => {
    mockedCreateAction.mockResolvedValueOnce("act_x");
    await onTodowrite({
      sessionId: "ses1",
      project: null,
      todos: [{ content: "Stable", status: "pending", priority: "high" }],
    });

    vi.clearAllMocks();

    await onTodowrite({
      sessionId: "ses1",
      project: null,
      todos: [{ content: "Stable", status: "pending", priority: "high" }],
    });

    expect(mockedCreateAction).not.toHaveBeenCalled();
    expect(mockedUpdateAction).not.toHaveBeenCalled();
    // Observation only fires when changes occurred OR non-high todos were skipped.
    expect(mockedCreateObservation).not.toHaveBeenCalled();
  });

  it("handles createAction failure gracefully", async () => {
    mockedCreateAction.mockResolvedValue(null);

    await onTodowrite({
      sessionId: "ses1",
      project: null,
      todos: [{ content: "Doomed", status: "pending", priority: "high" }],
    });

    expect(mockedCreateAction).toHaveBeenCalledTimes(1);
    expect(mockedUpdateAction).not.toHaveBeenCalled();
    // Observation still fires to record the failure.
    expect(mockedCreateObservation).toHaveBeenCalledTimes(1);
    const obsArgs = mockedCreateObservation.mock.calls[0][0];
    expect(obsArgs.data.failed).toBe(1);
    const failedDetails = obsArgs.data.failedDetails as Array<{ content: string; reason: string }>;
    expect(failedDetails[0].content).toBe("Doomed");
  });

  it("matches high-priority todos by content across calls", async () => {
    mockedCreateAction.mockResolvedValueOnce("act_match");
    await onTodowrite({
      sessionId: "ses_match",
      project: null,
      todos: [{ content: "Same text", status: "pending", priority: "high" }],
    });

    vi.clearAllMocks();
    mockedUpdateAction.mockResolvedValue(true);

    // Different status, same content → update, not create.
    await onTodowrite({
      sessionId: "ses_match",
      project: null,
      todos: [{ content: "Same text", status: "in_progress", priority: "high" }],
    });

    expect(mockedCreateAction).not.toHaveBeenCalled();
    expect(mockedUpdateAction).toHaveBeenCalledTimes(1);
    expect(mockedUpdateAction).toHaveBeenCalledWith("act_match", {
      status: "active",
    });
  });

  it("tracks sessions independently", async () => {
    mockedCreateAction.mockResolvedValueOnce("act_a");
    await onTodowrite({
      sessionId: "ses_alpha",
      project: null,
      todos: [{ content: "Same text", status: "pending", priority: "high" }],
    });

    mockedCreateAction.mockResolvedValueOnce("act_b");
    await onTodowrite({
      sessionId: "ses_beta",
      project: null,
      todos: [{ content: "Same text", status: "pending", priority: "high" }],
    });

    // Same content in different session → still created (state is per-session).
    expect(mockedCreateAction).toHaveBeenCalledTimes(2);
  });

  it("does not track medium-priority todos across calls even if they later become high", async () => {
    // First call: todo is medium — not tracked.
    await onTodowrite({
      sessionId: "ses1",
      project: null,
      todos: [{ content: "Promoted", status: "pending", priority: "medium" }],
    });

    vi.clearAllMocks();

    // Second call: same content, now high priority.
    mockedCreateAction.mockResolvedValueOnce("act_promoted");
    await onTodowrite({
      sessionId: "ses1",
      project: null,
      todos: [{ content: "Promoted", status: "pending", priority: "high" }],
    });

    // Medium → high transition is treated as new (state was never tracked for medium).
    expect(mockedCreateAction).toHaveBeenCalledTimes(1);
  });
});
