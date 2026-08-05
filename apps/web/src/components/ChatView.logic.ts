import {
  type ComposerSourceControlContext,
  type EnvironmentId,
  type OrchestrationSessionStatus,
  ProjectId,
  type ModelSelection,
  type ProviderDriverKind,
  type ProviderInteractionMode,
  type ScopedThreadRef,
  type ThreadId,
  type TurnId,
} from "@ryco/contracts";
import {
  type ChatMessage,
  DEFAULT_AGENT_TOKEN_MODE,
  type SessionPhase,
  type Thread,
  type ThreadSession,
} from "../types";
import { type ComposerImageAttachment, type DraftThreadState } from "../composerDraftStore";
import { DateTime, Schema } from "effect";
import { selectThreadByRef, useStore } from "../store";
import {
  filterTerminalContextsWithText,
  stripInlineTerminalContextPlaceholders,
  type TerminalContextDraft,
} from "../lib/terminalContext";
import type { DraftThreadEnvMode } from "../composerDraftStore";

export const LAST_INVOKED_SCRIPT_BY_PROJECT_KEY = "ryco:last-invoked-script-by-project";
export const MAX_HIDDEN_MOUNTED_TERMINAL_THREADS = 10;

export const LastInvokedScriptByProjectSchema = Schema.Record(ProjectId, Schema.String);

export function buildLocalDraftThread(
  threadId: ThreadId,
  draftThread: DraftThreadState,
  fallbackModelSelection: ModelSelection,
  error: string | null,
): Thread {
  return {
    id: threadId,
    environmentId: draftThread.environmentId,
    codexThreadId: null,
    projectId: draftThread.projectId,
    title: "New thread",
    modelSelection: fallbackModelSelection,
    runtimeMode: draftThread.runtimeMode,
    interactionMode: draftThread.interactionMode,
    tokenMode: draftThread.tokenMode ?? DEFAULT_AGENT_TOKEN_MODE,
    session: null,
    messages: [],
    error,
    createdAt: draftThread.createdAt,
    archivedAt: null,
    latestTurn: null,
    branch: draftThread.branch,
    worktreePath: draftThread.worktreePath,
    turnDiffSummaries: [],
    activities: [],
    proposedPlans: [],
  };
}

export function shouldWriteThreadErrorToCurrentServerThread(input: {
  serverThread:
    | {
        environmentId: EnvironmentId;
        id: ThreadId;
      }
    | null
    | undefined;
  routeThreadRef: ScopedThreadRef;
  targetThreadId: ThreadId;
}): boolean {
  return Boolean(
    input.serverThread &&
    input.targetThreadId === input.routeThreadRef.threadId &&
    input.serverThread.environmentId === input.routeThreadRef.environmentId &&
    input.serverThread.id === input.targetThreadId,
  );
}

export function reconcileMountedTerminalThreadIds(input: {
  currentThreadIds: ReadonlyArray<string>;
  openThreadIds: ReadonlyArray<string>;
  activeThreadId: string | null;
  activeThreadTerminalOpen: boolean;
  maxHiddenThreadCount?: number;
}): string[] {
  const openThreadIdSet = new Set(input.openThreadIds);
  const hiddenThreadIds = input.currentThreadIds.filter(
    (threadId) => threadId !== input.activeThreadId && openThreadIdSet.has(threadId),
  );
  const maxHiddenThreadCount = Math.max(
    0,
    input.maxHiddenThreadCount ?? MAX_HIDDEN_MOUNTED_TERMINAL_THREADS,
  );
  const nextThreadIds =
    hiddenThreadIds.length > maxHiddenThreadCount
      ? hiddenThreadIds.slice(-maxHiddenThreadCount)
      : hiddenThreadIds;

  if (
    input.activeThreadId &&
    input.activeThreadTerminalOpen &&
    !nextThreadIds.includes(input.activeThreadId)
  ) {
    nextThreadIds.push(input.activeThreadId);
  }

  return nextThreadIds;
}

