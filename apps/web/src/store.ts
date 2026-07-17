import type {
  EnvironmentId,
  MessageId,
  OrchestrationCheckpointSummary,
  OrchestrationEvent,
  OrchestrationLatestTurn,
  OrchestrationMessage,
  OrchestrationProposedPlan,
  OrchestrationReadModel,
  OrchestrationShellSnapshot,
  OrchestrationShellStreamEvent,
  OrchestrationSession,
  OrchestrationSessionStatus,
  OrchestrationThread,
  OrchestrationThreadShell,
  OrchestrationThreadActivity,
  OrchestrationWorktreeShell,
  ProjectId,
  ScopedProjectRef,
  ScopedThreadRef,
  WorktreeId,
} from "@ryco/contracts";
import { isProviderDriverKind, ProviderDriverKind } from "@ryco/contracts";
import type { ThreadId, TurnId } from "@ryco/contracts";
import { Schema } from "effect";
import { resolveModelSlugForProvider } from "@ryco/shared/model";
import { capThreadActivitiesPreservingMilestones } from "@ryco/shared/threadActivity";
import { create } from "zustand";
import {
  type ChatMessage,
  DEFAULT_AGENT_TOKEN_MODE,
  type Project,
  type ProposedPlan,
  type SidebarThreadSummary,
  type SidebarWorktreeSummary,
  type Thread,
  type ThreadSession,
  type ThreadShell,
  type ThreadTurnState,
  type TurnDiffSummary,
} from "./types";
import { resolveEnvironmentHttpUrl } from "./environments/runtime";
import { isHostedHubMode } from "./env";
import { sanitizeThreadErrorMessage } from "./rpc/transportError";
import { getThreadFromEnvironmentState } from "./threadDerivation";
import {
  isWebPerfProfileEnabled,
  readWebPerfNow,
  recordWebPerfPayload,
} from "./perf/perfInstrumentation";

export interface EnvironmentState {
  projectIds: ProjectId[];
  projectById: Record<ProjectId, Project>;
  worktreeIds?: WorktreeId[] | undefined;
  worktreeIdsByProjectId?: Record<ProjectId, WorktreeId[]> | undefined;
  worktreeById?: Record<WorktreeId, SidebarWorktreeSummary> | undefined;

  // ---------------------------------------------------------------------------
  // Thread bookkeeping — written by BOTH shell stream and detail stream.
  // Both streams ensure the thread is registered here; the bookkeeping is
  // additive (append-only IDs) so concurrent writes are safe.
  // ---------------------------------------------------------------------------
  threadIds: ThreadId[];
  threadIdsByProjectId: Record<ProjectId, ThreadId[]>;

  // ---------------------------------------------------------------------------
  // Thread shell / session / turn — written by BOTH shell stream and detail
  // stream.  The shell stream is the *authoritative* source (server pre-
  // computes these from the projection pipeline), but the detail stream also
  // writes them so the active thread has up-to-date state even if the shell
  // event hasn't arrived yet.  Structural equality checks in both write
  // functions prevent unnecessary React re-renders when both streams deliver
  // equivalent data.
  // ---------------------------------------------------------------------------
  threadShellById: Record<ThreadId, ThreadShell>;
  threadSessionById: Record<ThreadId, ThreadSession | null>;
  threadTurnStateById: Record<ThreadId, ThreadTurnState>;

  // ---------------------------------------------------------------------------
  // Thread detail content — written ONLY by the detail stream
  // (writeThreadState / syncServerThreadDetail).  The shell stream never
  // touches these.
  // ---------------------------------------------------------------------------
  messageIdsByThreadId: Record<ThreadId, MessageId[]>;
  messageByThreadId: Record<ThreadId, Record<MessageId, ChatMessage>>;
  pendingMessagesByThreadId: Record<ThreadId, ChatMessage[]>;
  activityIdsByThreadId: Record<ThreadId, string[]>;
  activityByThreadId: Record<ThreadId, Record<string, OrchestrationThreadActivity>>;
  proposedPlanIdsByThreadId: Record<ThreadId, string[]>;
  proposedPlanByThreadId: Record<ThreadId, Record<string, ProposedPlan>>;
  turnDiffIdsByThreadId: Record<ThreadId, TurnId[]>;
  turnDiffSummaryByThreadId: Record<ThreadId, Record<TurnId, TurnDiffSummary>>;

  // ---------------------------------------------------------------------------
  // Sidebar summary — written ONLY by the shell stream
  // (writeThreadShellState / mapThreadShell).  Pre-computed server-side with
  // fields like latestUserMessageAt, hasPendingApprovals, etc.  The detail
  // stream must NOT write here; the shell stream is the single source of
  // truth for sidebar data.
  // ---------------------------------------------------------------------------
  sidebarThreadSummaryById: Record<ThreadId, SidebarThreadSummary>;

  bootstrapComplete: boolean;
}

export interface AppState {
  activeEnvironmentId: EnvironmentId | null;
  environmentStateById: Record<string, EnvironmentState>;
}

const initialEnvironmentState: EnvironmentState = {
  projectIds: [],
  projectById: {},
  worktreeIds: [],
  worktreeIdsByProjectId: {},
  worktreeById: {},
  threadIds: [],
  threadIdsByProjectId: {},
  threadShellById: {},
  threadSessionById: {},
  threadTurnStateById: {},
  messageIdsByThreadId: {},
  messageByThreadId: {},
  pendingMessagesByThreadId: {},
  activityIdsByThreadId: {},
  activityByThreadId: {},
  proposedPlanIdsByThreadId: {},
  proposedPlanByThreadId: {},
  turnDiffIdsByThreadId: {},
  turnDiffSummaryByThreadId: {},
  sidebarThreadSummaryById: {},
  bootstrapComplete: false,
};

const initialState: AppState = {
  activeEnvironmentId: null,
  environmentStateById: {},
};

const MAX_THREAD_MESSAGES = 2_000;
const MAX_THREAD_CHECKPOINTS = 500;
const MAX_THREAD_PROPOSED_PLANS = 200;
const MAX_THREAD_ACTIVITIES = 500;
const EMPTY_THREAD_IDS: ThreadId[] = [];
const EMPTY_WORKTREE_IDS: WorktreeId[] = [];
const EMPTY_MESSAGE_IDS: MessageId[] = [];
const EMPTY_ACTIVITY_IDS: string[] = [];

function arraysEqual<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

// Accepts the open `instanceId` string carried on `ModelSelection`; malformed
// values pass through unchanged, while valid slugs use any registered alias
// table for model normalization.
function normalizeModelSelection<T extends { instanceId: string; model: string }>(selection: T): T {
  if (!isProviderDriverKind(selection.instanceId)) {
    return selection;
  }
  return {
    ...selection,
    model: resolveModelSlugForProvider(selection.instanceId, selection.model),
  };
}

function mapProjectScripts(scripts: ReadonlyArray<Project["scripts"][number]>): Project["scripts"] {
  return scripts.map((script) => ({ ...script }));
}

function mapSession(session: OrchestrationSession): ThreadSession {
  return {
    provider: toLegacyProvider(session.providerName),
    providerInstanceId: session.providerInstanceId ?? undefined,
    status: toLegacySessionStatus(session.status),
    orchestrationStatus: session.status,
    activeTurnId: session.activeTurnId ?? undefined,
    createdAt: session.updatedAt,
    updatedAt: session.updatedAt,
    ...(session.lastError ? { lastError: session.lastError } : {}),
  };
}

function mapMessage(environmentId: EnvironmentId, message: OrchestrationMessage): ChatMessage {
  const attachments = message.attachments?.map((attachment) => ({
    type: "image" as const,
    id: attachment.id,
    name: attachment.name,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    ...(isHostedHubMode()
      ? {}
      : {
          previewUrl: resolveEnvironmentHttpUrl({
            environmentId,
            pathname: attachmentPreviewRoutePath(attachment.id),
          }),
        }),
  }));

  return {
    id: message.id,
    role: message.role,
    text: message.text,
    turnId: message.turnId,
    createdAt: message.createdAt,
    streaming: message.streaming,
    ...(message.streaming ? {} : { completedAt: message.updatedAt }),
    ...(attachments && attachments.length > 0 ? { attachments } : {}),
  };
}

function mapProposedPlan(proposedPlan: OrchestrationProposedPlan): ProposedPlan {
  return {
    id: proposedPlan.id,
    turnId: proposedPlan.turnId,
    planMarkdown: proposedPlan.planMarkdown,
    implementedAt: proposedPlan.implementedAt,
    implementationThreadId: proposedPlan.implementationThreadId,
    createdAt: proposedPlan.createdAt,
    updatedAt: proposedPlan.updatedAt,
  };
}

function mapTurnDiffSummary(checkpoint: OrchestrationCheckpointSummary): TurnDiffSummary {
  return {
    turnId: checkpoint.turnId,
    completedAt: checkpoint.completedAt,
    status: checkpoint.status,
    assistantMessageId: checkpoint.assistantMessageId ?? undefined,
    checkpointTurnCount: checkpoint.checkpointTurnCount,
    checkpointRef: checkpoint.checkpointRef,
    files: checkpoint.files.filter(isMeaningfulTurnDiffFile).map((file) => ({
      path: file.path,
      kind: file.kind,
      additions: file.additions,
      deletions: file.deletions,
    })),
  };
}

function isMeaningfulTurnDiffFile(file: OrchestrationCheckpointSummary["files"][number]): boolean {
  return file.kind !== "modified" || file.additions > 0 || file.deletions > 0;
}

function mapProject(
  project:
    | OrchestrationReadModel["projects"][number]
    | OrchestrationShellSnapshot["projects"][number],
  environmentId: EnvironmentId,
): Project {
  return {
    id: project.id,
    environmentId,
    name: project.title,
    cwd: project.workspaceRoot,
    projectMetadataDir: project.projectMetadataDir,
    repositoryIdentity: project.repositoryIdentity ?? null,
    defaultModelSelection: project.defaultModelSelection
      ? normalizeModelSelection(project.defaultModelSelection)
      : null,
    customSystemPrompt: project.customSystemPrompt ?? null,
    customAvatarContentHash: project.customAvatarContentHash ?? null,
    preferredRemoteName: project.preferredRemoteName ?? null,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    scripts: mapProjectScripts(project.scripts),
  };
}

function mapWorktree(
  worktree: OrchestrationWorktreeShell,
  environmentId: EnvironmentId,
): SidebarWorktreeSummary {
  return {
    id: worktree.worktreeId,
    environmentId,
    projectId: worktree.projectId,
    title: worktree.title ?? null,
    branch: worktree.branch,
    worktreePath: worktree.worktreePath,
    origin: worktree.origin,
    prNumber: worktree.prNumber,
    issueNumber: worktree.issueNumber,
    prTitle: worktree.prTitle,
    issueTitle: worktree.issueTitle,
    prState: worktree.prState ?? null,
    prIsDraft: worktree.prIsDraft ?? null,
    issueState: worktree.issueState ?? null,
    workItemProvider: worktree.workItemProvider ?? null,
    workItemKey: worktree.workItemKey ?? null,
    workItemTitle: worktree.workItemTitle ?? null,
    workItemState: worktree.workItemState ?? null,
    workItemStateName: worktree.workItemStateName ?? null,
    workItemUrl: worktree.workItemUrl ?? null,
    createdAt: worktree.createdAt,
    updatedAt: worktree.updatedAt,
    archivedAt: worktree.archivedAt,
    manualPosition: worktree.manualPosition,
  };
}

