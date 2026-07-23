import {
  DEFAULT_MODEL,
  type AgentTokenMode,
  type ComposerSourceControlContext,
  type EnvironmentApi,
  type EnvironmentId,
  type ModelSelection,
  type ProjectId,
  type ProviderDriverKind,
  type ProviderInteractionMode,
  type RuntimeMode,
  type ServerProvider,
  type ThreadId,
} from "@ryco/contracts";
import { scopeThreadRef } from "@ryco/client-runtime/scoped";
import { createModelSelection } from "@ryco/shared/model";
import { truncate } from "@ryco/shared/String";
import { buildTemporaryWorktreeBranchName } from "@ryco/shared/git";

import type { ComposerImageAttachment, DraftId } from "../composerDraftStore";
import type { ChatMessage } from "../types";
import type { TerminalContextDraft } from "../lib/terminalContext";
import type { ChatComposerHandle } from "../components/chat/ChatComposer";
import type { ScopedThreadRef } from "@ryco/contracts";

type ComposerThreadTarget = ScopedThreadRef | DraftId;

import { appendTerminalContextsToPrompt, formatTerminalContextLabel } from "../lib/terminalContext";
import { collapseExpandedComposerCursor } from "../composer-logic";
import { newCommandId, newMessageId } from "../lib/utils";
import { runSendUndoWindow } from "./sendUndoController";
import { stackedThreadToast, toastManager } from "../components/ui/toast";
import {
  buildChatSendTitleSeed,
  buildExpiredTerminalContextToastCopy,
  cloneComposerImageForRetry,
  readFileAsDataUrl,
  refreshStaleSourceControlContexts,
  revokeUserMessagePreviewUrls,
} from "../components/ChatView.logic";

const IMAGE_ONLY_BOOTSTRAP_PROMPT =
  "[User attached one or more images without additional text. Respond using the conversation context and the attached image(s).]";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SendTurnComposerSnapshot {
  prompt: string;
  trimmedPrompt: string;
  images: ComposerImageAttachment[];
  sendableTerminalContexts: TerminalContextDraft[];
  sourceControlContexts: ComposerSourceControlContext[];
  selectedProvider: ProviderDriverKind;
  selectedModel: string;
  selectedProviderModels: ReadonlyArray<ServerProvider["models"][number]>;
  selectedPromptEffort: string | null;
  selectedModelSelection: ModelSelection;
  expiredTerminalContextCount: number;
}

export interface SendTurnThreadContext {
  threadId: ThreadId;
  isFirstMessage: boolean;
  isServerThread: boolean;
  isLocalDraftThread: boolean;
  activeThreadBranch: string | null;
  worktreePath: string | null;
  createdAt: string;
  projectId: ProjectId;
}

export interface SendTurnWorktreePlan {
  shouldMaterializeLegacyBranchWorktree: boolean;
  baseBranchForWorktree: string | null;
  shouldCreateWorktree: boolean;
}

export interface SendTurnSettings {
  runtimeMode: RuntimeMode;
  interactionMode: ProviderInteractionMode;
  tokenMode: AgentTokenMode;
}

export interface SendTurnProjectContext {
  projectId: ProjectId;
  projectCwd: string;
  defaultModelSelection: ModelSelection | null;
}

export interface SendTurnScrollDeps {
  scrollToEndBeforeOptimistic: () => Promise<void>;
}

export interface SendTurnUndoDeps {
  /** How long the undo affordance stays live before the turn auto-commits. */
  windowMs: number;
  /**
   * Present the undo affordance (e.g. a toast). Receives a `triggerUndo` callback
   * to wire to the Undo control, and returns an optional disposer run once the
   * window resolves. See `runSendUndoWindow`.
   */
  present: (controls: { triggerUndo: () => void }) => (() => void) | void;
}