export function revokeBlobPreviewUrl(previewUrl: string | undefined): void {
  if (!previewUrl || typeof URL === "undefined" || !previewUrl.startsWith("blob:")) {
    return;
  }
  URL.revokeObjectURL(previewUrl);
}

export function revokeUserMessagePreviewUrls(message: ChatMessage): void {
  if (message.role !== "user" || !message.attachments) {
    return;
  }
  for (const attachment of message.attachments) {
    if (attachment.type !== "image") {
      continue;
    }
    revokeBlobPreviewUrl(attachment.previewUrl);
  }
}

export function collectUserMessageBlobPreviewUrls(message: ChatMessage): string[] {
  if (message.role !== "user" || !message.attachments) {
    return [];
  }
  const previewUrls: string[] = [];
  for (const attachment of message.attachments) {
    if (attachment.type !== "image") continue;
    if (!attachment.previewUrl || !attachment.previewUrl.startsWith("blob:")) continue;
    previewUrls.push(attachment.previewUrl);
  }
  return previewUrls;
}

export interface PullRequestDialogState {
  initialReference: string | null;
  key: number;
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Could not read image data."));
    });
    reader.addEventListener("error", () => {
      reject(reader.error ?? new Error("Failed to read image."));
    });
    reader.readAsDataURL(file);
  });
}

export function resolveSendEnvMode(input: {
  requestedEnvMode: DraftThreadEnvMode;
  isGitRepo: boolean;
}): DraftThreadEnvMode {
  return input.isGitRepo ? input.requestedEnvMode : "local";
}

export function resolveChatSendWorktreePlan(input: {
  isServerThread: boolean;
  isFirstMessage: boolean;
  threadWorktreePath: string | null;
  activeThreadBranch: string | null;
  currentGitRefName: string | null;
  sendEnvMode: DraftThreadEnvMode;
}): {
  shouldMaterializeLegacyBranchWorktree: boolean;
  baseBranchForWorktree: string | null;
  shouldCreateWorktree: boolean;
} {
  const shouldMaterializeLegacyBranchWorktree =
    input.isServerThread &&
    !input.isFirstMessage &&
    input.threadWorktreePath === null &&
    input.activeThreadBranch !== null &&
    input.currentGitRefName !== null &&
    input.currentGitRefName !== input.activeThreadBranch;

  const baseBranchForWorktree =
    input.isFirstMessage && input.sendEnvMode === "worktree" && !input.threadWorktreePath
      ? input.activeThreadBranch
      : shouldMaterializeLegacyBranchWorktree
        ? input.activeThreadBranch
        : null;

  const shouldCreateWorktree =
    (input.isFirstMessage && input.sendEnvMode === "worktree" && !input.threadWorktreePath) ||
    shouldMaterializeLegacyBranchWorktree;

  return {
    shouldMaterializeLegacyBranchWorktree,
    baseBranchForWorktree,
    shouldCreateWorktree,
  };
}

export function buildChatSendTitleSeed(input: {
  trimmedPrompt: string;
  firstImageName: string | null;
  firstTerminalContextLabel: string | null;
}): string {
  const normalizedPrompt = input.trimmedPrompt.trim();
  if (normalizedPrompt.length > 0) {
    return normalizedPrompt;
  }
  if (input.firstImageName) {
    return `Image: ${input.firstImageName}`;
  }
  if (input.firstTerminalContextLabel) {
    return input.firstTerminalContextLabel;
  }
  return "New thread";
}

export function cloneComposerImageForRetry(
  image: ComposerImageAttachment,
): ComposerImageAttachment {
  if (typeof URL === "undefined" || !image.previewUrl.startsWith("blob:")) {
    return image;
  }
  try {
    return {
      ...image,
      previewUrl: URL.createObjectURL(image.file),
    };
  } catch {
    return image;
  }
}