function mapThread(thread: OrchestrationThread, environmentId: EnvironmentId): Thread {
  return {
    id: thread.id,
    environmentId,
    codexThreadId: null,
    projectId: thread.projectId,
    title: thread.title,
    modelSelection: normalizeModelSelection(thread.modelSelection),
    runtimeMode: thread.runtimeMode,
    interactionMode: thread.interactionMode,
    tokenMode: thread.tokenMode ?? DEFAULT_AGENT_TOKEN_MODE,
    session: thread.session ? mapSession(thread.session) : null,
    messages: thread.messages.map((message) => mapMessage(environmentId, message)),
    proposedPlans: thread.proposedPlans.map(mapProposedPlan),
    error: sanitizeThreadErrorMessage(thread.session?.lastError),
    createdAt: thread.createdAt,
    archivedAt: thread.archivedAt,
    updatedAt: thread.updatedAt,
    latestTurn: thread.latestTurn,
    pendingSourceProposedPlan: thread.latestTurn?.sourceProposedPlan,
    branch: thread.branch,
    worktreePath: thread.worktreePath,
    worktreeId: thread.worktreeId ?? null,
    manualStatusBucket: thread.manualStatusBucket ?? null,
    manualPosition: thread.manualPosition ?? 0,
    turnDiffSummaries: thread.checkpoints.map(mapTurnDiffSummary),
    activities: thread.activities.map((activity) => ({ ...activity })),
  };
}

function mapThreadShell(
  thread: OrchestrationThreadShell,
  environmentId: EnvironmentId,
): {
  shell: ThreadShell;
  session: ThreadSession | null;
  turnState: ThreadTurnState;
  summary: SidebarThreadSummary;
} {
  const shell: ThreadShell = {
    id: thread.id,
    environmentId,
    codexThreadId: null,
    projectId: thread.projectId,
    title: thread.title,
    modelSelection: normalizeModelSelection(thread.modelSelection),
    runtimeMode: thread.runtimeMode,
    interactionMode: thread.interactionMode,
    tokenMode: thread.tokenMode ?? DEFAULT_AGENT_TOKEN_MODE,
    error: sanitizeThreadErrorMessage(thread.session?.lastError),
    createdAt: thread.createdAt,
    archivedAt: thread.archivedAt,
    updatedAt: thread.updatedAt,
    branch: thread.branch,
    worktreePath: thread.worktreePath,
    worktreeId: thread.worktreeId ?? null,
    manualStatusBucket: thread.manualStatusBucket ?? null,
    manualPosition: thread.manualPosition ?? 0,
  };
  const session = thread.session ? mapSession(thread.session) : null;
  const turnState: ThreadTurnState = {
    latestTurn: thread.latestTurn,
    pendingSourceProposedPlan: thread.latestTurn?.sourceProposedPlan,
  };
  const summary: SidebarThreadSummary = {
    id: thread.id,
    environmentId,
    projectId: thread.projectId,
    title: thread.title,
    interactionMode: thread.interactionMode,
    tokenMode: thread.tokenMode ?? DEFAULT_AGENT_TOKEN_MODE,
    session,
    createdAt: thread.createdAt,
    archivedAt: thread.archivedAt,
    updatedAt: thread.updatedAt,
    latestTurn: thread.latestTurn,
    branch: thread.branch,
    worktreePath: thread.worktreePath,
    worktreeId: thread.worktreeId ?? null,
    manualStatusBucket: thread.manualStatusBucket ?? null,
    manualPosition: thread.manualPosition ?? 0,
    latestUserMessageAt: thread.latestUserMessageAt,
    hasPendingApprovals: thread.hasPendingApprovals,
    hasPendingUserInput: thread.hasPendingUserInput,
    hasActionableProposedPlan: thread.hasActionableProposedPlan,
  };
  return {
    shell,
    session,
    turnState,
    summary,
  };
}

function toThreadShell(thread: Thread): ThreadShell {
  return {
    id: thread.id,
    environmentId: thread.environmentId,
    codexThreadId: thread.codexThreadId,
    projectId: thread.projectId,
    title: thread.title,
    modelSelection: thread.modelSelection,
    runtimeMode: thread.runtimeMode,
    interactionMode: thread.interactionMode,
    tokenMode: thread.tokenMode ?? DEFAULT_AGENT_TOKEN_MODE,
    error: thread.error,
    createdAt: thread.createdAt,
    archivedAt: thread.archivedAt,
    updatedAt: thread.updatedAt,
    branch: thread.branch,
    worktreePath: thread.worktreePath,
    worktreeId: thread.worktreeId,
    manualStatusBucket: thread.manualStatusBucket,
    manualPosition: thread.manualPosition,
  };
}

function toThreadTurnState(thread: Thread): ThreadTurnState {
  return {
    latestTurn: thread.latestTurn,
    ...(thread.pendingSourceProposedPlan
      ? { pendingSourceProposedPlan: thread.pendingSourceProposedPlan }
      : {}),
  };
}

function sourceProposedPlansEqual(
  left: OrchestrationLatestTurn["sourceProposedPlan"] | undefined,
  right: OrchestrationLatestTurn["sourceProposedPlan"] | undefined,
): boolean {
  if (left === right) return true;
  if (left === undefined || right === undefined) return false;
  return left.threadId === right.threadId && left.planId === right.planId;
}

function latestTurnsEqual(
  left: OrchestrationLatestTurn | null | undefined,
  right: OrchestrationLatestTurn | null | undefined,
): boolean {
  if (left === right) return true;
  if (left == null || right == null) return false;
  return (
    left.turnId === right.turnId &&
    left.state === right.state &&
    left.requestedAt === right.requestedAt &&
    left.startedAt === right.startedAt &&
    left.completedAt === right.completedAt &&
    left.assistantMessageId === right.assistantMessageId &&
    sourceProposedPlansEqual(left.sourceProposedPlan, right.sourceProposedPlan)
  );
}

function threadSessionsEqual(
  left: ThreadSession | null | undefined,
  right: ThreadSession | null | undefined,
): boolean {
  if (left === right) return true;
  if (left == null || right == null) return false;
  return (
    left.provider === right.provider &&
    left.status === right.status &&
    left.orchestrationStatus === right.orchestrationStatus &&
    left.activeTurnId === right.activeTurnId &&
    left.createdAt === right.createdAt &&
    left.updatedAt === right.updatedAt &&
    left.lastError === right.lastError
  );
}

function sidebarThreadSummariesEqual(
  left: SidebarThreadSummary | undefined,
  right: SidebarThreadSummary,
): boolean {
  return (
    left !== undefined &&
    left.id === right.id &&
    left.projectId === right.projectId &&
    left.title === right.title &&
    left.interactionMode === right.interactionMode &&
    left.tokenMode === right.tokenMode &&
    threadSessionsEqual(left.session, right.session) &&
    left.createdAt === right.createdAt &&
    left.archivedAt === right.archivedAt &&
    left.updatedAt === right.updatedAt &&
    latestTurnsEqual(left.latestTurn, right.latestTurn) &&
    left.branch === right.branch &&
    left.worktreePath === right.worktreePath &&
    left.worktreeId === right.worktreeId &&
    left.manualStatusBucket === right.manualStatusBucket &&
    left.manualPosition === right.manualPosition &&
    left.latestUserMessageAt === right.latestUserMessageAt &&
    left.hasPendingApprovals === right.hasPendingApprovals &&
    left.hasPendingUserInput === right.hasPendingUserInput &&
    left.hasActionableProposedPlan === right.hasActionableProposedPlan
  );
}

function threadShellsEqual(left: ThreadShell | undefined, right: ThreadShell): boolean {
  return (
    left !== undefined &&
    left.id === right.id &&
    left.environmentId === right.environmentId &&
    left.codexThreadId === right.codexThreadId &&
    left.projectId === right.projectId &&
    left.title === right.title &&
    left.modelSelection === right.modelSelection &&
    left.runtimeMode === right.runtimeMode &&
    left.interactionMode === right.interactionMode &&
    left.tokenMode === right.tokenMode &&
    left.error === right.error &&
    left.createdAt === right.createdAt &&
    left.archivedAt === right.archivedAt &&
    left.updatedAt === right.updatedAt &&
    left.branch === right.branch &&
    left.worktreePath === right.worktreePath &&
    left.worktreeId === right.worktreeId &&
    left.manualStatusBucket === right.manualStatusBucket &&
    left.manualPosition === right.manualPosition
  );
}

function sidebarWorktreesEqual(
  left: SidebarWorktreeSummary | undefined,
  right: SidebarWorktreeSummary,
): boolean {
  return (
    left !== undefined &&
    left.id === right.id &&
    left.environmentId === right.environmentId &&
    left.projectId === right.projectId &&
    left.title === right.title &&
    left.branch === right.branch &&
    left.worktreePath === right.worktreePath &&
    left.origin === right.origin &&
    left.prNumber === right.prNumber &&
    left.issueNumber === right.issueNumber &&
    left.prTitle === right.prTitle &&
    left.issueTitle === right.issueTitle &&
    left.prState === right.prState &&
    left.prIsDraft === right.prIsDraft &&
    left.issueState === right.issueState &&
    left.workItemProvider === right.workItemProvider &&
    left.workItemKey === right.workItemKey &&
    left.workItemTitle === right.workItemTitle &&
    left.workItemState === right.workItemState &&
    left.workItemStateName === right.workItemStateName &&
    left.workItemUrl === right.workItemUrl &&
    left.createdAt === right.createdAt &&
    left.updatedAt === right.updatedAt &&
    left.archivedAt === right.archivedAt &&
    left.manualPosition === right.manualPosition
  );
}

function threadTurnStatesEqual(left: ThreadTurnState | undefined, right: ThreadTurnState): boolean {
  return (
    left !== undefined &&
    latestTurnsEqual(left.latestTurn, right.latestTurn) &&
    sourceProposedPlansEqual(left.pendingSourceProposedPlan, right.pendingSourceProposedPlan)
  );
}

function appendId<T extends string>(ids: readonly T[], id: T): T[] {
  return ids.includes(id) ? [...ids] : [...ids, id];
}

function removeId<T extends string>(ids: readonly T[], id: T): T[] {
  return ids.filter((value) => value !== id);
}

function buildMessageSlice(thread: Thread): {
  ids: MessageId[];
  byId: Record<MessageId, ChatMessage>;
} {
  return {
    ids: thread.messages.map((message) => message.id),
    byId: Object.fromEntries(
      thread.messages.map((message) => [message.id, message] as const),
    ) as Record<MessageId, ChatMessage>,
  };
}

function buildActivitySlice(thread: Thread): {
  ids: string[];
  byId: Record<string, OrchestrationThreadActivity>;
} {
  return buildActivitySliceFromActivities(thread.activities);
}

function buildActivitySliceFromActivities(activities: ReadonlyArray<OrchestrationThreadActivity>): {
  ids: string[];
  byId: Record<string, OrchestrationThreadActivity>;
} {
  return {
    ids: activities.map((activity) => activity.id),
    byId: Object.fromEntries(
      activities.map((activity) => [activity.id, activity] as const),
    ) as Record<string, OrchestrationThreadActivity>,
  };
}

function buildProposedPlanSlice(thread: Thread): {
  ids: string[];
  byId: Record<string, ProposedPlan>;
} {
  return {
    ids: thread.proposedPlans.map((plan) => plan.id),
    byId: Object.fromEntries(
      thread.proposedPlans.map((plan) => [plan.id, plan] as const),
    ) as Record<string, ProposedPlan>,
  };
}

function buildTurnDiffSlice(thread: Thread): {
  ids: TurnId[];
  byId: Record<TurnId, TurnDiffSummary>;
} {
  return {
    ids: thread.turnDiffSummaries.map((summary) => summary.turnId),
    byId: Object.fromEntries(
      thread.turnDiffSummaries.map((summary) => [summary.turnId, summary] as const),
    ) as Record<TurnId, TurnDiffSummary>,
  };
}

function getProjects(state: EnvironmentState): Project[] {
  return state.projectIds.flatMap((projectId) => {
    const project = state.projectById[projectId];
    return project ? [project] : [];
  });
}

function getThreads(state: EnvironmentState): Thread[] {
  return state.threadIds.flatMap((threadId) => {
    const thread = getThreadFromEnvironmentState(state, threadId);
    return thread ? [thread] : [];
  });
}

/**
 * Ensure a thread is registered in the bookkeeping indices (threadIds,
 * threadIdsByProjectId).  Shared by both the shell stream and detail stream
 * write paths — the bookkeeping is additive (append-only IDs) so concurrent
 * writes from both streams are safe.
 */