export interface SendTurnComposerDraftDeps {
  composerDraftTarget: ComposerThreadTarget;
  environmentId: EnvironmentId;
  clearComposerDraftContent: (target: ComposerThreadTarget) => void;
  setComposerDraftTokenMode: (target: ComposerThreadTarget, mode: AgentTokenMode) => void;
  setComposerDraftPrompt: (target: ComposerThreadTarget, prompt: string) => void;
  addComposerDraftImages: (target: ComposerThreadTarget, images: ComposerImageAttachment[]) => void;
  setComposerDraftTerminalContexts: (
    target: ComposerThreadTarget,
    contexts: TerminalContextDraft[],
  ) => void;
  setDraftThreadContext: (
    target: ComposerThreadTarget,
    context: { tokenMode: AgentTokenMode },
  ) => void;
}

export interface SendTurnDispatchDeps {
  api: EnvironmentApi;
  beginLocalDispatch: (options: { preparingWorktree: boolean }) => void;
  resetLocalDispatch: () => void;
  setOptimisticUserMessages: (updater: (existing: ChatMessage[]) => ChatMessage[]) => void;
  setThreadError: (threadId: ThreadId, error: string | null) => void;
}

export interface SendTurnRollbackRefs {
  promptRef: { current: string };
  composerImagesRef: { current: ComposerImageAttachment[] };
  composerTerminalContextsRef: { current: TerminalContextDraft[] };
  sendInFlightRef: { current: boolean };
}

export interface SendTurnSourceControlFetcher {
  fetcher: (ctx: ComposerSourceControlContext) => Promise<ComposerSourceControlContext>;
}

export interface SendTurnPersistSettingsDeps {
  persistThreadSettingsForNextTurn: (input: {
    threadId: ThreadId;
    createdAt: string;
    modelSelection?: ModelSelection;
    runtimeMode: RuntimeMode;
    interactionMode: ProviderInteractionMode;
    tokenMode: AgentTokenMode;
  }) => Promise<void>;
}

export interface SendTurnReadComposer {
  readComposer: () => ChatComposerHandle | null;
}

export interface ExecuteChatSendTurnInput {
  composer: SendTurnComposerSnapshot;
  thread: SendTurnThreadContext;
  worktree: SendTurnWorktreePlan;
  settings: SendTurnSettings;
  project: SendTurnProjectContext;
  scroll: SendTurnScrollDeps;
  /** When present, hold the provider dispatch behind a short cancellable undo window. */
  undo?: SendTurnUndoDeps;
  draft: SendTurnComposerDraftDeps;
  dispatch: SendTurnDispatchDeps;
  refs: SendTurnRollbackRefs;
  sourceControl: SendTurnSourceControlFetcher;
  persistSettings: SendTurnPersistSettingsDeps;
  composerHandle: SendTurnReadComposer;
  formatOutgoingPrompt: (params: {
    provider: ProviderDriverKind;
    model: string | null;
    models: ReadonlyArray<ServerProvider["models"][number]>;
    effort: string | null;
    text: string;
  }) => string;
}

// ---------------------------------------------------------------------------
// Rollback
// ---------------------------------------------------------------------------

/** Remove a pending optimistic user message from the timeline, revoking its previews. */
export function removeOptimisticUserMessage(
  setOptimisticUserMessages: (updater: (existing: ChatMessage[]) => ChatMessage[]) => void,
  messageId: string,
): void {
  setOptimisticUserMessages((existing) => {
    const removed = existing.filter((m) => m.id === messageId);
    for (const m of removed) {
      revokeUserMessagePreviewUrls(m);
    }
    const next = existing.filter((m) => m.id !== messageId);
    return next.length === existing.length ? existing : next;
  });
}