export function deriveComposerSendState(options: {
  prompt: string;
  imageCount: number;
  terminalContexts: ReadonlyArray<TerminalContextDraft>;
  sourceControlContexts?: ReadonlyArray<unknown>;
}): {
  trimmedPrompt: string;
  sendableTerminalContexts: TerminalContextDraft[];
  expiredTerminalContextCount: number;
  hasSendableContent: boolean;
} {
  const trimmedPrompt = stripInlineTerminalContextPlaceholders(options.prompt).trim();
  const sendableTerminalContexts = filterTerminalContextsWithText(options.terminalContexts);
  const expiredTerminalContextCount =
    options.terminalContexts.length - sendableTerminalContexts.length;
  const sourceControlContextCount = options.sourceControlContexts?.length ?? 0;
  return {
    trimmedPrompt,
    sendableTerminalContexts,
    expiredTerminalContextCount,
    hasSendableContent:
      trimmedPrompt.length > 0 ||
      options.imageCount > 0 ||
      sendableTerminalContexts.length > 0 ||
      sourceControlContextCount > 0,
  };
}

export function buildExpiredTerminalContextToastCopy(
  expiredTerminalContextCount: number,
  variant: "omitted" | "empty",
): { title: string; description: string } {
  const count = Math.max(1, Math.floor(expiredTerminalContextCount));
  const noun = count === 1 ? "Expired terminal context" : "Expired terminal contexts";
  if (variant === "empty") {
    return {
      title: `${noun} won't be sent`,
      description: "Remove it or re-add it to include terminal output.",
    };
  }
  return {
    title: `${noun} omitted from message`,
    description: "Re-add it if you want that terminal output included.",
  };
}

/**
 * For each context whose `staleAfter` timestamp has passed, calls `fetcher`
 * to re-fetch detail and returns a new context with bumped timestamps.
 * On any failure the original context is kept (best-effort semantics).
 */
export async function refreshStaleSourceControlContexts(
  contexts: ReadonlyArray<ComposerSourceControlContext>,
  options: {
    fetcher: (context: ComposerSourceControlContext) => Promise<ComposerSourceControlContext>;
  },
): Promise<ComposerSourceControlContext[]> {
  const now = DateTime.fromDateUnsafe(new Date());
  return Promise.all(
    contexts.map(async (ctx) => {
      const isStale = DateTime.isLessThanOrEqualTo(ctx.staleAfter, now);
      if (!isStale) return ctx;
      try {
        return await options.fetcher(ctx);
      } catch {
        // best-effort: keep original on failure
        return ctx;
      }
    }),
  );
}

export function threadHasStarted(thread: Thread | null | undefined): boolean {
  return Boolean(
    thread && (thread.latestTurn !== null || thread.messages.length > 0 || thread.session !== null),
  );
}

// The draft -> server route swap remounts ChatView, which drops component-local
// optimistic send state. Wait for runtime state that can independently render
// "Working for ..." instead of swapping as soon as the user message is persisted.
export function threadIsPromotedAndPersisted(thread: Thread | null | undefined): boolean {
  return Boolean(thread && (thread.latestTurn !== null || thread.messages.length > 0));
}

export type ProviderSelectionPolicyReason =
  | "phone-tier"
  | "running"
  | "starting"
  | "connecting"
  | "local-dispatch"
  | "worktree-preparation"
  | "pending-approval"
  | "pending-input"
  | "queued-message"
  | "checkpoint-revert"
  | "mutation-unavailable"
  | "environment-unavailable";

export interface ProviderSelectionPolicy {
  readonly mode: "all-ready" | "continuation-only";
  readonly lockedProvider: ProviderDriverKind | null;
  readonly reason: ProviderSelectionPolicyReason | null;
}

/**
 * Pure UI policy for provider/model selection. Empty threads remain freely
 * configurable. A started thread exposes every ready provider only when it is
 * genuinely idle; every transition, callback, queue, local send/undo window,
 * unavailable mutation boundary, and the frozen web-phone tier constrains the
 * picker to the current provider continuation.
 */