function ensureThreadRegistered(
  state: EnvironmentState,
  threadId: ThreadId,
  nextProjectId: ProjectId,
  previousProjectId: ProjectId | undefined,
): EnvironmentState {
  let nextState = state;

  if (!state.threadIds.includes(threadId)) {
    nextState = {
      ...nextState,
      threadIds: [...nextState.threadIds, threadId],
    };
  }

  if (previousProjectId !== nextProjectId) {
    let threadIdsByProjectId = nextState.threadIdsByProjectId;
    if (previousProjectId) {
      const previousIds = threadIdsByProjectId[previousProjectId] ?? EMPTY_THREAD_IDS;
      const nextIds = removeId(previousIds, threadId);
      if (nextIds.length === 0) {
        const { [previousProjectId]: _removed, ...rest } = threadIdsByProjectId;
        threadIdsByProjectId = rest as Record<ProjectId, ThreadId[]>;
      } else if (!arraysEqual(previousIds, nextIds)) {
        threadIdsByProjectId = {
          ...threadIdsByProjectId,
          [previousProjectId]: nextIds,
        };
      }
    }
    const projectThreadIds = threadIdsByProjectId[nextProjectId] ?? EMPTY_THREAD_IDS;
    const nextProjectThreadIds = appendId(projectThreadIds, threadId);
    if (!arraysEqual(projectThreadIds, nextProjectThreadIds)) {
      threadIdsByProjectId = {
        ...threadIdsByProjectId,
        [nextProjectId]: nextProjectThreadIds,
      };
    }
    if (threadIdsByProjectId !== nextState.threadIdsByProjectId) {
      nextState = {
        ...nextState,
        threadIdsByProjectId,
      };
    }
  }

  return nextState;
}

/**
 * Write thread state from the **detail stream** (per-thread subscription).
 *
 * Owns: messages, activities, proposed plans, turn diff summaries.
 * Also writes threadShellById / threadSessionById / threadTurnStateById so
 * the active thread has up-to-date state even if the shell stream event
 * hasn't arrived yet (both streams use structural equality checks to avoid
 * unnecessary re-renders when delivering equivalent data).
 * Does NOT write sidebarThreadSummaryById — that is shell-stream-only.
 */
function writeThreadState(
  state: EnvironmentState,
  nextThread: Thread,
  previousThread?: Thread,
): EnvironmentState {
  const pendingMessages = state.pendingMessagesByThreadId[nextThread.id] ?? [];
  const resolvedThread =
    pendingMessages.length === 0
      ? nextThread
      : {
          ...nextThread,
          messages: [...nextThread.messages, ...pendingMessages].toSorted(
            (left, right) =>
              left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
          ),
        };
  const nextShell = toThreadShell(nextThread);
  const nextTurnState = toThreadTurnState(nextThread);
  const previousShell = state.threadShellById[nextThread.id];
  const previousTurnState = state.threadTurnStateById[nextThread.id];

  let nextState = ensureThreadRegistered(
    state,
    nextThread.id,
    nextThread.projectId,
    previousThread?.projectId,
  );

  if (!threadShellsEqual(previousShell, nextShell)) {
    nextState = {
      ...nextState,
      threadShellById: {
        ...nextState.threadShellById,
        [nextThread.id]: nextShell,
      },
    };
  }

  if (!threadSessionsEqual(previousThread?.session ?? null, nextThread.session)) {
    nextState = {
      ...nextState,
      threadSessionById: {
        ...nextState.threadSessionById,
        [nextThread.id]: nextThread.session,
      },
    };
  }

  if (!threadTurnStatesEqual(previousTurnState, nextTurnState)) {
    nextState = {
      ...nextState,
      threadTurnStateById: {
        ...nextState.threadTurnStateById,
        [nextThread.id]: nextTurnState,
      },
    };
  }

  if (previousThread?.messages !== resolvedThread.messages) {
    const nextMessageSlice = buildMessageSlice(resolvedThread);
    nextState = {
      ...nextState,
      messageIdsByThreadId: {
        ...nextState.messageIdsByThreadId,
        [resolvedThread.id]: nextMessageSlice.ids,
      },
      messageByThreadId: {
        ...nextState.messageByThreadId,
        [resolvedThread.id]: nextMessageSlice.byId,
      },
    };
  }
  if (pendingMessages.length > 0) {
    const { [resolvedThread.id]: _removed, ...rest } = nextState.pendingMessagesByThreadId;
    nextState = {
      ...nextState,
      pendingMessagesByThreadId: rest,
    };
  }

  if (previousThread?.activities !== nextThread.activities) {
    const nextActivitySlice = buildActivitySlice(nextThread);
    nextState = {
      ...nextState,
      activityIdsByThreadId: {
        ...nextState.activityIdsByThreadId,
        [nextThread.id]: nextActivitySlice.ids,
      },
      activityByThreadId: {
        ...nextState.activityByThreadId,
        [nextThread.id]: nextActivitySlice.byId,
      },
    };
  }

  if (previousThread?.proposedPlans !== nextThread.proposedPlans) {
    const nextProposedPlanSlice = buildProposedPlanSlice(nextThread);
    nextState = {
      ...nextState,
      proposedPlanIdsByThreadId: {
        ...nextState.proposedPlanIdsByThreadId,
        [nextThread.id]: nextProposedPlanSlice.ids,
      },
      proposedPlanByThreadId: {
        ...nextState.proposedPlanByThreadId,
        [nextThread.id]: nextProposedPlanSlice.byId,
      },
    };
  }

  if (previousThread?.turnDiffSummaries !== nextThread.turnDiffSummaries) {
    const nextTurnDiffSlice = buildTurnDiffSlice(nextThread);
    nextState = {
      ...nextState,
      turnDiffIdsByThreadId: {
        ...nextState.turnDiffIdsByThreadId,
        [nextThread.id]: nextTurnDiffSlice.ids,
      },
      turnDiffSummaryByThreadId: {
        ...nextState.turnDiffSummaryByThreadId,
        [nextThread.id]: nextTurnDiffSlice.byId,
      },
    };
  }

  return nextState;
}

/**
 * Write thread state from the **shell stream** (all-threads subscription).
 *
 * Owns: sidebarThreadSummaryById (pre-computed server-side sidebar data).
 * Also writes threadShellById / threadSessionById / threadTurnStateById as
 * the authoritative source for these fields.  The detail stream may also
 * write them for the focused thread (see writeThreadState); structural
 * equality checks prevent unnecessary re-renders.
 * Does NOT write message/activity/proposedPlan/turnDiff content — that is
 * detail-stream-only.
 */
function writeThreadShellState(
  state: EnvironmentState,
  nextThread: {
    shell: ThreadShell;
    session: ThreadSession | null;
    turnState: ThreadTurnState;
    summary: SidebarThreadSummary;
  },
): EnvironmentState {
  const previousShell = state.threadShellById[nextThread.shell.id];

  let nextState = ensureThreadRegistered(
    state,
    nextThread.shell.id,
    nextThread.shell.projectId,
    previousShell?.projectId,
  );

  if (!threadShellsEqual(previousShell, nextThread.shell)) {
    nextState = {
      ...nextState,
      threadShellById: {
        ...nextState.threadShellById,
        [nextThread.shell.id]: nextThread.shell,
      },
    };
  }

  if (
    !threadSessionsEqual(state.threadSessionById[nextThread.shell.id] ?? null, nextThread.session)
  ) {
    nextState = {
      ...nextState,
      threadSessionById: {
        ...nextState.threadSessionById,
        [nextThread.shell.id]: nextThread.session,
      },
    };
  }

  if (
    !threadTurnStatesEqual(state.threadTurnStateById[nextThread.shell.id], nextThread.turnState)
  ) {
    nextState = {
      ...nextState,
      threadTurnStateById: {
        ...nextState.threadTurnStateById,
        [nextThread.shell.id]: nextThread.turnState,
      },
    };
  }

  if (
    !sidebarThreadSummariesEqual(
      state.sidebarThreadSummaryById[nextThread.shell.id],
      nextThread.summary,
    )
  ) {
    nextState = {
      ...nextState,
      sidebarThreadSummaryById: {
        ...nextState.sidebarThreadSummaryById,
        [nextThread.shell.id]: nextThread.summary,
      },
    };
  }

  return nextState;
}

function retainThreadScopedRecord<T>(
  record: Record<ThreadId, T>,
  nextThreadIds: ReadonlySet<ThreadId>,
): Record<ThreadId, T> {
  return Object.fromEntries(
    Object.entries(record).flatMap(([threadId, value]) =>
      nextThreadIds.has(threadId as ThreadId) ? [[threadId, value] as const] : [],
    ),
  ) as Record<ThreadId, T>;
}

function removeThreadState(state: EnvironmentState, threadId: ThreadId): EnvironmentState {
  const shell = state.threadShellById[threadId];
  if (!shell) {
    return state;
  }

  const nextThreadIds = removeId(state.threadIds, threadId);
  const currentProjectThreadIds = state.threadIdsByProjectId[shell.projectId] ?? EMPTY_THREAD_IDS;
  const nextProjectThreadIds = removeId(currentProjectThreadIds, threadId);
  const nextThreadIdsByProjectId =
    nextProjectThreadIds.length === 0
      ? (() => {
          const { [shell.projectId]: _removed, ...rest } = state.threadIdsByProjectId;
          return rest as Record<ProjectId, ThreadId[]>;
        })()
      : {
          ...state.threadIdsByProjectId,
          [shell.projectId]: nextProjectThreadIds,
        };

  const { [threadId]: _removedShell, ...threadShellById } = state.threadShellById;
  const { [threadId]: _removedSession, ...threadSessionById } = state.threadSessionById;
  const { [threadId]: _removedTurnState, ...threadTurnStateById } = state.threadTurnStateById;
  const { [threadId]: _removedMessageIds, ...messageIdsByThreadId } = state.messageIdsByThreadId;
  const { [threadId]: _removedMessages, ...messageByThreadId } = state.messageByThreadId;
  const { [threadId]: _removedPendingMessages, ...pendingMessagesByThreadId } =
    state.pendingMessagesByThreadId;
  const { [threadId]: _removedActivityIds, ...activityIdsByThreadId } = state.activityIdsByThreadId;
  const { [threadId]: _removedActivities, ...activityByThreadId } = state.activityByThreadId;
  const { [threadId]: _removedPlanIds, ...proposedPlanIdsByThreadId } =
    state.proposedPlanIdsByThreadId;
  const { [threadId]: _removedPlans, ...proposedPlanByThreadId } = state.proposedPlanByThreadId;
  const { [threadId]: _removedTurnDiffIds, ...turnDiffIdsByThreadId } = state.turnDiffIdsByThreadId;
  const { [threadId]: _removedTurnDiffs, ...turnDiffSummaryByThreadId } =
    state.turnDiffSummaryByThreadId;
  const { [threadId]: _removedSidebarSummary, ...sidebarThreadSummaryById } =
    state.sidebarThreadSummaryById;

  return {
    ...state,
    threadIds: nextThreadIds,
    threadIdsByProjectId: nextThreadIdsByProjectId,
    threadShellById,
    threadSessionById,
    threadTurnStateById,
    messageIdsByThreadId,
    messageByThreadId,
    pendingMessagesByThreadId,
    activityIdsByThreadId,
    activityByThreadId,
    proposedPlanIdsByThreadId,
    proposedPlanByThreadId,
    turnDiffIdsByThreadId,
    turnDiffSummaryByThreadId,
    sidebarThreadSummaryById,
  };
}

export function removeThreadByRef(state: AppState, threadRef: ScopedThreadRef): AppState {
  const environmentState = state.environmentStateById[threadRef.environmentId];
  if (!environmentState) {
    return state;
  }
  return commitEnvironmentState(
    state,
    threadRef.environmentId,
    removeThreadState(environmentState, threadRef.threadId),
  );
}

