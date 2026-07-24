import type {
  AgentTokenMode,
  EnvironmentApi,
  ModelSelection,
  ProjectId,
  ProviderInteractionMode,
  RuntimeMode,
  ThreadId,
} from "@ryco/contracts";
import {
  IMAGE_ONLY_BOOTSTRAP_PROMPT,
  buildSendTurnBootstrap,
  buildSendTurnDispatchAttachment,
  commitSendTurnDispatch,
  resolveThreadCreateModelSelection,
} from "@ryco/client-runtime/state/composer";

import { mobileAttachmentCodec } from "../../platform/attachmentCodec";
import { newCommandId, newMessageId } from "../../lib/ids";
import type { MobileComposerImageAttachment } from "../../state/composerImageHydration";

// §2.3 pt5 / send pipeline. Mirrors apps/web/src/hooks/executeChatSendTurn.ts but
// omits the web-only pieces (blob revocation, undo window, ChatComposerHandle
// cursor, toasts, terminal/source-control contexts). The ordered server writes
// (thread.meta.update on the first server-thread message → next-turn settings →
// thread.turn.start) stay in the runtime's commitSendTurnDispatch — no forked
// send logic. persistThreadSettingsForNextTurn is a no-op for the MVP (§3-13).

export interface ExecuteSendTurnInput {
  readonly api: EnvironmentApi;
  readonly thread: {
    readonly threadId: ThreadId;
    readonly isFirstMessage: boolean;
    readonly isServerThread: boolean;
    readonly isLocalDraftThread: boolean;
    readonly activeThreadBranch: string | null;
    readonly worktreePath: string | null;
    readonly createdAt: string;
  };
  readonly composer: {
    readonly prompt: string;
    readonly images: ReadonlyArray<MobileComposerImageAttachment>;
    readonly selectedModelSelection: ModelSelection;
    readonly selectedModel: string;
    readonly hasSelectedModel: boolean;
  };
  readonly project: {
    readonly projectId: ProjectId;
    readonly projectCwd: string;
    readonly defaultModel: string | null;
  };
  readonly settings: {
    readonly runtimeMode: RuntimeMode;
    readonly interactionMode: ProviderInteractionMode;
    readonly tokenMode: AgentTokenMode;
  };
  readonly title: string;
  /** Optimistically clears the composer draft before dispatch. */
  readonly clearDraft: () => void;
  /** Restores the snapshotted prompt + images if the dispatch fails. */
  readonly restoreDraft: (input: {
    readonly prompt: string;
    readonly images: ReadonlyArray<MobileComposerImageAttachment>;
  }) => void;
  readonly setThreadError: (threadId: ThreadId, error: string | null) => void;
  readonly beginLocalDispatch?: (options: { readonly preparingWorktree: boolean }) => void;
}

/**
 * Returns true when the turn was dispatched, false when it failed (the caller —
 * e.g. the composer — must keep the user's input on false; web
 * executeChatSendTurn restores the prompt via rollbackSendTurn on failure).
 */
export async function executeSendTurn(input: ExecuteSendTurnInput): Promise<boolean> {
  const promptSnapshot = input.composer.prompt;
  const imagesSnapshot = [...input.composer.images];
  const messageId = newMessageId();
  const createdAt = new Date().toISOString();
  const outgoingMessageText = promptSnapshot.trim() || IMAGE_ONLY_BOOTSTRAP_PROMPT;

  try {
    // Attachment-neutral send path: encode each RN uri/bytes to the outgoing
    // turn attachment (no DOM File).
    const turnAttachments = await Promise.all(
      imagesSnapshot.map(async (image) =>
        buildSendTurnDispatchAttachment({
          attachment: await mobileAttachmentCodec.encode({
            id: image.id,
            mime: image.mimeType,
            size: image.sizeBytes,
            uri: image.previewUrl,
          }),
          name: image.name,
        }),
      ),
    );

    // Optimistic: clear the draft now; on failure it is restored below.
    input.clearDraft();
    input.setThreadError(input.thread.threadId, null);

    const threadCreateModelSelection = resolveThreadCreateModelSelection({
      selectedModelSelection: input.composer.selectedModelSelection,
      selectedModel: input.composer.selectedModel,
      defaultModel: input.project.defaultModel,
    });

    const bootstrap = buildSendTurnBootstrap({
      isLocalDraftThread: input.thread.isLocalDraftThread,
      // Mobile has no worktree-creation flow in the MVP.
      baseBranchForWorktree: null,
      shouldMaterializeLegacyBranchWorktree: false,
      projectId: input.project.projectId,
      projectCwd: input.project.projectCwd,
      title: input.title,
      threadCreateModelSelection,
      runtimeMode: input.settings.runtimeMode,
      interactionMode: input.settings.interactionMode,
      tokenMode: input.settings.tokenMode,
      activeThreadBranch: input.thread.activeThreadBranch,
      worktreePath: input.thread.worktreePath,
      threadCreatedAt: input.thread.createdAt,
    });

    await commitSendTurnDispatch({
      api: input.api,
      threadId: input.thread.threadId,
      isFirstMessage: input.thread.isFirstMessage,
      isServerThread: input.thread.isServerThread,
      title: input.title,
      messageId,
      outgoingMessageText,
      turnAttachments,
      modelSelection: input.composer.selectedModelSelection,
      hasSelectedModel: input.composer.hasSelectedModel,
      runtimeMode: input.settings.runtimeMode,
      interactionMode: input.settings.interactionMode,
      tokenMode: input.settings.tokenMode,
      bootstrap,
      sourceControlContexts: [],
      createdAt,
      newCommandId,
      beginLocalDispatch: input.beginLocalDispatch ?? (() => {}),
      // Per-thread next-turn settings persistence is deferred (§3-13).
      persistThreadSettingsForNextTurn: () => Promise.resolve(),
    });
    return true;
  } catch (error) {
    input.restoreDraft({ prompt: promptSnapshot, images: imagesSnapshot });
    input.setThreadError(
      input.thread.threadId,
      error instanceof Error ? error.message : "Failed to send message.",
    );
    return false;
  }
}