export function deriveProviderSelectionPolicy(input: {
  readonly threadStarted: boolean;
  readonly canonicalProvider: ProviderDriverKind | null;
  readonly phase: SessionPhase;
  readonly orchestrationStatus: OrchestrationSessionStatus | null;
  readonly isConnecting: boolean;
  readonly isSendBusy: boolean;
  readonly isPreparingWorktree: boolean;
  readonly hasPendingApproval: boolean;
  readonly hasPendingUserInput: boolean;
  readonly hasQueuedMessage: boolean;
  readonly isRevertingCheckpoint: boolean;
  readonly mutationAllowed: boolean;
  readonly environmentAvailable: boolean;
  readonly isPhoneTier: boolean;
}): ProviderSelectionPolicy {
  if (!input.threadStarted) {
    return { mode: "all-ready", lockedProvider: null, reason: null };
  }

  const reason: ProviderSelectionPolicyReason | null = input.isPhoneTier
    ? "phone-tier"
    : input.phase === "running" || input.orchestrationStatus === "running"
      ? "running"
      : input.orchestrationStatus === "starting"
        ? "starting"
        : input.phase === "connecting" || input.isConnecting
          ? "connecting"
          : input.isPreparingWorktree
            ? "worktree-preparation"
            : input.isSendBusy
              ? "local-dispatch"
              : input.hasPendingApproval
                ? "pending-approval"
                : input.hasPendingUserInput
                  ? "pending-input"
                  : input.hasQueuedMessage
                    ? "queued-message"
                    : input.isRevertingCheckpoint
                      ? "checkpoint-revert"
                      : !input.mutationAllowed
                        ? "mutation-unavailable"
                        : !input.environmentAvailable
                          ? "environment-unavailable"
                          : null;

  return reason === null
    ? { mode: "all-ready", lockedProvider: null, reason: null }
    : {
        mode: "continuation-only",
        lockedProvider: input.canonicalProvider,
        reason,
      };
}

/** Options-only changes stay on the normal turn path and are allowed. */
export function modelSelectionRequiresContextHandoff(input: {
  readonly canonicalSelection: ModelSelection;
  readonly targetSelection: ModelSelection;
}): boolean {
  return (
    input.canonicalSelection.instanceId !== input.targetSelection.instanceId ||
    input.canonicalSelection.model !== input.targetSelection.model
  );
}

/**
 * Recheck used at send time. The busy picker can retain its existing
 * continuation-group affordances, but a newly staged instance/model may never
 * become a queued or raced handoff after eligibility closes.
 */
export function selectionAllowedAtSendBoundary(input: {
  readonly threadStarted: boolean;
  readonly policy: ProviderSelectionPolicy;
  readonly canonicalSelection: ModelSelection;
  readonly targetSelection: ModelSelection;
}): boolean {
  return (
    !input.threadStarted ||
    input.policy.mode === "all-ready" ||
    !modelSelectionRequiresContextHandoff(input)
  );
}

export function normalizeInteractionModeForProviderTarget(
  mode: ProviderInteractionMode,
  supportsAskMode: boolean,
): ProviderInteractionMode {
  return mode === "ask" && !supportsAskMode ? "default" : mode;
}

export async function waitForStartedServerThread(
  threadRef: ScopedThreadRef,
  timeoutMs = 1_000,
): Promise<boolean> {
  const getThread = () => selectThreadByRef(useStore.getState(), threadRef);
  const thread = getThread();

  if (threadHasStarted(thread)) {
    return true;
  }

  return await new Promise<boolean>((resolve) => {
    let settled = false;
    let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;
    const finish = (result: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutId !== null) {
        globalThis.clearTimeout(timeoutId);
      }
      unsubscribe();
      resolve(result);
    };

    const unsubscribe = useStore.subscribe((state) => {
      if (!threadHasStarted(selectThreadByRef(state, threadRef))) {
        return;
      }
      finish(true);
    });

    if (threadHasStarted(getThread())) {
      finish(true);
      return;
    }

    timeoutId = globalThis.setTimeout(() => {
      finish(false);
    }, timeoutMs);
  });
}