function upsertWorktreeState(
  state: EnvironmentState,
  worktree: SidebarWorktreeSummary,
): EnvironmentState {
  const worktreeById = state.worktreeById ?? {};
  const currentWorktreeIds = state.worktreeIds ?? EMPTY_WORKTREE_IDS;
  const previous = worktreeById[worktree.id];
  const projectChanged = previous !== undefined && previous.projectId !== worktree.projectId;
  let worktreeIds = currentWorktreeIds.includes(worktree.id)
    ? currentWorktreeIds
    : [...currentWorktreeIds, worktree.id];
  let worktreeIdsByProjectId = state.worktreeIdsByProjectId ?? {};
  const existingProjectIds = worktreeIdsByProjectId[worktree.projectId] ?? [];

  if (
    sidebarWorktreesEqual(previous, worktree) &&
    currentWorktreeIds.includes(worktree.id) &&
    existingProjectIds.includes(worktree.id)
  ) {
    return state;
  }

  if (projectChanged) {
    const previousIds = worktreeIdsByProjectId[previous.projectId] ?? [];
    const nextPreviousIds = removeId(previousIds, worktree.id);
    if (nextPreviousIds.length === 0) {
      const { [previous.projectId]: _removed, ...rest } = worktreeIdsByProjectId;
      worktreeIdsByProjectId = rest as Record<ProjectId, WorktreeId[]>;
    } else {
      worktreeIdsByProjectId = {
        ...worktreeIdsByProjectId,
        [previous.projectId]: nextPreviousIds,
      };
    }
  }

  const projectIds = worktreeIdsByProjectId[worktree.projectId] ?? [];
  if (!projectIds.includes(worktree.id)) {
    worktreeIdsByProjectId = {
      ...worktreeIdsByProjectId,
      [worktree.projectId]: [...projectIds, worktree.id],
    };
  }

  if (previous === undefined && worktreeIds === currentWorktreeIds) {
    worktreeIds = [...worktreeIds];
  }

  return {
    ...state,
    worktreeIds,
    worktreeIdsByProjectId,
    worktreeById: {
      ...worktreeById,
      [worktree.id]: worktree,
    },
  };
}

function removeWorktreeState(state: EnvironmentState, worktreeId: WorktreeId): EnvironmentState {
  const worktreeByIdRecord = state.worktreeById ?? {};
  const existing = worktreeByIdRecord[worktreeId];
  if (!existing) {
    return state;
  }
  const { [worktreeId]: _removed, ...worktreeById } = worktreeByIdRecord;
  const worktreeIdsByProjectIdRecord = state.worktreeIdsByProjectId ?? {};
  const projectIds = worktreeIdsByProjectIdRecord[existing.projectId] ?? [];
  const nextProjectIds = removeId(projectIds, worktreeId);
  const worktreeIdsByProjectId =
    nextProjectIds.length === 0
      ? Object.fromEntries(
          Object.entries(worktreeIdsByProjectIdRecord).filter(
            ([projectId]) => projectId !== existing.projectId,
          ),
        )
      : {
          ...worktreeIdsByProjectIdRecord,
          [existing.projectId]: nextProjectIds,
        };
  return {
    ...state,
    worktreeIds: removeId(state.worktreeIds ?? EMPTY_WORKTREE_IDS, worktreeId),
    worktreeIdsByProjectId: worktreeIdsByProjectId as Record<ProjectId, WorktreeId[]>,
    worktreeById,
  };
}

function checkpointStatusToLatestTurnState(status: "ready" | "missing" | "error") {
  if (status === "error") {
    return "error" as const;
  }
  if (status === "missing") {
    return "interrupted" as const;
  }
  return "completed" as const;
}