export function rollbackSendTurn(input: {
  refs: SendTurnRollbackRefs;
  composerHandle: SendTurnReadComposer;
  dispatch: Pick<SendTurnDispatchDeps, "setOptimisticUserMessages">;
  draft: SendTurnComposerDraftDeps;
  messageId: string;
  promptSnapshot: string;
  imagesSnapshot: ComposerImageAttachment[];
  terminalContextsSnapshot: TerminalContextDraft[];
}): void {
  const {
    refs,
    composerHandle,
    dispatch,
    draft,
    messageId,
    promptSnapshot,
    imagesSnapshot,
    terminalContextsSnapshot,
  } = input;

  if (
    refs.promptRef.current.length !== 0 ||
    refs.composerImagesRef.current.length !== 0 ||
    refs.composerTerminalContextsRef.current.length !== 0
  ) {
    return;
  }

  removeOptimisticUserMessage(dispatch.setOptimisticUserMessages, messageId);

  refs.promptRef.current = promptSnapshot;
  const retryImages = imagesSnapshot.map(cloneComposerImageForRetry);
  refs.composerImagesRef.current = retryImages;
  refs.composerTerminalContextsRef.current = terminalContextsSnapshot;

  draft.setComposerDraftPrompt(draft.composerDraftTarget, promptSnapshot);
  draft.addComposerDraftImages(draft.composerDraftTarget, retryImages);
  draft.setComposerDraftTerminalContexts(draft.composerDraftTarget, terminalContextsSnapshot);

  composerHandle.readComposer()?.resetCursorState({
    cursor: collapseExpandedComposerCursor(promptSnapshot, promptSnapshot.length),
    prompt: promptSnapshot,
    detectTrigger: true,
  });
}

// ---------------------------------------------------------------------------
// Bootstrap building
// ---------------------------------------------------------------------------

