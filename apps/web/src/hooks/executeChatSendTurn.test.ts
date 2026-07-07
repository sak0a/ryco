import {
  DEFAULT_MODEL,
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@ryco/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { DraftId } from "../composerDraftStore";
import type { ChatMessage } from "../types";
import {
  buildSendTurnBootstrap,
  executeChatSendTurn,
  rollbackSendTurn,
} from "./executeChatSendTurn";

// ---------------------------------------------------------------------------
// rollbackSendTurn
// ---------------------------------------------------------------------------

describe("rollbackSendTurn", () => {
  function makeRefs() {
    return {
      promptRef: { current: "" },
      composerImagesRef: { current: [] as unknown[] },
      composerTerminalContextsRef: { current: [] as unknown[] },
      sendInFlightRef: { current: false },
    };
  }

  function makeDraftDeps() {
    return {
      composerDraftTarget: DraftId.make("draft-1"),
      environmentId: EnvironmentId.make("env-1"),
      clearComposerDraftContent: vi.fn(),
      setComposerDraftTokenMode: vi.fn(),
      setComposerDraftPrompt: vi.fn(),
      addComposerDraftImages: vi.fn(),
      setComposerDraftTerminalContexts: vi.fn(),
      setDraftThreadContext: vi.fn(),
    };
  }

  it("restores prompt, images, and terminal contexts when composer is empty", () => {
    const refs = makeRefs();
    const draft = makeDraftDeps();
    const resetCursorState = vi.fn();
    const composerHandle = {
      readComposer: () => ({ resetCursorState }) as never,
    };
    const setOptimisticUserMessages = vi.fn();

    const promptSnapshot = "Fix the bug";
    const imagesSnapshot = [
      {
        id: "img-1",
        name: "shot.png",
        previewUrl: "data:image/png;base64,abc",
        file: new File([], "shot.png"),
        mimeType: "image/png",
        sizeBytes: 100,
      },
    ] as never[];
    const terminalContextsSnapshot = [
      {
        id: "ctx-1",
        text: "some output",
        threadId: "t1",
        terminalId: "default",
        terminalLabel: "Terminal",
        lineStart: 1,
        lineEnd: 1,
        createdAt: "2026-06-14T00:00:00Z",
      },
    ] as never[];

    rollbackSendTurn({
      refs: refs as never,
      composerHandle,
      dispatch: { setOptimisticUserMessages },
      draft,
      messageId: "msg-1",
      promptSnapshot,
      imagesSnapshot,
      terminalContextsSnapshot,
    });

    expect(refs.promptRef.current).toBe("Fix the bug");
    expect(refs.composerTerminalContextsRef.current).toEqual(terminalContextsSnapshot);
    expect(draft.setComposerDraftPrompt).toHaveBeenCalledWith(
      DraftId.make("draft-1"),
      "Fix the bug",
    );
    expect(draft.addComposerDraftImages).toHaveBeenCalledTimes(1);
    expect(draft.setComposerDraftTerminalContexts).toHaveBeenCalledWith(
      DraftId.make("draft-1"),
      terminalContextsSnapshot,
    );
    expect(resetCursorState).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "Fix the bug", detectTrigger: true }),
    );
    expect(setOptimisticUserMessages).toHaveBeenCalledTimes(1);
  });

  it("skips rollback when the composer is not empty (user typed new content)", () => {
    const refs = makeRefs();
    refs.promptRef.current = "New content";
    const draft = makeDraftDeps();
    const composerHandle = { readComposer: () => null };
    const setOptimisticUserMessages = vi.fn();

    rollbackSendTurn({
      refs: refs as never,
      composerHandle,
      dispatch: { setOptimisticUserMessages },
      draft,
      messageId: "msg-1",
      promptSnapshot: "Old prompt",
      imagesSnapshot: [],
      terminalContextsSnapshot: [],
    });

    expect(setOptimisticUserMessages).not.toHaveBeenCalled();
    expect(draft.setComposerDraftPrompt).not.toHaveBeenCalled();
  });

  it("removes the optimistic message from the list", () => {
    const refs = makeRefs();
    const draft = makeDraftDeps();
    const composerHandle = { readComposer: () => null };
    let captured: ChatMessage[] = [];
    const setOptimisticUserMessages = vi.fn(
      (updater: (existing: ChatMessage[]) => ChatMessage[]) => {
        captured = updater([
          {
            id: MessageId.make("msg-1"),
            role: "user",
            text: "Hello",
            streaming: false,
            createdAt: "2026-01-01T00:00:00Z",
          },
          {
            id: MessageId.make("msg-2"),
            role: "user",
            text: "World",
            streaming: false,
            createdAt: "2026-01-01T00:01:00Z",
          },
        ]);
      },
    );

    rollbackSendTurn({
      refs: refs as never,
      composerHandle,
      dispatch: { setOptimisticUserMessages },
      draft,
      messageId: "msg-1",
      promptSnapshot: "Hello",
      imagesSnapshot: [],
      terminalContextsSnapshot: [],
    });

    expect(captured).toEqual([
      {
        id: MessageId.make("msg-2"),
        role: "user",
        text: "World",
        streaming: false,
        createdAt: "2026-01-01T00:01:00Z",
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// buildSendTurnBootstrap
// ---------------------------------------------------------------------------

describe("buildSendTurnBootstrap", () => {
  const baseInput = {
    projectId: ProjectId.make("project-1"),
    projectCwd: "/tmp/project",
    title: "Fix something",
    threadCreateModelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: DEFAULT_MODEL,
    },
    runtimeMode: "full-access" as const,
    interactionMode: "default" as const,
    tokenMode: "balanced" as const,
    activeThreadBranch: "main",
    worktreePath: null,
    threadCreatedAt: "2026-06-14T00:00:00Z",
  };

  it("returns undefined when neither draft nor worktree", () => {
    expect(
      buildSendTurnBootstrap({
        ...baseInput,
        isLocalDraftThread: false,
        baseBranchForWorktree: null,
        shouldMaterializeLegacyBranchWorktree: false,
      }),
    ).toBeUndefined();
  });

  it("returns createThread for local draft threads", () => {
    const result = buildSendTurnBootstrap({
      ...baseInput,
      isLocalDraftThread: true,
      baseBranchForWorktree: null,
      shouldMaterializeLegacyBranchWorktree: false,
    });

    expect(result).toBeDefined();
    expect(result?.createThread).toEqual({
      projectId: baseInput.projectId,
      title: baseInput.title,
      modelSelection: baseInput.threadCreateModelSelection,
      runtimeMode: baseInput.runtimeMode,
      interactionMode: baseInput.interactionMode,
      tokenMode: baseInput.tokenMode,
      branch: "main",
      worktreePath: null,
      createdAt: baseInput.threadCreatedAt,
    });
    expect(result?.prepareWorktree).toBeUndefined();
  });

  it("returns prepareWorktree with generated branch for new worktrees", () => {
    const result = buildSendTurnBootstrap({
      ...baseInput,
      isLocalDraftThread: true,
      baseBranchForWorktree: "main",
      shouldMaterializeLegacyBranchWorktree: false,
    });

    expect(result?.prepareWorktree?.projectCwd).toBe("/tmp/project");
    expect(result?.prepareWorktree?.baseBranch).toBe("main");
    expect(result?.prepareWorktree?.branch).toBeDefined();
    expect(result?.runSetupScript).toBe(true);
  });

  it("skips generated branch name for legacy worktree materialization", () => {
    const result = buildSendTurnBootstrap({
      ...baseInput,
      isLocalDraftThread: false,
      baseBranchForWorktree: "feature/foo",
      shouldMaterializeLegacyBranchWorktree: true,
    });

    expect(result?.prepareWorktree?.baseBranch).toBe("feature/foo");
    expect(result?.prepareWorktree?.branch).toBeUndefined();
    expect(result?.createThread).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// executeChatSendTurn — scroll-to-bottom on send (feature 01)
// ---------------------------------------------------------------------------

describe("executeChatSendTurn", () => {
  it("scrolls to the bottom before appending the optimistic message on send", async () => {
    // Records the observable side-effect order so we can assert the timeline is
    // pinned to the bottom *before* the user's message is inserted.
    const order: string[] = [];
    const scrollToEndBeforeOptimistic = vi.fn(async () => {
      order.push("scroll");
    });
    const setOptimisticUserMessages = vi.fn(() => {
      order.push("optimistic");
    });
    const dispatchCommand = vi.fn(async () => {
      order.push("dispatch");
    });

    await executeChatSendTurn({
      composer: {
        prompt: "Hello there",
        trimmedPrompt: "Hello there",
        images: [],
        sendableTerminalContexts: [],
        sourceControlContexts: [],
        selectedProvider: ProviderDriverKind.make("codex"),
        selectedModel: DEFAULT_MODEL,
        selectedProviderModels: [],
        selectedPromptEffort: null,
        selectedModelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: DEFAULT_MODEL,
        },
        expiredTerminalContextCount: 0,
      },
      thread: {
        threadId: ThreadId.make("thread-1"),
        isFirstMessage: false,
        isServerThread: true,
        isLocalDraftThread: false,
        activeThreadBranch: null,
        worktreePath: null,
        createdAt: "2026-06-14T00:00:00Z",
        projectId: ProjectId.make("project-1"),
      },
      worktree: {
        shouldMaterializeLegacyBranchWorktree: false,
        baseBranchForWorktree: null,
        shouldCreateWorktree: false,
      },
      settings: { runtimeMode: "full-access", interactionMode: "default", tokenMode: "balanced" },
      project: {
        projectId: ProjectId.make("project-1"),
        projectCwd: "/tmp/project",
        defaultModelSelection: null,
      },
      scroll: { scrollToEndBeforeOptimistic },
      // No `undo` config: this send dispatches immediately (matching the assertion order).
      draft: {
        composerDraftTarget: DraftId.make("draft-1"),
        environmentId: EnvironmentId.make("env-1"),
        clearComposerDraftContent: vi.fn(),
        setComposerDraftTokenMode: vi.fn(),
        setComposerDraftPrompt: vi.fn(),
        addComposerDraftImages: vi.fn(),
        setComposerDraftTerminalContexts: vi.fn(),
        setDraftThreadContext: vi.fn(),
      },
      dispatch: {
        api: { orchestration: { dispatchCommand } } as never,
        beginLocalDispatch: vi.fn(),
        resetLocalDispatch: vi.fn(),
        setOptimisticUserMessages,
        setThreadError: vi.fn(),
      },
      refs: {
        promptRef: { current: "" },
        composerImagesRef: { current: [] },
        composerTerminalContextsRef: { current: [] },
        sendInFlightRef: { current: false },
      } as never,
      sourceControl: { fetcher: vi.fn(async (ctx) => ctx) },
      persistSettings: { persistThreadSettingsForNextTurn: vi.fn(async () => {}) },
      composerHandle: { readComposer: () => null },
      formatOutgoingPrompt: ({ text }) => text,
    });

    expect(scrollToEndBeforeOptimistic).toHaveBeenCalledTimes(1);
    expect(setOptimisticUserMessages).toHaveBeenCalledTimes(1);
    expect(dispatchCommand).toHaveBeenCalledTimes(1);
    // Scroll pins to the bottom, then the optimistic message is inserted, then dispatched.
    expect(order).toEqual(["scroll", "optimistic", "dispatch"]);
    expect(dispatchCommand).toHaveBeenCalledWith(
      expect.objectContaining({ type: "thread.turn.start" }),
    );
  });
});