function compareActivities(
  left: Thread["activities"][number],
  right: Thread["activities"][number],
): number {
  if (left.sequence !== undefined && right.sequence !== undefined) {
    if (left.sequence !== right.sequence) {
      return left.sequence - right.sequence;
    }
  } else if (left.sequence !== undefined) {
    return 1;
  } else if (right.sequence !== undefined) {
    return -1;
  }

  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

function buildLatestTurn(params: {
  previous: Thread["latestTurn"];
  turnId: NonNullable<Thread["latestTurn"]>["turnId"];
  state: NonNullable<Thread["latestTurn"]>["state"];
  requestedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  assistantMessageId: NonNullable<Thread["latestTurn"]>["assistantMessageId"];
  sourceProposedPlan?: Thread["pendingSourceProposedPlan"];
}): NonNullable<Thread["latestTurn"]> {
  const resolvedPlan =
    params.previous?.turnId === params.turnId
      ? params.previous.sourceProposedPlan
      : params.sourceProposedPlan;
  return {
    turnId: params.turnId,
    state: params.state,
    requestedAt: params.requestedAt,
    startedAt: params.startedAt,
    completedAt: params.completedAt,
    assistantMessageId: params.assistantMessageId,
    ...(resolvedPlan ? { sourceProposedPlan: resolvedPlan } : {}),
  };
}

function retainThreadMessagesAfterRevert(
  messages: ReadonlyArray<ChatMessage>,
  retainedTurnIds: ReadonlySet<string>,
  turnCount: number,
): ChatMessage[] {
  const retainedMessageIds = new Set<string>();
  for (const message of messages) {
    if (message.role === "system") {
      retainedMessageIds.add(message.id);
      continue;
    }
    if (
      message.turnId !== undefined &&
      message.turnId !== null &&
      retainedTurnIds.has(message.turnId)
    ) {
      retainedMessageIds.add(message.id);
    }
  }

  const retainedUserCount = messages.filter(
    (message) => message.role === "user" && retainedMessageIds.has(message.id),
  ).length;
  const missingUserCount = Math.max(0, turnCount - retainedUserCount);
  if (missingUserCount > 0) {
    const fallbackUserMessages = messages
      .filter(
        (message) =>
          message.role === "user" &&
          !retainedMessageIds.has(message.id) &&
          (message.turnId === undefined ||
            message.turnId === null ||
            retainedTurnIds.has(message.turnId)),
      )
      .toSorted(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
      )
      .slice(0, missingUserCount);
    for (const message of fallbackUserMessages) {
      retainedMessageIds.add(message.id);
    }
  }

  const retainedAssistantCount = messages.filter(
    (message) => message.role === "assistant" && retainedMessageIds.has(message.id),
  ).length;
  const missingAssistantCount = Math.max(0, turnCount - retainedAssistantCount);
  if (missingAssistantCount > 0) {
    const fallbackAssistantMessages = messages
      .filter(
        (message) =>
          message.role === "assistant" &&
          !retainedMessageIds.has(message.id) &&
          (message.turnId === undefined ||
            message.turnId === null ||
            retainedTurnIds.has(message.turnId)),
      )
      .toSorted(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
      )
      .slice(0, missingAssistantCount);
    for (const message of fallbackAssistantMessages) {
      retainedMessageIds.add(message.id);
    }
  }

  return messages.filter((message) => retainedMessageIds.has(message.id));
}

function retainThreadActivitiesAfterRevert(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  retainedTurnIds: ReadonlySet<string>,
): OrchestrationThreadActivity[] {
  return activities.filter(
    (activity) => activity.turnId === null || retainedTurnIds.has(activity.turnId),
  );
}

function retainThreadProposedPlansAfterRevert(
  proposedPlans: ReadonlyArray<ProposedPlan>,
  retainedTurnIds: ReadonlySet<string>,
): ProposedPlan[] {
  return proposedPlans.filter(
    (proposedPlan) => proposedPlan.turnId === null || retainedTurnIds.has(proposedPlan.turnId),
  );
}

function toLegacySessionStatus(
  status: OrchestrationSessionStatus,
): "connecting" | "ready" | "running" | "error" | "closed" {
  switch (status) {
    case "starting":
      return "connecting";
    case "running":
      return "running";
    case "error":
      return "error";
    case "ready":
    case "interrupted":
      return "ready";
    case "idle":
    case "stopped":
      return "closed";
  }
}

function toLegacyProvider(providerName: string | null): ProviderDriverKind {
  if (Schema.is(ProviderDriverKind)(providerName)) {
    return providerName;
  }
  return ProviderDriverKind.make("codex");
}

function attachmentPreviewRoutePath(attachmentId: string): string {
  return `/attachments/${encodeURIComponent(attachmentId)}`;
}

function updateThreadState(
  state: EnvironmentState,
  threadId: ThreadId,
  updater: (thread: Thread) => Thread,
): EnvironmentState {
  const currentThread = getThreadFromEnvironmentState(state, threadId);
  if (!currentThread) {
    return state;
  }
  const nextThread = updater(currentThread);
  if (nextThread === currentThread) {
    return state;
  }
  return writeThreadState(state, nextThread, currentThread);
}

function updateThreadShellTimestamp(
  state: EnvironmentState,
  threadId: ThreadId,
  updatedAt: string,
): EnvironmentState {
  const shell = state.threadShellById[threadId];
  if (!shell || shell.updatedAt === updatedAt) {
    return state;
  }

  return {
    ...state,
    threadShellById: {
      ...state.threadShellById,
      [threadId]: {
        ...shell,
        updatedAt,
      },
    },
  };
}

function mergeMessageUpdate(existing: ChatMessage, message: ChatMessage): ChatMessage {
  return {
    ...existing,
    text: message.streaming
      ? `${existing.text}${message.text}`
      : message.text.length > 0
        ? message.text
        : existing.text,
    streaming: message.streaming,
    ...(message.turnId !== undefined ? { turnId: message.turnId } : {}),
    ...(message.streaming
      ? existing.completedAt !== undefined
        ? { completedAt: existing.completedAt }
        : {}
      : message.completedAt !== undefined
        ? { completedAt: message.completedAt }
        : {}),
    ...(message.attachments !== undefined ? { attachments: message.attachments } : {}),
  };
}

function upsertPendingThreadMessage(
  state: EnvironmentState,
  threadId: ThreadId,
  message: ChatMessage,
): EnvironmentState {
  const pending = state.pendingMessagesByThreadId[threadId] ?? [];
  const existing = pending.find((entry) => entry.id === message.id);
  const nextPending = existing
    ? pending.map((entry) => (entry.id === message.id ? mergeMessageUpdate(entry, message) : entry))
    : [...pending, message];
  return {
    ...state,
    pendingMessagesByThreadId: {
      ...state.pendingMessagesByThreadId,
      [threadId]: nextPending,
    },
  };
}

function rebindTurnDiffSummaryStateForAssistantMessage(
  state: EnvironmentState,
  threadId: ThreadId,
  turnId: TurnId,
  assistantMessageId: MessageId,
): EnvironmentState {
  const summariesById = state.turnDiffSummaryByThreadId[threadId];
  const summary = summariesById?.[turnId];
  if (!summariesById || !summary || summary.assistantMessageId === assistantMessageId) {
    return state;
  }

  return {
    ...state,
    turnDiffSummaryByThreadId: {
      ...state.turnDiffSummaryByThreadId,
      [threadId]: {
        ...summariesById,
        [turnId]: {
          ...summary,
          assistantMessageId,
        },
      },
    },
  };
}

function applyThreadMessageSentEvent(
  state: EnvironmentState,
  event: Extract<OrchestrationEvent, { type: "thread.message-sent" }>,
  environmentId: EnvironmentId,
): EnvironmentState {
  const message = mapMessage(environmentId, {
    id: event.payload.messageId,
    role: event.payload.role,
    text: event.payload.text,
    ...(event.payload.attachments !== undefined ? { attachments: event.payload.attachments } : {}),
    turnId: event.payload.turnId,
    streaming: event.payload.streaming,
    createdAt: event.payload.createdAt,
    updatedAt: event.payload.updatedAt,
  });
  const threadId = event.payload.threadId;
  if (!state.threadShellById[threadId]) {
    return upsertPendingThreadMessage(state, threadId, message);
  }

  const currentIds = state.messageIdsByThreadId[threadId] ?? EMPTY_MESSAGE_IDS;
  const currentById = state.messageByThreadId[threadId] ?? {};
  const pendingMessages = state.pendingMessagesByThreadId[threadId] ?? [];
  const pendingMessage = pendingMessages.find((entry) => entry.id === message.id);
  const existingMessage = currentById[message.id] ?? pendingMessage;
  const nextMessage = existingMessage ? mergeMessageUpdate(existingMessage, message) : message;
  let nextIds = currentIds;
  let nextById: Record<MessageId, ChatMessage> = {
    ...currentById,
    [message.id]: nextMessage,
  };
  let nextPendingMessagesByThreadId = state.pendingMessagesByThreadId;

  if (!currentById[message.id] && !currentIds.includes(message.id)) {
    nextIds = [...currentIds, message.id];
    if (nextIds.length > MAX_THREAD_MESSAGES) {
      const retainedIds = nextIds.slice(-MAX_THREAD_MESSAGES);
      const retainedIdSet = new Set<MessageId>(retainedIds);
      nextById = Object.fromEntries(
        Object.entries(nextById).filter(([messageId]) => retainedIdSet.has(messageId as MessageId)),
      ) as Record<MessageId, ChatMessage>;
      nextIds = retainedIds;
    }
  }

  if (pendingMessage) {
    const nextPendingMessages = pendingMessages.filter((entry) => entry.id !== message.id);
    if (nextPendingMessages.length === 0) {
      const { [threadId]: _removedPendingMessages, ...rest } = state.pendingMessagesByThreadId;
      nextPendingMessagesByThreadId = rest;
    } else {
      nextPendingMessagesByThreadId = {
        ...state.pendingMessagesByThreadId,
        [threadId]: nextPendingMessages,
      };
    }
  }

  let nextState: EnvironmentState = {
    ...state,
    pendingMessagesByThreadId: nextPendingMessagesByThreadId,
    messageIdsByThreadId:
      nextIds === currentIds
        ? state.messageIdsByThreadId
        : {
            ...state.messageIdsByThreadId,
            [threadId]: nextIds,
          },
    messageByThreadId: {
      ...state.messageByThreadId,
      [threadId]: nextById,
    },
  };

  if (event.payload.role === "assistant" && event.payload.turnId !== null) {
    nextState = rebindTurnDiffSummaryStateForAssistantMessage(
      nextState,
      threadId,
      event.payload.turnId,
      event.payload.messageId,
    );

    const previousTurnState = nextState.threadTurnStateById[threadId];
    const previousLatestTurn = previousTurnState?.latestTurn ?? null;
    if (previousLatestTurn === null || previousLatestTurn.turnId === event.payload.turnId) {
      const nextTurnState: ThreadTurnState = {
        latestTurn: buildLatestTurn({
          previous: previousLatestTurn,
          turnId: event.payload.turnId,
          state: event.payload.streaming
            ? "running"
            : previousLatestTurn?.state === "interrupted"
              ? "interrupted"
              : previousLatestTurn?.state === "error"
                ? "error"
                : "completed",
          requestedAt:
            previousLatestTurn?.turnId === event.payload.turnId
              ? previousLatestTurn.requestedAt
              : event.payload.createdAt,
          startedAt:
            previousLatestTurn?.turnId === event.payload.turnId
              ? (previousLatestTurn.startedAt ?? event.payload.createdAt)
              : event.payload.createdAt,
          sourceProposedPlan: previousTurnState?.pendingSourceProposedPlan,
          completedAt: event.payload.streaming
            ? previousLatestTurn?.turnId === event.payload.turnId
              ? (previousLatestTurn.completedAt ?? null)
              : null
            : event.payload.updatedAt,
          assistantMessageId: event.payload.messageId,
        }),
        ...(previousTurnState?.pendingSourceProposedPlan
          ? { pendingSourceProposedPlan: previousTurnState.pendingSourceProposedPlan }
          : {}),
      };

      if (!threadTurnStatesEqual(previousTurnState, nextTurnState)) {
        nextState = {
          ...nextState,
          threadTurnStateById: {
            ...nextState.threadTurnStateById,
            [threadId]: nextTurnState,
          },
        };
      }
    }
  }

  return updateThreadShellTimestamp(nextState, threadId, event.occurredAt);
}

function insertActivityIdByOrder(
  ids: readonly string[],
  byId: Record<string, OrchestrationThreadActivity>,
  activity: OrchestrationThreadActivity,
): string[] {
  const lastActivity = ids.length > 0 ? byId[ids[ids.length - 1]!] : undefined;
  if (!lastActivity || compareActivities(lastActivity, activity) <= 0) {
    return [...ids, activity.id];
  }

  const nextIds = [...ids];
  const insertIndex = nextIds.findIndex((id) => {
    const existing = byId[id];
    return existing ? compareActivities(activity, existing) < 0 : false;
  });
  if (insertIndex === -1) {
    nextIds.push(activity.id);
  } else {
    nextIds.splice(insertIndex, 0, activity.id);
  }
  return nextIds;
}

function applyThreadActivityAppendedEvent(
  state: EnvironmentState,
  event: Extract<OrchestrationEvent, { type: "thread.activity-appended" }>,
): EnvironmentState {
  const threadId = event.payload.threadId;
  if (!state.threadShellById[threadId]) {
    return state;
  }

  const activity = { ...event.payload.activity };
  const currentIds = state.activityIdsByThreadId[threadId] ?? EMPTY_ACTIVITY_IDS;
  const currentById = state.activityByThreadId[threadId] ?? {};
  const existingActivity = currentById[activity.id];
  const orderChanged =
    existingActivity !== undefined &&
    (existingActivity.createdAt !== activity.createdAt ||
      existingActivity.sequence !== activity.sequence);
  let nextIds = currentIds;
  let nextById: Record<string, OrchestrationThreadActivity> = {
    ...currentById,
    [activity.id]: activity,
  };

  if (!existingActivity) {
    nextIds = insertActivityIdByOrder(currentIds, currentById, activity);
  } else if (orderChanged) {
    const idsWithoutCurrent = currentIds.filter((id) => id !== activity.id);
    nextIds = insertActivityIdByOrder(idsWithoutCurrent, nextById, activity);
  }

  if (nextIds.length > MAX_THREAD_ACTIVITIES) {
    const cappedActivities = capThreadActivitiesPreservingMilestones(
      nextIds.flatMap((id) => {
        const entry = nextById[id];
        return entry ? [entry] : [];
      }),
      MAX_THREAD_ACTIVITIES,
    );
    const cappedSlice = buildActivitySliceFromActivities(cappedActivities);
    nextIds = cappedSlice.ids;
    nextById = cappedSlice.byId;
  }

  const nextState: EnvironmentState = {
    ...state,
    activityIdsByThreadId:
      nextIds === currentIds
        ? state.activityIdsByThreadId
        : {
            ...state.activityIdsByThreadId,
            [threadId]: nextIds,
          },
    activityByThreadId: {
      ...state.activityByThreadId,
      [threadId]: nextById,
    },
  };

  return updateThreadShellTimestamp(nextState, threadId, event.occurredAt);
}

function buildProjectState(
  projects: ReadonlyArray<Project>,
): Pick<EnvironmentState, "projectIds" | "projectById"> {
  return {
    projectIds: projects.map((project) => project.id),
    projectById: Object.fromEntries(
      projects.map((project) => [project.id, project] as const),
    ) as Record<ProjectId, Project>,
  };
}

function buildWorktreeState(
  worktrees: ReadonlyArray<SidebarWorktreeSummary>,
): Pick<EnvironmentState, "worktreeIds" | "worktreeIdsByProjectId" | "worktreeById"> {
  const worktreeIdsByProjectId: Record<ProjectId, WorktreeId[]> = {} as Record<
    ProjectId,
    WorktreeId[]
  >;
  for (const worktree of worktrees) {
    worktreeIdsByProjectId[worktree.projectId] = [
      ...(worktreeIdsByProjectId[worktree.projectId] ?? []),
      worktree.id,
    ];
  }
  return {
    worktreeIds: worktrees.map((worktree) => worktree.id),
    worktreeIdsByProjectId,
    worktreeById: Object.fromEntries(
      worktrees.map((worktree) => [worktree.id, worktree] as const),
    ) as Record<WorktreeId, SidebarWorktreeSummary>,
  };
}

function getStoredEnvironmentState(
  state: AppState,
  environmentId: EnvironmentId,
): EnvironmentState {
  return state.environmentStateById[environmentId] ?? initialEnvironmentState;
}

function commitEnvironmentState(
  state: AppState,
  environmentId: EnvironmentId,
  nextEnvironmentState: EnvironmentState,
): AppState {
  const currentEnvironmentState = state.environmentStateById[environmentId];
  const environmentStateById =
    currentEnvironmentState === nextEnvironmentState
      ? state.environmentStateById
      : {
          ...state.environmentStateById,
          [environmentId]: nextEnvironmentState,
        };

  if (environmentStateById === state.environmentStateById) {
    return state;
  }

  return {
    ...state,
    environmentStateById,
  };
}

function syncEnvironmentShellSnapshot(
  state: EnvironmentState,
  snapshot: OrchestrationShellSnapshot,
  environmentId: EnvironmentId,
): EnvironmentState {
  const nextProjects = snapshot.projects.map((project) => mapProject(project, environmentId));
  const nextWorktrees = (snapshot.worktrees ?? []).map((worktree) =>
    mapWorktree(worktree, environmentId),
  );
  const nextThreadIds = new Set(snapshot.threads.map((thread) => thread.id));
  let nextState: EnvironmentState = {
    ...state,
    ...buildProjectState(nextProjects),
    ...buildWorktreeState(nextWorktrees),
    threadIds: [],
    threadIdsByProjectId: {},
    threadShellById: {},
    threadSessionById: {},
    threadTurnStateById: {},
    sidebarThreadSummaryById: {},
    messageIdsByThreadId: retainThreadScopedRecord(state.messageIdsByThreadId, nextThreadIds),
    messageByThreadId: retainThreadScopedRecord(state.messageByThreadId, nextThreadIds),
    pendingMessagesByThreadId: retainThreadScopedRecord(
      state.pendingMessagesByThreadId,
      nextThreadIds,
    ),
    activityIdsByThreadId: retainThreadScopedRecord(state.activityIdsByThreadId, nextThreadIds),
    activityByThreadId: retainThreadScopedRecord(state.activityByThreadId, nextThreadIds),
    proposedPlanIdsByThreadId: retainThreadScopedRecord(
      state.proposedPlanIdsByThreadId,
      nextThreadIds,
    ),
    proposedPlanByThreadId: retainThreadScopedRecord(state.proposedPlanByThreadId, nextThreadIds),
    turnDiffIdsByThreadId: retainThreadScopedRecord(state.turnDiffIdsByThreadId, nextThreadIds),
    turnDiffSummaryByThreadId: retainThreadScopedRecord(
      state.turnDiffSummaryByThreadId,
      nextThreadIds,
    ),
    bootstrapComplete: true,
  };

  for (const thread of snapshot.threads) {
    nextState = writeThreadShellState(nextState, mapThreadShell(thread, environmentId));
  }

  return nextState;
}

export function syncServerShellSnapshot(
  state: AppState,
  snapshot: OrchestrationShellSnapshot,
  environmentId: EnvironmentId,
): AppState {
  return commitEnvironmentState(
    state,
    environmentId,
    syncEnvironmentShellSnapshot(
      getStoredEnvironmentState(state, environmentId),
      snapshot,
      environmentId,
    ),
  );
}

export function syncServerThreadDetail(
  state: AppState,
  thread: OrchestrationThread,
  environmentId: EnvironmentId,
): AppState {
  const environmentState = getStoredEnvironmentState(state, environmentId);
  const previousThread = getThreadFromEnvironmentState(environmentState, thread.id);
  return commitEnvironmentState(
    state,
    environmentId,
    writeThreadState(environmentState, mapThread(thread, environmentId), previousThread),
  );
}

function applyEnvironmentOrchestrationEvent(
  state: EnvironmentState,
  event: OrchestrationEvent,
  environmentId: EnvironmentId,
): EnvironmentState {
  switch (event.type) {
    case "project.created": {
      const nextProject = mapProject(
        {
          id: event.payload.projectId,
          title: event.payload.title,
          workspaceRoot: event.payload.workspaceRoot,
          projectMetadataDir: event.payload.projectMetadataDir,
          repositoryIdentity: event.payload.repositoryIdentity ?? null,
          defaultModelSelection: event.payload.defaultModelSelection,
          scripts: event.payload.scripts,
          createdAt: event.payload.createdAt,
          updatedAt: event.payload.updatedAt,
          deletedAt: null,
        },
        environmentId,
      );
      const existingProjectId =
        state.projectIds.find(
          (projectId) =>
            projectId === event.payload.projectId ||
            state.projectById[projectId]?.cwd === event.payload.workspaceRoot,
        ) ?? null;
      let projectById = state.projectById;
      let projectIds = state.projectIds;

      if (existingProjectId !== null && existingProjectId !== nextProject.id) {
        const { [existingProjectId]: _removedProject, ...restProjectById } = state.projectById;
        projectById = {
          ...restProjectById,
          [nextProject.id]: nextProject,
        };
        projectIds = state.projectIds.map((projectId) =>
          projectId === existingProjectId ? nextProject.id : projectId,
        );
      } else {
        projectById = {
          ...state.projectById,
          [nextProject.id]: nextProject,
        };
        projectIds =
          existingProjectId === null && !state.projectIds.includes(nextProject.id)
            ? [...state.projectIds, nextProject.id]
            : state.projectIds;
      }

      return {
        ...state,
        projectById,
        projectIds,
      };
    }

    case "project.meta-updated": {
      const project = state.projectById[event.payload.projectId];
      if (!project) {
        return state;
      }
      const nextProject: Project = {
        ...project,
        ...(event.payload.title !== undefined ? { name: event.payload.title } : {}),
        ...(event.payload.workspaceRoot !== undefined ? { cwd: event.payload.workspaceRoot } : {}),
        ...(event.payload.projectMetadataDir !== undefined
          ? { projectMetadataDir: event.payload.projectMetadataDir }
          : {}),
        ...(event.payload.repositoryIdentity !== undefined
          ? { repositoryIdentity: event.payload.repositoryIdentity ?? null }
          : {}),
        ...(event.payload.defaultModelSelection !== undefined
          ? {
              defaultModelSelection: event.payload.defaultModelSelection
                ? normalizeModelSelection(event.payload.defaultModelSelection)
                : null,
            }
          : {}),
        ...(event.payload.scripts !== undefined
          ? { scripts: mapProjectScripts(event.payload.scripts) }
          : {}),
        ...(event.payload.preferredRemoteName !== undefined
          ? { preferredRemoteName: event.payload.preferredRemoteName ?? null }
          : {}),
        updatedAt: event.payload.updatedAt,
      };
      return {
        ...state,
        projectById: {
          ...state.projectById,
          [event.payload.projectId]: nextProject,
        },
      };
    }

    case "project.avatar-set": {
      const project = state.projectById[event.payload.projectId];
      if (!project) {
        return state;
      }
      return {
        ...state,
        projectById: {
          ...state.projectById,
          [event.payload.projectId]: {
            ...project,
            customAvatarContentHash: event.payload.contentHash ?? null,
            updatedAt: event.payload.updatedAt,
          },
        },
      };
    }

    case "project.deleted": {
      if (!state.projectById[event.payload.projectId]) {
        return state;
      }
      const { [event.payload.projectId]: _removedProject, ...projectById } = state.projectById;
      return {
        ...state,
        projectById,
        projectIds: removeId(state.projectIds, event.payload.projectId),
      };
    }

    case "thread.created": {
      const previousThread = getThreadFromEnvironmentState(state, event.payload.threadId);
      const nextThread = mapThread(
        {
          id: event.payload.threadId,
          projectId: event.payload.projectId,
          title: event.payload.title,
          modelSelection: event.payload.modelSelection,
          runtimeMode: event.payload.runtimeMode,
          interactionMode: event.payload.interactionMode,
          tokenMode: event.payload.tokenMode ?? DEFAULT_AGENT_TOKEN_MODE,
          branch: event.payload.branch,
          worktreePath: event.payload.worktreePath,
          worktreeId: null,
          manualStatusBucket: null,
          manualPosition: 0,
          latestTurn: null,
          createdAt: event.payload.createdAt,
          updatedAt: event.payload.updatedAt,
          archivedAt: null,
          deletedAt: null,
          messages: [],
          proposedPlans: [],
          activities: [],
          checkpoints: [],
          session: null,
        },
        environmentId,
      );
      return writeThreadState(state, nextThread, previousThread);
    }

    case "thread.deleted":
      return removeThreadState(state, event.payload.threadId);

    case "thread.archived":
      return updateThreadState(state, event.payload.threadId, (thread) => ({
        ...thread,
        archivedAt: event.payload.archivedAt,
        updatedAt: event.payload.updatedAt,
      }));

    case "thread.unarchived":
      return updateThreadState(state, event.payload.threadId, (thread) => ({
        ...thread,
        archivedAt: null,
        updatedAt: event.payload.updatedAt,
      }));

    case "thread.meta-updated":
      return updateThreadState(state, event.payload.threadId, (thread) => ({
        ...thread,
        ...(event.payload.title !== undefined ? { title: event.payload.title } : {}),
        ...(event.payload.modelSelection !== undefined
          ? { modelSelection: normalizeModelSelection(event.payload.modelSelection) }
          : {}),
        ...(event.payload.branch !== undefined ? { branch: event.payload.branch } : {}),
        ...(event.payload.worktreePath !== undefined
          ? { worktreePath: event.payload.worktreePath }
          : {}),
        updatedAt: event.payload.updatedAt,
      }));

    case "thread.runtime-mode-set":
      return updateThreadState(state, event.payload.threadId, (thread) => ({
        ...thread,
        runtimeMode: event.payload.runtimeMode,
        updatedAt: event.payload.updatedAt,
      }));

    case "thread.interaction-mode-set":
      return updateThreadState(state, event.payload.threadId, (thread) => ({
        ...thread,
        interactionMode: event.payload.interactionMode,
        updatedAt: event.payload.updatedAt,
      }));

    case "thread.token-mode-set":
      return updateThreadState(state, event.payload.threadId, (thread) => ({
        ...thread,
        tokenMode: event.payload.tokenMode ?? DEFAULT_AGENT_TOKEN_MODE,
        updatedAt: event.payload.updatedAt,
      }));

    case "thread.turn-start-requested":
      return updateThreadState(state, event.payload.threadId, (thread) => ({
        ...thread,
        ...(event.payload.modelSelection !== undefined
          ? { modelSelection: normalizeModelSelection(event.payload.modelSelection) }
          : {}),
        runtimeMode: event.payload.runtimeMode,
        interactionMode: event.payload.interactionMode,
        tokenMode: event.payload.tokenMode,
        pendingSourceProposedPlan: event.payload.sourceProposedPlan,
        updatedAt: event.occurredAt,
      }));

    case "thread.turn-interrupt-requested": {
      if (event.payload.turnId === undefined) {
        return state;
      }
      return updateThreadState(state, event.payload.threadId, (thread) => {
        const latestTurn = thread.latestTurn;
        if (latestTurn === null || latestTurn.turnId !== event.payload.turnId) {
          return thread;
        }
        return {
          ...thread,
          latestTurn: buildLatestTurn({
            previous: latestTurn,
            turnId: event.payload.turnId,
            state: "interrupted",
            requestedAt: latestTurn.requestedAt,
            startedAt: latestTurn.startedAt ?? event.payload.createdAt,
            completedAt: latestTurn.completedAt ?? event.payload.createdAt,
            assistantMessageId: latestTurn.assistantMessageId,
          }),
          updatedAt: event.occurredAt,
        };
      });
    }

    case "thread.message-sent":
      return applyThreadMessageSentEvent(state, event, environmentId);

    case "thread.session-set":
      return updateThreadState(state, event.payload.threadId, (thread) => ({
        ...thread,
        session: mapSession(event.payload.session),
        error: sanitizeThreadErrorMessage(event.payload.session.lastError),
        latestTurn:
          event.payload.session.status === "running" && event.payload.session.activeTurnId !== null
            ? buildLatestTurn({
                previous: thread.latestTurn,
                turnId: event.payload.session.activeTurnId,
                state: "running",
                requestedAt:
                  thread.latestTurn?.turnId === event.payload.session.activeTurnId
                    ? thread.latestTurn.requestedAt
                    : event.payload.session.updatedAt,
                startedAt:
                  thread.latestTurn?.turnId === event.payload.session.activeTurnId
                    ? (thread.latestTurn.startedAt ?? event.payload.session.updatedAt)
                    : event.payload.session.updatedAt,
                completedAt: null,
                assistantMessageId:
                  thread.latestTurn?.turnId === event.payload.session.activeTurnId
                    ? thread.latestTurn.assistantMessageId
                    : null,
                sourceProposedPlan: thread.pendingSourceProposedPlan,
              })
            : thread.latestTurn,
        updatedAt: event.occurredAt,
      }));

    case "thread.session-stop-requested":
      return updateThreadState(state, event.payload.threadId, (thread) =>
        thread.session === null
          ? thread
          : {
              ...thread,
              session: {
                ...thread.session,
                status: "closed",
                orchestrationStatus: "stopped",
                activeTurnId: undefined,
                updatedAt: event.payload.createdAt,
              },
              updatedAt: event.occurredAt,
            },
      );

    case "thread.proposed-plan-upserted":
      return updateThreadState(state, event.payload.threadId, (thread) => {
        const proposedPlan = mapProposedPlan(event.payload.proposedPlan);
        const proposedPlans = [
          ...thread.proposedPlans.filter((entry) => entry.id !== proposedPlan.id),
          proposedPlan,
        ]
          .toSorted(
            (left, right) =>
              left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
          )
          .slice(-MAX_THREAD_PROPOSED_PLANS);
        return {
          ...thread,
          proposedPlans,
          updatedAt: event.occurredAt,
        };
      });

    case "thread.turn-diff-completed":
      return updateThreadState(state, event.payload.threadId, (thread) => {
        const checkpoint = mapTurnDiffSummary({
          turnId: event.payload.turnId,
          checkpointTurnCount: event.payload.checkpointTurnCount,
          checkpointRef: event.payload.checkpointRef,
          status: event.payload.status,
          files: event.payload.files,
          assistantMessageId: event.payload.assistantMessageId,
          completedAt: event.payload.completedAt,
        });
        const existing = thread.turnDiffSummaries.find(
          (entry) => entry.turnId === checkpoint.turnId,
        );
        if (existing && existing.status !== "missing" && checkpoint.status === "missing") {
          return thread;
        }
        const turnDiffSummaries = [
          ...thread.turnDiffSummaries.filter((entry) => entry.turnId !== checkpoint.turnId),
          checkpoint,
        ]
          .toSorted(
            (left, right) =>
              (left.checkpointTurnCount ?? Number.MAX_SAFE_INTEGER) -
              (right.checkpointTurnCount ?? Number.MAX_SAFE_INTEGER),
          )
          .slice(-MAX_THREAD_CHECKPOINTS);
        const latestTurn =
          thread.latestTurn === null || thread.latestTurn.turnId === event.payload.turnId
            ? buildLatestTurn({
                previous: thread.latestTurn,
                turnId: event.payload.turnId,
                state: checkpointStatusToLatestTurnState(event.payload.status),
                requestedAt: thread.latestTurn?.requestedAt ?? event.payload.completedAt,
                startedAt: thread.latestTurn?.startedAt ?? event.payload.completedAt,
                completedAt: event.payload.completedAt,
                assistantMessageId: event.payload.assistantMessageId,
                sourceProposedPlan: thread.pendingSourceProposedPlan,
              })
            : thread.latestTurn;
        return {
          ...thread,
          turnDiffSummaries,
          latestTurn,
          updatedAt: event.occurredAt,
        };
      });

    case "thread.reverted":
      return updateThreadState(state, event.payload.threadId, (thread) => {
        const turnDiffSummaries = thread.turnDiffSummaries
          .filter(
            (entry) =>
              entry.checkpointTurnCount !== undefined &&
              entry.checkpointTurnCount <= event.payload.turnCount,
          )
          .toSorted(
            (left, right) =>
              (left.checkpointTurnCount ?? Number.MAX_SAFE_INTEGER) -
              (right.checkpointTurnCount ?? Number.MAX_SAFE_INTEGER),
          )
          .slice(-MAX_THREAD_CHECKPOINTS);
        const retainedTurnIds = new Set(turnDiffSummaries.map((entry) => entry.turnId));
        const messages = retainThreadMessagesAfterRevert(
          thread.messages,
          retainedTurnIds,
          event.payload.turnCount,
        ).slice(-MAX_THREAD_MESSAGES);
        const proposedPlans = retainThreadProposedPlansAfterRevert(
          thread.proposedPlans,
          retainedTurnIds,
        ).slice(-MAX_THREAD_PROPOSED_PLANS);
        const activities = retainThreadActivitiesAfterRevert(thread.activities, retainedTurnIds);
        const latestCheckpoint = turnDiffSummaries.at(-1) ?? null;

        return {
          ...thread,
          turnDiffSummaries,
          messages,
          proposedPlans,
          activities,
          pendingSourceProposedPlan: undefined,
          latestTurn:
            latestCheckpoint === null
              ? null
              : {
                  turnId: latestCheckpoint.turnId,
                  state: checkpointStatusToLatestTurnState(
                    (latestCheckpoint.status ?? "ready") as "ready" | "missing" | "error",
                  ),
                  requestedAt: latestCheckpoint.completedAt,
                  startedAt: latestCheckpoint.completedAt,
                  completedAt: latestCheckpoint.completedAt,
                  assistantMessageId: latestCheckpoint.assistantMessageId ?? null,
                },
          updatedAt: event.occurredAt,
        };
      });

    case "thread.activity-appended":
      return applyThreadActivityAppendedEvent(state, event);

    case "worktree.created":
      return upsertWorktreeState(
        state,
        mapWorktree(
          {
            worktreeId: event.payload.worktreeId,
            projectId: event.payload.projectId,
            title: null,
            branch: event.payload.branch,
            worktreePath: event.payload.worktreePath,
            origin: event.payload.origin,
            prNumber: event.payload.prNumber,
            issueNumber: event.payload.issueNumber,
            prTitle: event.payload.prTitle,
            issueTitle: event.payload.issueTitle,
            prState: null,
            prIsDraft: null,
            issueState: null,
            workItemProvider: event.payload.workItemProvider ?? null,
            workItemKey: event.payload.workItemKey ?? null,
            workItemTitle: event.payload.workItemTitle ?? null,
            workItemState: event.payload.workItemState ?? null,
            workItemStateName: event.payload.workItemStateName ?? null,
            workItemUrl: event.payload.workItemUrl ?? null,
            createdAt: event.payload.createdAt,
            updatedAt: event.payload.updatedAt,
            archivedAt: null,
            manualPosition: 0,
          },
          environmentId,
        ),
      );

    case "worktree.archived": {
      const existing = state.worktreeById?.[event.payload.worktreeId];
      return existing
        ? upsertWorktreeState(state, {
            ...existing,
            archivedAt: event.payload.archivedAt,
            updatedAt: event.payload.archivedAt,
          })
        : state;
    }

    case "worktree.metaUpdated": {
      const existing = state.worktreeById?.[event.payload.worktreeId];
      return existing
        ? upsertWorktreeState(state, {
            ...existing,
            title: event.payload.title ?? null,
            updatedAt: event.payload.changedAt,
          })
        : state;
    }

    case "worktree.sourceControlStateUpdated": {
      const existing = state.worktreeById?.[event.payload.worktreeId];
      return existing
        ? upsertWorktreeState(state, {
            ...existing,
            ...(event.payload.prNumber !== undefined ? { prNumber: event.payload.prNumber } : {}),
            ...(event.payload.prTitle !== undefined ? { prTitle: event.payload.prTitle } : {}),
            prState: event.payload.prState,
            prIsDraft: event.payload.prIsDraft,
            issueState: event.payload.issueState,
            updatedAt: event.payload.updatedAt,
          })
        : state;
    }

    case "worktree.restored": {
      const existing = state.worktreeById?.[event.payload.worktreeId];
      return existing
        ? upsertWorktreeState(state, {
            ...existing,
            archivedAt: null,
            updatedAt: event.payload.restoredAt,
          })
        : state;
    }

    case "worktree.deleted":
      return removeWorktreeState(state, event.payload.worktreeId);

    case "thread.attachedToWorktree":
      return updateThreadState(state, event.payload.threadId, (thread) => ({
        ...thread,
        worktreeId: event.payload.worktreeId,
        updatedAt: event.payload.attachedAt,
      }));

    case "thread.statusBucketOverridden":
      return updateThreadState(state, event.payload.threadId, (thread) => ({
        ...thread,
        manualStatusBucket: event.payload.bucket,
        updatedAt: event.payload.changedAt,
      }));

    case "thread.approval-response-requested":
    case "thread.user-input-response-requested":
      return state;
  }

  return state;
}

function applyEnvironmentShellEvent(
  state: EnvironmentState,
  event: OrchestrationShellStreamEvent,
  environmentId: EnvironmentId,
): EnvironmentState {
  switch (event.kind) {
    case "project-upserted": {
      const nextProject = mapProject(event.project, environmentId);
      const existingProjectId =
        state.projectIds.find(
          (projectId) =>
            projectId === event.project.id ||
            state.projectById[projectId]?.cwd === event.project.workspaceRoot,
        ) ?? null;
      let projectById = state.projectById;
      let projectIds = state.projectIds;

      if (existingProjectId !== null && existingProjectId !== nextProject.id) {
        const { [existingProjectId]: _removedProject, ...restProjectById } = state.projectById;
        projectById = {
          ...restProjectById,
          [nextProject.id]: nextProject,
        };
        projectIds = state.projectIds.map((projectId) =>
          projectId === existingProjectId ? nextProject.id : projectId,
        );
      } else {
        projectById = {
          ...state.projectById,
          [nextProject.id]: nextProject,
        };
        projectIds =
          existingProjectId === null && !state.projectIds.includes(nextProject.id)
            ? [...state.projectIds, nextProject.id]
            : state.projectIds;
      }

      return {
        ...state,
        projectById,
        projectIds,
      };
    }
    case "project-removed": {
      if (!state.projectById[event.projectId]) {
        return state;
      }
      const { [event.projectId]: _removedProject, ...projectById } = state.projectById;
      return {
        ...state,
        projectById,
        projectIds: removeId(state.projectIds, event.projectId),
      };
    }
    case "thread-upserted":
      return writeThreadShellState(state, mapThreadShell(event.thread, environmentId));
    case "worktree-upserted":
      return upsertWorktreeState(state, mapWorktree(event.worktree, environmentId));
    case "thread-removed":
      return removeThreadState(state, event.threadId);
    case "worktree-removed":
      return removeWorktreeState(state, event.worktreeId);
  }
}

export function applyOrchestrationEvents(
  state: AppState,
  events: ReadonlyArray<OrchestrationEvent>,
  environmentId: EnvironmentId,
): AppState {
  if (events.length === 0) {
    return state;
  }
  const perfEnabled = isWebPerfProfileEnabled();
  const startedAt = perfEnabled ? readWebPerfNow() : 0;
  const currentEnvironmentState = getStoredEnvironmentState(state, environmentId);
  const nextEnvironmentState = events.reduce(
    (nextState, event) => applyEnvironmentOrchestrationEvent(nextState, event, environmentId),
    currentEnvironmentState,
  );
  const nextState = commitEnvironmentState(state, environmentId, nextEnvironmentState);
  if (perfEnabled) {
    recordWebPerfPayload("web.store.orchestration.events.apply", events, {
      count: events.length,
      durationMs: readWebPerfNow() - startedAt,
    });
  }
  return nextState;
}

function getEnvironmentEntries(
  state: AppState,
): ReadonlyArray<readonly [EnvironmentId, EnvironmentState]> {
  return Object.entries(state.environmentStateById) as unknown as ReadonlyArray<
    readonly [EnvironmentId, EnvironmentState]
  >;
}

export function selectEnvironmentState(
  state: AppState,
  environmentId: EnvironmentId | null | undefined,
): EnvironmentState {
  return environmentId ? getStoredEnvironmentState(state, environmentId) : initialEnvironmentState;
}

export function selectProjectsForEnvironment(
  state: AppState,
  environmentId: EnvironmentId | null | undefined,
): Project[] {
  return getProjects(selectEnvironmentState(state, environmentId));
}

export function selectThreadsForEnvironment(
  state: AppState,
  environmentId: EnvironmentId | null | undefined,
): Thread[] {
  return getThreads(selectEnvironmentState(state, environmentId));
}

export function selectProjectsAcrossEnvironments(state: AppState): Project[] {
  return getEnvironmentEntries(state).flatMap(([, environmentState]) =>
    getProjects(environmentState),
  );
}

export function selectThreadsAcrossEnvironments(state: AppState): Thread[] {
  return getEnvironmentEntries(state).flatMap(([, environmentState]) =>
    getThreads(environmentState),
  );
}

/** Like `selectThreadsAcrossEnvironments` but returns stable `ThreadShell` references from the store (no derived data). */
export function selectThreadShellsAcrossEnvironments(state: AppState): ThreadShell[] {
  return getEnvironmentEntries(state).flatMap(([, environmentState]) =>
    environmentState.threadIds.flatMap((threadId) => {
      const shell = environmentState.threadShellById[threadId];
      return shell ? [shell] : [];
    }),
  );
}

export function selectSidebarThreadsAcrossEnvironments(state: AppState): SidebarThreadSummary[] {
  return getEnvironmentEntries(state).flatMap(([environmentId, environmentState]) =>
    environmentState.threadIds.flatMap((threadId) => {
      const thread = environmentState.sidebarThreadSummaryById[threadId];
      return thread && thread.environmentId === environmentId ? [thread] : [];
    }),
  );
}

export function selectSidebarWorktreesAcrossEnvironments(
  state: AppState,
): SidebarWorktreeSummary[] {
  return getEnvironmentEntries(state).flatMap(([environmentId, environmentState]) =>
    (environmentState.worktreeIds ?? EMPTY_WORKTREE_IDS).flatMap((worktreeId) => {
      const worktree = environmentState.worktreeById?.[worktreeId];
      return worktree && worktree.environmentId === environmentId ? [worktree] : [];
    }),
  );
}

export function selectSidebarWorktreesForProjectRef(
  state: AppState,
  ref: ScopedProjectRef | null | undefined,
): SidebarWorktreeSummary[] {
  if (!ref) {
    return [];
  }
  const environmentState = selectEnvironmentState(state, ref.environmentId);
  const worktreeIds = environmentState.worktreeIdsByProjectId?.[ref.projectId] ?? [];
  return worktreeIds.flatMap((worktreeId) => {
    const worktree = environmentState.worktreeById?.[worktreeId];
    return worktree ? [worktree] : [];
  });
}

export function selectSidebarWorktreesForProjectRefs(
  state: AppState,
  refs: readonly ScopedProjectRef[],
): SidebarWorktreeSummary[] {
  if (refs.length === 0) return [];
  if (refs.length === 1) return selectSidebarWorktreesForProjectRef(state, refs[0]);
  return refs.flatMap((ref) => selectSidebarWorktreesForProjectRef(state, ref));
}

export function selectSidebarThreadsForProjectRef(
  state: AppState,
  ref: ScopedProjectRef | null | undefined,
): SidebarThreadSummary[] {
  if (!ref) {
    return [];
  }

  const environmentState = selectEnvironmentState(state, ref.environmentId);
  const threadIds = environmentState.threadIdsByProjectId[ref.projectId] ?? EMPTY_THREAD_IDS;
  return threadIds.flatMap((threadId) => {
    const thread = environmentState.sidebarThreadSummaryById[threadId];
    return thread ? [thread] : [];
  });
}

export function selectSidebarThreadsForProjectRefs(
  state: AppState,
  refs: readonly ScopedProjectRef[],
): SidebarThreadSummary[] {
  if (refs.length === 0) return [];
  if (refs.length === 1) return selectSidebarThreadsForProjectRef(state, refs[0]);
  return refs.flatMap((ref) => selectSidebarThreadsForProjectRef(state, ref));
}

export function selectBootstrapCompleteForActiveEnvironment(state: AppState): boolean {
  return selectEnvironmentState(state, state.activeEnvironmentId).bootstrapComplete;
}

export function selectProjectByRef(
  state: AppState,
  ref: ScopedProjectRef | null | undefined,
): Project | undefined {
  return ref
    ? selectEnvironmentState(state, ref.environmentId).projectById[ref.projectId]
    : undefined;
}

export function selectThreadByRef(
  state: AppState,
  ref: ScopedThreadRef | null | undefined,
): Thread | undefined {
  return ref
    ? getThreadFromEnvironmentState(selectEnvironmentState(state, ref.environmentId), ref.threadId)
    : undefined;
}

export function selectThreadExistsByRef(
  state: AppState,
  ref: ScopedThreadRef | null | undefined,
): boolean {
  return ref
    ? selectEnvironmentState(state, ref.environmentId).threadShellById[ref.threadId] !== undefined
    : false;
}

export function selectSidebarThreadSummaryByRef(
  state: AppState,
  ref: ScopedThreadRef | null | undefined,
): SidebarThreadSummary | undefined {
  return ref
    ? selectEnvironmentState(state, ref.environmentId).sidebarThreadSummaryById[ref.threadId]
    : undefined;
}

export function selectThreadIdsByProjectRef(
  state: AppState,
  ref: ScopedProjectRef | null | undefined,
): ThreadId[] {
  return ref
    ? (selectEnvironmentState(state, ref.environmentId).threadIdsByProjectId[ref.projectId] ??
        EMPTY_THREAD_IDS)
    : EMPTY_THREAD_IDS;
}

export function setError(state: AppState, threadId: ThreadId, error: string | null): AppState {
  if (state.activeEnvironmentId === null) {
    return state;
  }

  const nextEnvironmentState = updateThreadState(
    getStoredEnvironmentState(state, state.activeEnvironmentId),
    threadId,
    (thread) => {
      if (thread.error === error) return thread;
      return { ...thread, error };
    },
  );
  return commitEnvironmentState(state, state.activeEnvironmentId, nextEnvironmentState);
}

export function applyOrchestrationEvent(
  state: AppState,
  event: OrchestrationEvent,
  environmentId: EnvironmentId,
): AppState {
  const perfEnabled = isWebPerfProfileEnabled();
  const startedAt = perfEnabled ? readWebPerfNow() : 0;
  const nextState = commitEnvironmentState(
    state,
    environmentId,
    applyEnvironmentOrchestrationEvent(
      getStoredEnvironmentState(state, environmentId),
      event,
      environmentId,
    ),
  );
  if (perfEnabled) {
    recordWebPerfPayload("web.store.orchestration.event.apply", event, {
      durationMs: readWebPerfNow() - startedAt,
    });
  }
  return nextState;
}

export function applyShellEvent(
  state: AppState,
  event: OrchestrationShellStreamEvent,
  environmentId: EnvironmentId,
): AppState {
  const perfEnabled = isWebPerfProfileEnabled();
  const startedAt = perfEnabled ? readWebPerfNow() : 0;
  const nextState = commitEnvironmentState(
    state,
    environmentId,
    applyEnvironmentShellEvent(
      getStoredEnvironmentState(state, environmentId),
      event,
      environmentId,
    ),
  );
  if (perfEnabled) {
    recordWebPerfPayload("web.store.orchestration.shell.apply", event, {
      durationMs: readWebPerfNow() - startedAt,
    });
  }
  return nextState;
}

export function setActiveEnvironmentId(state: AppState, environmentId: EnvironmentId): AppState {
  if (state.activeEnvironmentId === environmentId) {
    return state;
  }

  return {
    ...state,
    activeEnvironmentId: environmentId,
  };
}

export function removeEnvironmentState(state: AppState, environmentId: EnvironmentId): AppState {
  if (!state.environmentStateById[environmentId] && state.activeEnvironmentId !== environmentId) {
    return state;
  }

  const { [environmentId]: _removed, ...environmentStateById } = state.environmentStateById;
  return {
    ...state,
    activeEnvironmentId:
      state.activeEnvironmentId === environmentId ? null : state.activeEnvironmentId,
    environmentStateById,
  };
}

export function setThreadBranch(
  state: AppState,
  threadRef: ScopedThreadRef,
  branch: string | null,
  worktreePath: string | null,
): AppState {
  const nextEnvironmentState = updateThreadState(
    getStoredEnvironmentState(state, threadRef.environmentId),
    threadRef.threadId,
    (thread) => {
      if (thread.branch === branch && thread.worktreePath === worktreePath) return thread;
      const cwdChanged = thread.worktreePath !== worktreePath;
      return {
        ...thread,
        branch,
        worktreePath,
        ...(cwdChanged ? { session: null } : {}),
      };
    },
  );
  return commitEnvironmentState(state, threadRef.environmentId, nextEnvironmentState);
}

export function setSidebarWorktreeTitle(
  state: AppState,
  environmentId: EnvironmentId,
  worktreeId: WorktreeId,
  title: string | null,
  updatedAt: string,
): AppState {
  const environmentState = getStoredEnvironmentState(state, environmentId);
  const existing = environmentState.worktreeById?.[worktreeId];
  if (!existing) {
    return state;
  }
  return commitEnvironmentState(
    state,
    environmentId,
    upsertWorktreeState(environmentState, {
      ...existing,
      title,
      updatedAt,
    }),
  );
}

// ---------------------------------------------------------------------------
// Shell push coalescing
//
// The shell stream (project / thread / worktree shell upserts) can burst at a
// very high rate while an active turn emits many tool events.  Applying each
// event synchronously triggers a `set` and a full sidebar re-render, which can
// freeze the UI under load.  When the incoming rate exceeds
// SHELL_COALESCE_THRESHOLD_EVENTS_PER_MS, shell events are buffered and flushed
// once per animation frame, collapsing many renders into one.
//
// Turn *content* deltas (message / activity streaming) flow through the
// orchestration and detail streams and are NEVER coalesced here — streaming
// stays immediate.  Every other store mutator flushes buffered shell events
// first so cross-stream ordering and synchronous `getState()` reads stay
// correct (e.g. a pending `thread-upserted` can never resurrect a thread that a
// later `removeThread` deleted).
// ---------------------------------------------------------------------------

export const SHELL_COALESCE_THRESHOLD_EVENTS_PER_MS = 10;
const SHELL_COALESCE_RATE_WINDOW_MS = 8;

interface ShellEventCoalescerDeps {
  readonly getState: () => AppState;
  readonly commitState: (next: AppState) => void;
  readonly now?: () => number;
  readonly schedule?: (callback: () => void) => void;
  readonly thresholdEventsPerMs?: number;
  readonly rateWindowMs?: number;
}

export interface ShellEventCoalescer {
  readonly enqueue: (event: OrchestrationShellStreamEvent, environmentId: EnvironmentId) => void;
  readonly flush: () => void;
  readonly hasPending: () => boolean;
}

function defaultScheduleFrame(callback: () => void): void {
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => callback());
    return;
  }
  setTimeout(callback, 0);
}