export interface LocalDispatchSnapshot {
  startedAt: string;
  preparingWorktree: boolean;
  latestTurnTurnId: TurnId | null;
  latestTurnRequestedAt: string | null;
  latestTurnStartedAt: string | null;
  latestTurnCompletedAt: string | null;
  sessionOrchestrationStatus: ThreadSession["orchestrationStatus"] | null;
  sessionUpdatedAt: string | null;
}

export function createLocalDispatchSnapshot(
  activeThread: Thread | undefined,
  options?: { preparingWorktree?: boolean },
): LocalDispatchSnapshot {
  const latestTurn = activeThread?.latestTurn ?? null;
  const session = activeThread?.session ?? null;
  return {
    startedAt: new Date().toISOString(),
    preparingWorktree: Boolean(options?.preparingWorktree),
    latestTurnTurnId: latestTurn?.turnId ?? null,
    latestTurnRequestedAt: latestTurn?.requestedAt ?? null,
    latestTurnStartedAt: latestTurn?.startedAt ?? null,
    latestTurnCompletedAt: latestTurn?.completedAt ?? null,
    sessionOrchestrationStatus: session?.orchestrationStatus ?? null,
    sessionUpdatedAt: session?.updatedAt ?? null,
  };
}

export function hasServerAcknowledgedLocalDispatch(input: {
  localDispatch: LocalDispatchSnapshot | null;
  phase: SessionPhase;
  latestTurn: Thread["latestTurn"] | null;
  session: Thread["session"] | null;
  hasPendingApproval: boolean;
  hasPendingUserInput: boolean;
  threadError: string | null | undefined;
}): boolean {
  if (!input.localDispatch) {
    return false;
  }
  if (input.hasPendingApproval || input.hasPendingUserInput || Boolean(input.threadError)) {
    return true;
  }

  const latestTurn = input.latestTurn ?? null;
  const session = input.session ?? null;
  const latestTurnChanged =
    input.localDispatch.latestTurnTurnId !== (latestTurn?.turnId ?? null) ||
    input.localDispatch.latestTurnRequestedAt !== (latestTurn?.requestedAt ?? null) ||
    input.localDispatch.latestTurnStartedAt !== (latestTurn?.startedAt ?? null) ||
    input.localDispatch.latestTurnCompletedAt !== (latestTurn?.completedAt ?? null);

  if (input.phase === "running") {
    if (!latestTurnChanged) {
      return false;
    }
    if (latestTurn?.startedAt === null || latestTurn === null) {
      return false;
    }
    if (
      session?.activeTurnId !== undefined &&
      session.activeTurnId !== null &&
      latestTurn?.turnId !== session.activeTurnId
    ) {
      return false;
    }
    return true;
  }

  return (
    latestTurnChanged ||
    input.localDispatch.sessionOrchestrationStatus !== (session?.orchestrationStatus ?? null) ||
    input.localDispatch.sessionUpdatedAt !== (session?.updatedAt ?? null)
  );
}

/**
 * Whether to replace the timeline with the new-thread surface (hero + "Work in
 * …" sentence).
 *
 * Three conditions, each learned the hard way:
 * - No messages *and* no optimistic sends, so the surface disappears the moment
 *   a turn starts rather than after the server acknowledges it.
 * - No other timeline entries either. A thread can carry work-log rows, a
 *   proposed plan, or setup-script activity from worktree creation while
 *   `messages` is still empty; showing the hero then would hide real progress
 *   and real failures.
 * - Not the phone tier. `apps/web`'s phone presentation is frozen and
 *   `apps/mobile` owns that experience (AGENTS.md), so this surface is
 *   desktop-only.
 */
export function shouldShowNewThreadSurface(input: {
  readonly hasThread: boolean;
  readonly messageCount: number;
  readonly optimisticMessageCount: number;
  readonly timelineEntryCount: number;
  readonly presentationTier: string;
}): boolean {
  return (
    input.hasThread &&
    input.messageCount === 0 &&
    input.optimisticMessageCount === 0 &&
    input.timelineEntryCount === 0 &&
    input.presentationTier !== "phone"
  );
}
