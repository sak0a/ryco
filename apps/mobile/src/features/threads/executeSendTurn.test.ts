import type { EnvironmentApi, ModelSelection, ProjectId, ThreadId } from "@ryco/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("expo-crypto", () => ({ randomUUID: () => `id-${Math.random().toString(16).slice(2)}` }));

import { executeSendTurn, type ExecuteSendTurnInput } from "./executeSendTurn";

const THREAD_ID = "thread-1" as ThreadId;
const PROJECT_ID = "project-1" as ProjectId;

const modelSelection = { instanceId: "inst-1", model: "gpt-5", options: [] } as unknown as ModelSelection;

function baseInput(overrides: Partial<ExecuteSendTurnInput> = {}): {
  input: ExecuteSendTurnInput;
  dispatchCommand: ReturnType<typeof vi.fn>;
  clearDraft: ReturnType<typeof vi.fn>;
  restoreDraft: ReturnType<typeof vi.fn>;
  setThreadError: ReturnType<typeof vi.fn>;
} {
  const dispatchCommand = vi.fn(async (_command: unknown) => undefined);
  const clearDraft = vi.fn();
  const restoreDraft = vi.fn();
  const setThreadError = vi.fn();
  const input: ExecuteSendTurnInput = {
    api: { orchestration: { dispatchCommand } } as unknown as EnvironmentApi,
    thread: {
      threadId: THREAD_ID,
      isFirstMessage: true,
      isServerThread: true,
      isLocalDraftThread: false,
      activeThreadBranch: null,
      worktreePath: null,
      createdAt: "2026-07-24T00:00:00.000Z",
    },
    composer: {
      prompt: "hello world",
      images: [],
      selectedModelSelection: modelSelection,
      selectedModel: "gpt-5",
      hasSelectedModel: true,
    },
    project: { projectId: PROJECT_ID, projectCwd: "/repo", defaultModel: "gpt-5" },
    settings: { runtimeMode: "default" as never, interactionMode: "code" as never, tokenMode: "default" as never },
    title: "Thread title",
    clearDraft,
    restoreDraft,
    setThreadError,
    ...overrides,
  };
  return { input, dispatchCommand, clearDraft, restoreDraft, setThreadError };
}

describe("executeSendTurn", () => {
  it("clears the draft and dispatches thread.meta.update then thread.turn.start on a first server message", async () => {
    const { input, dispatchCommand, clearDraft } = baseInput();
    await executeSendTurn(input);

    expect(clearDraft).toHaveBeenCalledTimes(1);
    const types = dispatchCommand.mock.calls.map((call) => (call[0] as { type: string }).type);
    expect(types).toEqual(["thread.meta.update", "thread.turn.start"]);
    const start = dispatchCommand.mock.calls.find((c) => (c[0] as { type: string }).type === "thread.turn.start")![0] as { threadId: ThreadId };
    expect(start.threadId).toBe(THREAD_ID);
  });

  it("skips the title update for a non-first message", async () => {
    const { input, dispatchCommand } = baseInput({
      thread: {
        threadId: THREAD_ID,
        isFirstMessage: false,
        isServerThread: true,
        isLocalDraftThread: false,
        activeThreadBranch: null,
        worktreePath: null,
        createdAt: "2026-07-24T00:00:00.000Z",
      },
    });
    await executeSendTurn(input);
    const types = dispatchCommand.mock.calls.map((call) => (call[0] as { type: string }).type);
    expect(types).toEqual(["thread.turn.start"]);
  });

  it("rolls back the draft and records the error when dispatch fails", async () => {
    const { input, restoreDraft, setThreadError } = baseInput();
    (input.api.orchestration.dispatchCommand as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("network down"),
    );

    await executeSendTurn(input);

    expect(restoreDraft).toHaveBeenCalledWith({ prompt: "hello world", images: [] });
    expect(setThreadError).toHaveBeenLastCalledWith(THREAD_ID, "network down");
  });
});