function defaultNow(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

export function createShellEventCoalescer(deps: ShellEventCoalescerDeps): ShellEventCoalescer {
  const now = deps.now ?? defaultNow;
  const schedule = deps.schedule ?? defaultScheduleFrame;
  const thresholdEventsPerMs = deps.thresholdEventsPerMs ?? SHELL_COALESCE_THRESHOLD_EVENTS_PER_MS;
  const rateWindowMs = deps.rateWindowMs ?? SHELL_COALESCE_RATE_WINDOW_MS;

  let queue: Array<{ event: OrchestrationShellStreamEvent; environmentId: EnvironmentId }> = [];
  let recentTimestamps: number[] = [];
  let framePending = false;

  function exceedsRateThreshold(): boolean {
    if (recentTimestamps.length < 2) {
      return false;
    }
    const span = recentTimestamps[recentTimestamps.length - 1]! - recentTimestamps[0]!;
    const eventsPerMs = span <= 0 ? Number.POSITIVE_INFINITY : recentTimestamps.length / span;
    return eventsPerMs > thresholdEventsPerMs;
  }

  function flush(): void {
    framePending = false;
    if (queue.length === 0) {
      return;
    }
    const pending = queue;
    queue = [];
    let nextState = deps.getState();
    for (const item of pending) {
      nextState = applyShellEvent(nextState, item.event, item.environmentId);
    }
    deps.commitState(nextState);
  }

  function enqueue(event: OrchestrationShellStreamEvent, environmentId: EnvironmentId): void {
    const timestamp = now();
    recentTimestamps.push(timestamp);
    const windowStart = timestamp - rateWindowMs;
    while (recentTimestamps.length > 0 && recentTimestamps[0]! < windowStart) {
      recentTimestamps.shift();
    }
    queue.push({ event, environmentId });

    if (exceedsRateThreshold()) {
      if (!framePending) {
        framePending = true;
        schedule(flush);
      }
      return;
    }
    flush();
  }

  return {
    enqueue,
    flush,
    hasPending: () => queue.length > 0,
  };
}

interface AppStore extends AppState {
  setActiveEnvironmentId: (environmentId: EnvironmentId) => void;
  removeEnvironmentState: (environmentId: EnvironmentId) => void;
  syncServerShellSnapshot: (
    snapshot: OrchestrationShellSnapshot,
    environmentId: EnvironmentId,
  ) => void;
  syncServerThreadDetail: (thread: OrchestrationThread, environmentId: EnvironmentId) => void;
  applyOrchestrationEvent: (event: OrchestrationEvent, environmentId: EnvironmentId) => void;
  applyOrchestrationEvents: (
    events: ReadonlyArray<OrchestrationEvent>,
    environmentId: EnvironmentId,
  ) => void;
  applyShellEvent: (event: OrchestrationShellStreamEvent, environmentId: EnvironmentId) => void;
  removeThread: (threadRef: ScopedThreadRef) => void;
  setError: (threadId: ThreadId, error: string | null) => void;
  setThreadBranch: (
    threadRef: ScopedThreadRef,
    branch: string | null,
    worktreePath: string | null,
  ) => void;
  setSidebarWorktreeTitle: (
    environmentId: EnvironmentId,
    worktreeId: WorktreeId,
    title: string | null,
    updatedAt: string,
  ) => void;
}

export const useStore = create<AppStore>((set, get) => {
  // Buffers high-frequency shell-stream events and flushes them once per frame
  // under load.  All non-shell mutators flush it first to preserve ordering.
  const shellCoalescer = createShellEventCoalescer({
    getState: get,
    commitState: (next) => set(next),
  });

  return {
    ...initialState,
    setActiveEnvironmentId: (environmentId) => {
      shellCoalescer.flush();
      set((state) => setActiveEnvironmentId(state, environmentId));
    },
    removeEnvironmentState: (environmentId) => {
      shellCoalescer.flush();
      set((state) => removeEnvironmentState(state, environmentId));
    },
    syncServerShellSnapshot: (snapshot, environmentId) => {
      shellCoalescer.flush();
      set((state) => syncServerShellSnapshot(state, snapshot, environmentId));
    },
    syncServerThreadDetail: (thread, environmentId) => {
      shellCoalescer.flush();
      set((state) => syncServerThreadDetail(state, thread, environmentId));
    },
    applyOrchestrationEvent: (event, environmentId) => {
      shellCoalescer.flush();
      set((state) => applyOrchestrationEvent(state, event, environmentId));
    },
    applyOrchestrationEvents: (events, environmentId) => {
      shellCoalescer.flush();
      set((state) => applyOrchestrationEvents(state, events, environmentId));
    },
    applyShellEvent: (event, environmentId) => shellCoalescer.enqueue(event, environmentId),
    removeThread: (threadRef) => {
      shellCoalescer.flush();
      set((state) => removeThreadByRef(state, threadRef));
    },
    setError: (threadId, error) => {
      shellCoalescer.flush();
      set((state) => setError(state, threadId, error));
    },
    setThreadBranch: (threadRef, branch, worktreePath) => {
      shellCoalescer.flush();
      set((state) => setThreadBranch(state, threadRef, branch, worktreePath));
    },
    setSidebarWorktreeTitle: (environmentId, worktreeId, title, updatedAt) => {
      shellCoalescer.flush();
      set((state) => setSidebarWorktreeTitle(state, environmentId, worktreeId, title, updatedAt));
    },
  };
});