export function buildSendTurnBootstrap(input: {
  isLocalDraftThread: boolean;
  baseBranchForWorktree: string | null;
  shouldMaterializeLegacyBranchWorktree: boolean;
  projectId: ProjectId;
  projectCwd: string;
  title: string;
  threadCreateModelSelection: ModelSelection;
  runtimeMode: RuntimeMode;
  interactionMode: ProviderInteractionMode;
  tokenMode: AgentTokenMode;
  activeThreadBranch: string | null;
  worktreePath: string | null;
  threadCreatedAt: string;
}):
  | {
      createThread?: {
        projectId: ProjectId;
        title: string;
        modelSelection: ModelSelection;
        runtimeMode: RuntimeMode;
        interactionMode: ProviderInteractionMode;
        tokenMode: AgentTokenMode;
        branch: string | null;
        worktreePath: string | null;
        createdAt: string;
      };
      prepareWorktree?: {
        projectCwd: string;
        baseBranch: string;
        branch?: string;
      };
      runSetupScript?: boolean;
    }
  | undefined {
  if (!input.isLocalDraftThread && !input.baseBranchForWorktree) {
    return undefined;
  }

  return {
    ...(input.isLocalDraftThread
      ? {
          createThread: {
            projectId: input.projectId,
            title: input.title,
            modelSelection: input.threadCreateModelSelection,
            runtimeMode: input.runtimeMode,
            interactionMode: input.interactionMode,
            tokenMode: input.tokenMode,
            branch: input.activeThreadBranch,
            worktreePath: input.worktreePath,
            createdAt: input.threadCreatedAt,
          },
        }
      : {}),
    ...(input.baseBranchForWorktree
      ? {
          prepareWorktree: {
            projectCwd: input.projectCwd,
            baseBranch: input.baseBranchForWorktree,
            ...(input.shouldMaterializeLegacyBranchWorktree
              ? {}
              : { branch: buildTemporaryWorktreeBranchName() }),
          },
          runSetupScript: true,
        }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// Core send turn
// ---------------------------------------------------------------------------

export async function executeChatSendTurn(input: ExecuteChatSendTurnInput): Promise<void> {
  const {
    composer,
    thread,
    worktree,
    settings,
    project,
    scroll,
    draft,
    dispatch,
    refs,
    sourceControl,
    persistSettings: persistSettingsDeps,
    composerHandle,
    formatOutgoingPrompt,
  } = input;

  const { api, beginLocalDispatch, resetLocalDispatch, setOptimisticUserMessages, setThreadError } =
    dispatch;

  refs.sendInFlightRef.current = true;
  beginLocalDispatch({ preparingWorktree: Boolean(worktree.baseBranchForWorktree) });

  const imagesSnapshot = [...composer.images];
  const terminalContextsSnapshot = [...composer.sendableTerminalContexts];
  const sourceControlSnapshot = [...composer.sourceControlContexts];

  const messageTextForSend = appendTerminalContextsToPrompt(
    composer.prompt,
    terminalContextsSnapshot,
  );
  const messageIdForSend = newMessageId();
  const messageCreatedAt = new Date().toISOString();
  const outgoingMessageText = formatOutgoingPrompt({
    provider: composer.selectedProvider,
    model: composer.selectedModel,
    models: composer.selectedProviderModels,
    effort: composer.selectedPromptEffort,
    text: messageTextForSend || IMAGE_ONLY_BOOTSTRAP_PROMPT,
  });

  const turnAttachmentsPromise = Promise.all(
    imagesSnapshot.map(async (image) => ({
      type: "image" as const,
      name: image.name,
      mimeType: image.mimeType,
      sizeBytes: image.sizeBytes,
      dataUrl: await readFileAsDataUrl(image.file),
    })),
  );

  const optimisticAttachments = imagesSnapshot.map((image) => ({
    type: "image" as const,
    id: image.id,
    name: image.name,
    mimeType: image.mimeType,
    sizeBytes: image.sizeBytes,
    previewUrl: image.previewUrl,
  }));

  // Scroll to end before optimistic message for auto-pin.
  await scroll.scrollToEndBeforeOptimistic();

  setOptimisticUserMessages((existing) => [
    ...existing,
    {
      id: messageIdForSend,
      role: "user",
      text: outgoingMessageText,
      ...(optimisticAttachments.length > 0 ? { attachments: optimisticAttachments } : {}),
      createdAt: messageCreatedAt,
      streaming: false,
    },
  ]);

  setThreadError(thread.threadId, null);
  draft.setComposerDraftTokenMode(
    scopeThreadRef(draft.environmentId, thread.threadId),
    settings.tokenMode,
  );
  if (thread.isLocalDraftThread) {
    draft.setDraftThreadContext(draft.composerDraftTarget, {
      tokenMode: settings.tokenMode,
    });
  }

  if (composer.expiredTerminalContextCount > 0) {
    const toastCopy = buildExpiredTerminalContextToastCopy(
      composer.expiredTerminalContextCount,
      "omitted",
    );
    toastManager.add(
      stackedThreadToast({
        type: "warning",
        title: toastCopy.title,
        description: toastCopy.description,
      }),
    );
  }

  // Clear composer
  refs.promptRef.current = "";
  draft.clearComposerDraftContent(draft.composerDraftTarget);
  draft.setComposerDraftTokenMode(draft.composerDraftTarget, settings.tokenMode);
  composerHandle.readComposer()?.resetCursorState();

  let turnStartSucceeded = false;
  let undone = false;
  await (async () => {
    let firstComposerImageName: string | null = null;
    if (imagesSnapshot.length > 0) {
      const firstComposerImage = imagesSnapshot[0];
      if (firstComposerImage) {
        firstComposerImageName = firstComposerImage.name;
      }
    }
    const title = truncate(
      buildChatSendTitleSeed({
        trimmedPrompt: composer.trimmedPrompt,
        firstImageName: firstComposerImageName,
        firstTerminalContextLabel:
          terminalContextsSnapshot.length > 0
            ? formatTerminalContextLabel(terminalContextsSnapshot[0]!)
            : null,
      }),
    );

    const defaultModel = project.defaultModelSelection?.model ?? null;
    const threadCreateModelSelection = createModelSelection(
      composer.selectedModelSelection.instanceId,
      composer.selectedModel || defaultModel || DEFAULT_MODEL,
      composer.selectedModelSelection.options,
    );

    const turnAttachments = await turnAttachmentsPromise;

    const freshSourceControlContexts = await refreshStaleSourceControlContexts(
      sourceControlSnapshot,
      sourceControl,
    );

    const bootstrap = buildSendTurnBootstrap({
      isLocalDraftThread: thread.isLocalDraftThread,
      baseBranchForWorktree: worktree.baseBranchForWorktree,
      shouldMaterializeLegacyBranchWorktree: worktree.shouldMaterializeLegacyBranchWorktree,
      projectId: project.projectId,
      projectCwd: project.projectCwd,
      title,
      threadCreateModelSelection,
      runtimeMode: settings.runtimeMode,
      interactionMode: settings.interactionMode,
      tokenMode: settings.tokenMode,
      activeThreadBranch: thread.activeThreadBranch,
      worktreePath: thread.worktreePath,
      threadCreatedAt: thread.createdAt,
    });

    // Short "undo send" window: hold the provider dispatch so the user can pull
    // the message back before the turn is picked up. Skipped (immediate dispatch)
    // when no `undo` config is supplied — e.g. queued auto-sends on quiescence.
    if (input.undo && input.undo.windowMs > 0) {
      const outcome = await runSendUndoWindow({
        windowMs: input.undo.windowMs,
        present: input.undo.present,
      });
      if (outcome === "undone") {
        undone = true;
        return;
      }
    }

    // Server-side writes derived from this message must only run once the send
    // commits; otherwise an undone first send leaves orphan title/settings.
    if (thread.isFirstMessage && thread.isServerThread) {
      await api.orchestration.dispatchCommand({
        type: "thread.meta.update",
        commandId: newCommandId(),
        threadId: thread.threadId,
        title,
      });
    }

    if (thread.isServerThread) {
      await persistSettingsDeps.persistThreadSettingsForNextTurn({
        threadId: thread.threadId,
        createdAt: messageCreatedAt,
        ...(composer.selectedModel ? { modelSelection: composer.selectedModelSelection } : {}),
        runtimeMode: settings.runtimeMode,
        interactionMode: settings.interactionMode,
        tokenMode: settings.tokenMode,
      });
    }

    beginLocalDispatch({ preparingWorktree: false });
    await api.orchestration.dispatchCommand({
      type: "thread.turn.start",
      commandId: newCommandId(),
      threadId: thread.threadId,
      message: {
        messageId: messageIdForSend,
        role: "user",
        text: outgoingMessageText,
        attachments: turnAttachments,
      },
      modelSelection: composer.selectedModelSelection,
      titleSeed: title,
      runtimeMode: settings.runtimeMode,
      interactionMode: settings.interactionMode,
      tokenMode: settings.tokenMode,
      ...(bootstrap ? { bootstrap } : {}),
      ...(freshSourceControlContexts.length > 0
        ? { sourceControlContexts: freshSourceControlContexts }
        : {}),
      createdAt: messageCreatedAt,
    });
    turnStartSucceeded = true;
  })().catch(async (err: unknown) => {
    rollbackSendTurn({
      refs,
      composerHandle,
      dispatch: { setOptimisticUserMessages },
      draft,
      messageId: messageIdForSend,
      promptSnapshot: composer.prompt,
      imagesSnapshot,
      terminalContextsSnapshot,
    });
    setThreadError(thread.threadId, err instanceof Error ? err.message : "Failed to send message.");
  });

  if (undone) {
    // Explicit undo always pulls the optimistic bubble back out of the timeline...
    removeOptimisticUserMessage(setOptimisticUserMessages, messageIdForSend);
    // ...and restores the composer content when the user hasn't typed anything new
    // in the window (the guard inside `rollbackSendTurn` protects fresh input).
    rollbackSendTurn({
      refs,
      composerHandle,
      dispatch: { setOptimisticUserMessages },
      draft,
      messageId: messageIdForSend,
      promptSnapshot: composer.prompt,
      imagesSnapshot,
      terminalContextsSnapshot,
    });
  }

  refs.sendInFlightRef.current = false;
  if (!turnStartSucceeded) {
    resetLocalDispatch();
  }
}
