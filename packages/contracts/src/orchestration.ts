import { Effect, Option, Schema, SchemaIssue, SchemaTransformation, Struct } from "effect";
import { ProviderOptionSelections } from "./model.ts";
import { RepositoryIdentity } from "./environment.ts";
import {
  ApprovalRequestId,
  CheckpointRef,
  CommandId,
  ContextHandoffId,
  EventId,
  IsoDateTime,
  MessageId,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  ProviderItemId,
  RuntimeSessionId,
  ThreadId,
  TrimmedNonEmptyString,
  TurnId,
} from "./baseSchemas.ts";
import { ProviderDriverKind, ProviderInstanceId } from "./providerInstance.ts";
import { ComposerSourceControlContext } from "./sourceControl.ts";
import { WorkItemProviderKind, WorkItemState } from "./workItems.ts";
import {
  IssueState,
  PullRequestState,
  StatusBucket,
  Worktree,
  WorktreeId,
  WorktreeOrigin,
} from "./worktree.ts";

export const ORCHESTRATION_WS_METHODS = {
  dispatchCommand: "orchestration.dispatchCommand",
  getTurnDiff: "orchestration.getTurnDiff",
  getFullThreadDiff: "orchestration.getFullThreadDiff",
  searchThreadMessages: "orchestration.searchThreadMessages",
  replayEvents: "orchestration.replayEvents",
  replayEventsPage: "orchestration.replayEventsPage",
  subscribeShell: "orchestration.subscribeShell",
  subscribeThread: "orchestration.subscribeThread",
} as const;

export const ProviderApprovalPolicy = Schema.Literals([
  "untrusted",
  "on-failure",
  "on-request",
  "never",
]);
export type ProviderApprovalPolicy = typeof ProviderApprovalPolicy.Type;
export const ProviderSandboxMode = Schema.Literals([
  "read-only",
  "workspace-write",
  "danger-full-access",
]);
export type ProviderSandboxMode = typeof ProviderSandboxMode.Type;

/**
 * `ModelSelection` — selection of a model on a configured provider instance.
 *
 * The routing key is `instanceId` (a user-defined slug identifying one
 * configured provider instance). Drivers, credentials, working-directory
 * bindings, and any other per-instance state are recovered from the
 * runtime registry via the instance id.
 *
 * Wire legacy: persisted selections produced before the driver/instance
 * split carried a `provider: <driver-id>` field instead. The schema absorbs
 * that shape via a pre-decoding transform — `{provider, model}` is promoted
 * to `{instanceId: defaultInstanceIdForDriver(provider), model}`. No
 * post-decode compatibility code lives in the runtime; the transform is the
 * only compat surface.
 */
const ModelSelectionWire = Schema.Struct({
  instanceId: ProviderInstanceId,
  model: TrimmedNonEmptyString,
  options: Schema.optionalKey(ProviderOptionSelections),
});

// Source shape for persisted legacy payloads. Fields are typed as
// `Schema.Unknown` so malformed drafts still make it into the transform and
// fail validation through the target schema (with proper error messages)
// rather than at the source-struct layer where the error is less actionable.
const ModelSelectionSource = Schema.Struct({
  provider: Schema.optional(Schema.Unknown),
  instanceId: Schema.optional(Schema.Unknown),
  model: Schema.Unknown,
  options: Schema.optional(Schema.Unknown),
});

export const ModelSelection = ModelSelectionSource.pipe(
  Schema.decodeTo(
    ModelSelectionWire,
    SchemaTransformation.transformOrFail({
      decode: (raw) => {
        // Resolve the routing key: prefer an explicit `instanceId`; fall
        // back to promoting the legacy `provider` slug (the canonical
        // `defaultInstanceIdForDriver` mapping) so persisted rollout-era
        // payloads decode without data loss. The target schema brands the
        // string as `ProviderInstanceId`.
        const instanceIdSource =
          raw.instanceId !== undefined
            ? raw.instanceId
            : typeof raw.provider === "string"
              ? raw.provider
              : undefined;
        const base: Record<string, unknown> = {
          instanceId: instanceIdSource,
          model: raw.model,
        };
        if (raw.options !== undefined) base.options = raw.options;
        return Effect.succeed(base as typeof ModelSelectionWire.Encoded);
      },
      encode: (value) => {
        const base: Record<string, unknown> = {
          model: value.model,
          instanceId: value.instanceId,
        };
        if (value.options !== undefined) base.options = value.options;
        return Effect.succeed(base as typeof ModelSelectionSource.Encoded);
      },
    }),
  ),
);
export type ModelSelection = typeof ModelSelection.Type;

export const CONTEXT_HANDOFF_ACTIVITY_KIND = "context-handoff";
export const CONTEXT_HANDOFF_CONTEXT_VERSION = 1;
export const CONTEXT_HANDOFF_SCHEMA_VERSION = 1;
export const CONTEXT_HANDOFF_ERROR_MAX_CHARS = 2_000;

export const ContextHandoffMode = Schema.Literal("full-context-fresh-session");
export type ContextHandoffMode = typeof ContextHandoffMode.Type;

export const ContextHandoffEndpointSnapshot = Schema.Struct({
  providerInstanceId: ProviderInstanceId,
  driverKind: ProviderDriverKind,
  providerDisplayName: Schema.optional(TrimmedNonEmptyString),
  providerAccentColor: Schema.optional(TrimmedNonEmptyString),
  modelSlug: TrimmedNonEmptyString,
  modelDisplayName: Schema.optional(TrimmedNonEmptyString),
});
export type ContextHandoffEndpointSnapshot = typeof ContextHandoffEndpointSnapshot.Type;

const ContextHandoffSources = Schema.Array(ContextHandoffEndpointSnapshot).check(
  Schema.isMinLength(1),
);
const ContextHandoffDigest = TrimmedNonEmptyString.check(Schema.isPattern(/^[a-f0-9]{64}$/));
const ContextHandoffFailure = TrimmedNonEmptyString.check(
  Schema.isMaxLength(CONTEXT_HANDOFF_ERROR_MAX_CHARS),
);

const ContextHandoffActivityBaseFields = {
  schemaVersion: Schema.Literal(CONTEXT_HANDOFF_SCHEMA_VERSION),
  handoffId: ContextHandoffId,
  mode: ContextHandoffMode,
  targetMessageId: MessageId,
  targetTurnId: Schema.optional(TurnId),
  sourceSelection: ModelSelection,
  targetSelection: ModelSelection,
  sourceRuntimeSessionId: Schema.optional(RuntimeSessionId),
  targetRuntimeSessionId: Schema.optional(RuntimeSessionId),
} as const;

const ContextHandoffPresentationFields = {
  sources: ContextHandoffSources,
  target: ContextHandoffEndpointSnapshot,
} as const;

const ContextHandoffContextFields = {
  contextVersion: Schema.Literal(CONTEXT_HANDOFF_CONTEXT_VERSION),
  contextDigest: ContextHandoffDigest,
} as const;

export const ContextHandoffActivityPayload = Schema.Union([
  Schema.Struct({
    ...ContextHandoffActivityBaseFields,
    status: Schema.Literal("requested"),
  }),
  Schema.Struct({
    ...ContextHandoffActivityBaseFields,
    status: Schema.Literal("preparing"),
  }),
  Schema.Struct({
    ...ContextHandoffActivityBaseFields,
    ...ContextHandoffPresentationFields,
    ...ContextHandoffContextFields,
    status: Schema.Literal("dispatching"),
  }),
  Schema.Struct({
    ...ContextHandoffActivityBaseFields,
    ...ContextHandoffPresentationFields,
    ...ContextHandoffContextFields,
    status: Schema.Literal("consumed"),
  }),
  Schema.Struct({
    ...ContextHandoffActivityBaseFields,
    ...ContextHandoffPresentationFields,
    contextVersion: Schema.optional(Schema.Literal(CONTEXT_HANDOFF_CONTEXT_VERSION)),
    contextDigest: Schema.optional(ContextHandoffDigest),
    status: Schema.Literal("failed"),
    error: ContextHandoffFailure,
  }),
  Schema.Struct({
    ...ContextHandoffActivityBaseFields,
    ...ContextHandoffPresentationFields,
    ...ContextHandoffContextFields,
    status: Schema.Literal("delivery-uncertain"),
    error: ContextHandoffFailure,
  }),
]);
export type ContextHandoffActivityPayload = typeof ContextHandoffActivityPayload.Type;

export const ContextHandoffReference = Schema.Struct({
  handoffId: ContextHandoffId,
  activityId: EventId,
  targetMessageId: MessageId,
});
export type ContextHandoffReference = typeof ContextHandoffReference.Type;

export const RuntimeMode = Schema.Literals([
  "approval-required",
  "auto-accept-edits",
  "auto",
  "full-access",
]);
export type RuntimeMode = typeof RuntimeMode.Type;
export const DEFAULT_RUNTIME_MODE: RuntimeMode = "full-access";
export const ProviderInteractionMode = Schema.Literals(["default", "plan", "ask"]);
export type ProviderInteractionMode = typeof ProviderInteractionMode.Type;
export const DEFAULT_PROVIDER_INTERACTION_MODE: ProviderInteractionMode = "default";
export const AgentTokenMode = Schema.Literals(["off", "balanced", "aggressive"]);
export type AgentTokenMode = typeof AgentTokenMode.Type;
export const DEFAULT_AGENT_TOKEN_MODE: AgentTokenMode = "balanced";
export const ProviderRequestKind = Schema.Literals(["command", "file-read", "file-change"]);
export type ProviderRequestKind = typeof ProviderRequestKind.Type;
export const AssistantDeliveryMode = Schema.Literals(["buffered", "streaming"]);
export type AssistantDeliveryMode = typeof AssistantDeliveryMode.Type;
export const ProviderApprovalDecision = Schema.Literals([
  "accept",
  "acceptForSession",
  "decline",
  "cancel",
]);
export type ProviderApprovalDecision = typeof ProviderApprovalDecision.Type;
export const ProviderUserInputAnswers = Schema.Record(Schema.String, Schema.Unknown);
export type ProviderUserInputAnswers = typeof ProviderUserInputAnswers.Type;

export const PROVIDER_SEND_TURN_MAX_INPUT_CHARS = 120_000;
export const PROVIDER_SEND_TURN_MAX_ATTACHMENTS = 8;
export const PROVIDER_SEND_TURN_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const PROVIDER_SEND_TURN_MAX_IMAGE_DATA_URL_CHARS = 14_000_000;
const CHAT_ATTACHMENT_ID_MAX_CHARS = 128;
// Correlation id is command id by design in this model.
export const CorrelationId = CommandId;
export type CorrelationId = typeof CorrelationId.Type;

const ChatAttachmentId = TrimmedNonEmptyString.check(
  Schema.isMaxLength(CHAT_ATTACHMENT_ID_MAX_CHARS),
  Schema.isPattern(/^[a-z0-9_-]+$/i),
);
export type ChatAttachmentId = typeof ChatAttachmentId.Type;

export const ChatImageAttachment = Schema.Struct({
  type: Schema.Literal("image"),
  id: ChatAttachmentId,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
  mimeType: TrimmedNonEmptyString.check(Schema.isMaxLength(100), Schema.isPattern(/^image\//i)),
  sizeBytes: NonNegativeInt.check(Schema.isLessThanOrEqualTo(PROVIDER_SEND_TURN_MAX_IMAGE_BYTES)),
});
export type ChatImageAttachment = typeof ChatImageAttachment.Type;

const UploadChatImageAttachment = Schema.Struct({
  type: Schema.Literal("image"),
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
  mimeType: TrimmedNonEmptyString.check(Schema.isMaxLength(100), Schema.isPattern(/^image\//i)),
  sizeBytes: NonNegativeInt.check(Schema.isLessThanOrEqualTo(PROVIDER_SEND_TURN_MAX_IMAGE_BYTES)),
  dataUrl: TrimmedNonEmptyString.check(
    Schema.isMaxLength(PROVIDER_SEND_TURN_MAX_IMAGE_DATA_URL_CHARS),
  ),
});
export type UploadChatImageAttachment = typeof UploadChatImageAttachment.Type;

export const ChatAttachment = Schema.Union([ChatImageAttachment]);
export type ChatAttachment = typeof ChatAttachment.Type;
const UploadChatAttachment = Schema.Union([UploadChatImageAttachment]);
export type UploadChatAttachment = typeof UploadChatAttachment.Type;

export const ProjectScriptIcon = Schema.Literals([
  "play",
  "test",
  "lint",
  "configure",
  "build",
  "debug",
]);
export type ProjectScriptIcon = typeof ProjectScriptIcon.Type;

export const ProjectScript = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  command: TrimmedNonEmptyString,
  icon: ProjectScriptIcon,
  runOnWorktreeCreate: Schema.Boolean,
});
export type ProjectScript = typeof ProjectScript.Type;

export const PROJECT_CUSTOM_SYSTEM_PROMPT_MAX_CHARS = 20_000;
export const ProjectCustomSystemPrompt = TrimmedNonEmptyString.check(
  Schema.isMaxLength(PROJECT_CUSTOM_SYSTEM_PROMPT_MAX_CHARS),
);
export type ProjectCustomSystemPrompt = typeof ProjectCustomSystemPrompt.Type;

export const DEFAULT_PROJECT_METADATA_DIR = ".ryco";
export const ProjectMetadataDir = TrimmedNonEmptyString.check(
  Schema.isMaxLength(256),
  Schema.isPattern(/^(?![\\/])(?!~)(?![A-Za-z]:[\\/])(?!.*(?:^|[\\/])\.\.(?:[\\/]|$)).+$/),
);
export type ProjectMetadataDir = typeof ProjectMetadataDir.Type;

export const OrchestrationProject = Schema.Struct({
  id: ProjectId,
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  projectMetadataDir: Schema.optional(ProjectMetadataDir).pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROJECT_METADATA_DIR)),
  ),
  repositoryIdentity: Schema.optional(Schema.NullOr(RepositoryIdentity)),
  defaultModelSelection: Schema.NullOr(ModelSelection),
  customSystemPrompt: Schema.optional(Schema.NullOr(ProjectCustomSystemPrompt)),
  scripts: Schema.Array(ProjectScript),
  customAvatarContentHash: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)).pipe(
    Schema.withDecodingDefault(Effect.succeed(null as string | null)),
  ),
  preferredRemoteName: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)).pipe(
    Schema.withDecodingDefault(Effect.succeed(null as string | null)),
  ),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  deletedAt: Schema.NullOr(IsoDateTime),
});
export type OrchestrationProject = typeof OrchestrationProject.Type;

export const OrchestrationMessageRole = Schema.Literals(["user", "assistant", "system"]);
export type OrchestrationMessageRole = typeof OrchestrationMessageRole.Type;

export const OrchestrationMessage = Schema.Struct({
  id: MessageId,
  role: OrchestrationMessageRole,
  text: Schema.String,
  attachments: Schema.optional(Schema.Array(ChatAttachment)),
  turnId: Schema.NullOr(TurnId),
  streaming: Schema.Boolean,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type OrchestrationMessage = typeof OrchestrationMessage.Type;

export const OrchestrationProposedPlanId = TrimmedNonEmptyString;
export type OrchestrationProposedPlanId = typeof OrchestrationProposedPlanId.Type;

export const OrchestrationProposedPlan = Schema.Struct({
  id: OrchestrationProposedPlanId,
  turnId: Schema.NullOr(TurnId),
  planMarkdown: TrimmedNonEmptyString,
  implementedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  implementationThreadId: Schema.NullOr(ThreadId).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type OrchestrationProposedPlan = typeof OrchestrationProposedPlan.Type;

const SourceProposedPlanReference = Schema.Struct({
  threadId: ThreadId,
  planId: OrchestrationProposedPlanId,
});

export const OrchestrationSessionStatus = Schema.Literals([
  "idle",
  "starting",
  "running",
  "ready",
  "interrupted",
  "stopped",
  "error",
]);
export type OrchestrationSessionStatus = typeof OrchestrationSessionStatus.Type;

export const OrchestrationSession = Schema.Struct({
  threadId: ThreadId,
  status: OrchestrationSessionStatus,
  providerName: Schema.NullOr(TrimmedNonEmptyString),
  providerInstanceId: Schema.optional(ProviderInstanceId),
  /** Runtime epoch. Optional only while replaying pre-handoff session events. */
  runtimeSessionId: Schema.optional(RuntimeSessionId),
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(Effect.succeed(DEFAULT_RUNTIME_MODE))),
  tokenMode: Schema.optionalKey(AgentTokenMode),
  activeTurnId: Schema.NullOr(TurnId),
  lastError: Schema.NullOr(TrimmedNonEmptyString),
  updatedAt: IsoDateTime,
});
export type OrchestrationSession = typeof OrchestrationSession.Type;

export const OrchestrationCheckpointFile = Schema.Struct({
  path: TrimmedNonEmptyString,
  kind: TrimmedNonEmptyString,
  additions: NonNegativeInt,
  deletions: NonNegativeInt,
});
export type OrchestrationCheckpointFile = typeof OrchestrationCheckpointFile.Type;

export const OrchestrationCheckpointStatus = Schema.Literals(["ready", "missing", "error"]);
export type OrchestrationCheckpointStatus = typeof OrchestrationCheckpointStatus.Type;

export const OrchestrationCheckpointSummary = Schema.Struct({
  turnId: TurnId,
  checkpointTurnCount: NonNegativeInt,
  checkpointRef: CheckpointRef,
  status: OrchestrationCheckpointStatus,
  files: Schema.Array(OrchestrationCheckpointFile),
  assistantMessageId: Schema.NullOr(MessageId),
  completedAt: IsoDateTime,
});
export type OrchestrationCheckpointSummary = typeof OrchestrationCheckpointSummary.Type;

export const OrchestrationThreadActivityTone = Schema.Literals([
  "info",
  "tool",
  "approval",
  "error",
]);
export type OrchestrationThreadActivityTone = typeof OrchestrationThreadActivityTone.Type;

export const OrchestrationThreadActivity = Schema.Struct({
  id: EventId,
  tone: OrchestrationThreadActivityTone,
  kind: TrimmedNonEmptyString,
  summary: TrimmedNonEmptyString,
  payload: Schema.Unknown,
  turnId: Schema.NullOr(TurnId),
  sequence: Schema.optional(NonNegativeInt),
  createdAt: IsoDateTime,
});
export type OrchestrationThreadActivity = typeof OrchestrationThreadActivity.Type;

const OrchestrationLatestTurnState = Schema.Literals([
  "running",
  "interrupted",
  "completed",
  "error",
]);
export type OrchestrationLatestTurnState = typeof OrchestrationLatestTurnState.Type;

export const OrchestrationLatestTurn = Schema.Struct({
  turnId: TurnId,
  state: OrchestrationLatestTurnState,
  requestedAt: IsoDateTime,
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
  assistantMessageId: Schema.NullOr(MessageId),
  sourceProposedPlan: Schema.optional(SourceProposedPlanReference),
});
export type OrchestrationLatestTurn = typeof OrchestrationLatestTurn.Type;

export const OrchestrationThread = Schema.Struct({
  id: ThreadId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
  ),
  tokenMode: Schema.optionalKey(AgentTokenMode),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  worktreeId: Schema.optional(Schema.NullOr(WorktreeId)),
  manualStatusBucket: Schema.optional(Schema.NullOr(StatusBucket)),
  manualPosition: Schema.optional(Schema.Number),
  latestTurn: Schema.NullOr(OrchestrationLatestTurn),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  archivedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  deletedAt: Schema.NullOr(IsoDateTime),
  messages: Schema.Array(OrchestrationMessage),
  proposedPlans: Schema.Array(OrchestrationProposedPlan).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  activities: Schema.Array(OrchestrationThreadActivity),
  checkpoints: Schema.Array(OrchestrationCheckpointSummary),
  session: Schema.NullOr(OrchestrationSession),
});
export type OrchestrationThread = typeof OrchestrationThread.Type;

export const OrchestrationWorktreeShell = Worktree;
export type OrchestrationWorktreeShell = typeof OrchestrationWorktreeShell.Type;

export const OrchestrationReadModel = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  projects: Schema.Array(OrchestrationProject),
  worktrees: Schema.optional(Schema.Array(OrchestrationWorktreeShell)),
  threads: Schema.Array(OrchestrationThread),
  updatedAt: IsoDateTime,
});
export type OrchestrationReadModel = typeof OrchestrationReadModel.Type;

export const OrchestrationProjectShell = Schema.Struct({
  id: ProjectId,
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  projectMetadataDir: Schema.optional(ProjectMetadataDir).pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROJECT_METADATA_DIR)),
  ),
  repositoryIdentity: Schema.optional(Schema.NullOr(RepositoryIdentity)),
  defaultModelSelection: Schema.NullOr(ModelSelection),
  customSystemPrompt: Schema.optional(Schema.NullOr(ProjectCustomSystemPrompt)),
  customAvatarContentHash: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)).pipe(
    Schema.withDecodingDefault(Effect.succeed(null as string | null)),
  ),
  preferredRemoteName: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)).pipe(
    Schema.withDecodingDefault(Effect.succeed(null as string | null)),
  ),
  scripts: Schema.Array(ProjectScript),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type OrchestrationProjectShell = typeof OrchestrationProjectShell.Type;

export const OrchestrationThreadShell = Schema.Struct({
  id: ThreadId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
  ),
  tokenMode: Schema.optionalKey(AgentTokenMode),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  worktreeId: Schema.optional(Schema.NullOr(WorktreeId)),
  manualStatusBucket: Schema.optional(Schema.NullOr(StatusBucket)),
  manualPosition: Schema.optional(Schema.Number),
  latestTurn: Schema.NullOr(OrchestrationLatestTurn),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  archivedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  session: Schema.NullOr(OrchestrationSession),
  latestUserMessageAt: Schema.NullOr(IsoDateTime),
  hasPendingApprovals: Schema.Boolean,
  hasPendingUserInput: Schema.Boolean,
  hasActionableProposedPlan: Schema.Boolean,
});
export type OrchestrationThreadShell = typeof OrchestrationThreadShell.Type;

export const OrchestrationShellSnapshot = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  projects: Schema.Array(OrchestrationProjectShell),
  worktrees: Schema.optional(Schema.Array(OrchestrationWorktreeShell)),
  threads: Schema.Array(OrchestrationThreadShell),
  updatedAt: IsoDateTime,
});
export type OrchestrationShellSnapshot = typeof OrchestrationShellSnapshot.Type;

export const OrchestrationShellStreamEvent = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("project-upserted"),
    sequence: NonNegativeInt,
    project: OrchestrationProjectShell,
  }),
  Schema.Struct({
    kind: Schema.Literal("project-removed"),
    sequence: NonNegativeInt,
    projectId: ProjectId,
  }),
  Schema.Struct({
    kind: Schema.Literal("thread-upserted"),
    sequence: NonNegativeInt,
    thread: OrchestrationThreadShell,
  }),
  Schema.Struct({
    kind: Schema.Literal("worktree-upserted"),
    sequence: NonNegativeInt,
    worktree: OrchestrationWorktreeShell,
  }),
  Schema.Struct({
    kind: Schema.Literal("thread-removed"),
    sequence: NonNegativeInt,
    threadId: ThreadId,
  }),
  Schema.Struct({
    kind: Schema.Literal("worktree-removed"),
    sequence: NonNegativeInt,
    worktreeId: WorktreeId,
  }),
]);
export type OrchestrationShellStreamEvent = typeof OrchestrationShellStreamEvent.Type;

export const OrchestrationShellStreamItem = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("snapshot"),
    snapshot: OrchestrationShellSnapshot,
  }),
  OrchestrationShellStreamEvent,
]);
export type OrchestrationShellStreamItem = typeof OrchestrationShellStreamItem.Type;

export const OrchestrationSubscribeThreadInput = Schema.Struct({
  threadId: ThreadId,
});
export type OrchestrationSubscribeThreadInput = typeof OrchestrationSubscribeThreadInput.Type;

export const OrchestrationThreadDetailSnapshot = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  thread: OrchestrationThread,
});
export type OrchestrationThreadDetailSnapshot = typeof OrchestrationThreadDetailSnapshot.Type;

export const ProjectCreateCommand = Schema.Struct({
  type: Schema.Literal("project.create"),
  commandId: CommandId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  projectMetadataDir: Schema.optional(ProjectMetadataDir).pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROJECT_METADATA_DIR)),
  ),
  createWorkspaceRootIfMissing: Schema.optional(Schema.Boolean),
  defaultModelSelection: Schema.optional(Schema.NullOr(ModelSelection)),
  customSystemPrompt: Schema.optional(Schema.NullOr(ProjectCustomSystemPrompt)),
  createdAt: IsoDateTime,
});

const ProjectMetaUpdateCommand = Schema.Struct({
  type: Schema.Literal("project.meta.update"),
  commandId: CommandId,
  projectId: ProjectId,
  title: Schema.optional(TrimmedNonEmptyString),
  workspaceRoot: Schema.optional(TrimmedNonEmptyString),
  projectMetadataDir: Schema.optional(ProjectMetadataDir),
  defaultModelSelection: Schema.optional(Schema.NullOr(ModelSelection)),
  customSystemPrompt: Schema.optional(Schema.NullOr(ProjectCustomSystemPrompt)),
  scripts: Schema.optional(Schema.Array(ProjectScript)),
  preferredRemoteName: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
});

const ProjectAvatarSetCommand = Schema.Struct({
  type: Schema.Literal("project.avatar.set"),
  commandId: CommandId,
  projectId: ProjectId,
  contentHash: Schema.NullOr(TrimmedNonEmptyString),
});

const ProjectDeleteCommand = Schema.Struct({
  type: Schema.Literal("project.delete"),
  commandId: CommandId,
  projectId: ProjectId,
  force: Schema.optional(Schema.Boolean),
});

const ThreadCreateCommand = Schema.Struct({
  type: Schema.Literal("thread.create"),
  commandId: CommandId,
  threadId: ThreadId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
  ),
  tokenMode: Schema.optionalKey(AgentTokenMode),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
});

const ThreadDeleteCommand = Schema.Struct({
  type: Schema.Literal("thread.delete"),
  commandId: CommandId,
  threadId: ThreadId,
});

const ThreadArchiveCommand = Schema.Struct({
  type: Schema.Literal("thread.archive"),
  commandId: CommandId,
  threadId: ThreadId,
});

const ThreadUnarchiveCommand = Schema.Struct({
  type: Schema.Literal("thread.unarchive"),
  commandId: CommandId,
  threadId: ThreadId,
});

const ThreadMetaUpdateCommand = Schema.Struct({
  type: Schema.Literal("thread.meta.update"),
  commandId: CommandId,
  threadId: ThreadId,
  title: Schema.optional(TrimmedNonEmptyString),
  modelSelection: Schema.optional(ModelSelection),
  branch: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  worktreePath: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
});

const ThreadRuntimeModeSetCommand = Schema.Struct({
  type: Schema.Literal("thread.runtime-mode.set"),
  commandId: CommandId,
  threadId: ThreadId,
  runtimeMode: RuntimeMode,
  createdAt: IsoDateTime,
});

const ThreadInteractionModeSetCommand = Schema.Struct({
  type: Schema.Literal("thread.interaction-mode.set"),
  commandId: CommandId,
  threadId: ThreadId,
  interactionMode: ProviderInteractionMode,
  createdAt: IsoDateTime,
});

const ThreadTokenModeSetCommand = Schema.Struct({
  type: Schema.Literal("thread.token-mode.set"),
  commandId: CommandId,
  threadId: ThreadId,
  tokenMode: AgentTokenMode,
  createdAt: IsoDateTime,
});

const ThreadTurnStartBootstrapCreateThread = Schema.Struct({
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  tokenMode: Schema.optionalKey(AgentTokenMode),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
});

const ThreadTurnStartBootstrapPrepareWorktree = Schema.Struct({
  projectCwd: TrimmedNonEmptyString,
  baseBranch: TrimmedNonEmptyString,
  branch: Schema.optional(TrimmedNonEmptyString),
});

const ThreadTurnStartBootstrap = Schema.Struct({
  createThread: Schema.optional(ThreadTurnStartBootstrapCreateThread),
  prepareWorktree: Schema.optional(ThreadTurnStartBootstrapPrepareWorktree),
  runSetupScript: Schema.optional(Schema.Boolean),
});

export type ThreadTurnStartBootstrap = typeof ThreadTurnStartBootstrap.Type;

export const ThreadTurnStartCommand = Schema.Struct({
  type: Schema.Literal("thread.turn.start"),
  commandId: CommandId,
  threadId: ThreadId,
  message: Schema.Struct({
    messageId: MessageId,
    role: Schema.Literal("user"),
    text: Schema.String,
    attachments: Schema.Array(ChatAttachment),
  }),
  modelSelection: Schema.optional(ModelSelection),
  titleSeed: Schema.optional(TrimmedNonEmptyString),
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(Effect.succeed(DEFAULT_RUNTIME_MODE))),
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
  ),
  tokenMode: Schema.optionalKey(AgentTokenMode),
  bootstrap: Schema.optional(ThreadTurnStartBootstrap),
  sourceProposedPlan: Schema.optional(SourceProposedPlanReference),
  sourceControlContexts: Schema.optional(Schema.Array(ComposerSourceControlContext)),
  createdAt: IsoDateTime,
});

const ClientThreadTurnStartCommand = Schema.Struct({
  type: Schema.Literal("thread.turn.start"),
  commandId: CommandId,
  threadId: ThreadId,
  message: Schema.Struct({
    messageId: MessageId,
    role: Schema.Literal("user"),
    text: Schema.String,
    attachments: Schema.Array(UploadChatAttachment),
  }),
  modelSelection: Schema.optional(ModelSelection),
  titleSeed: Schema.optional(TrimmedNonEmptyString),
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  tokenMode: Schema.optionalKey(AgentTokenMode),
  bootstrap: Schema.optional(ThreadTurnStartBootstrap),
  sourceProposedPlan: Schema.optional(SourceProposedPlanReference),
  sourceControlContexts: Schema.optional(Schema.Array(ComposerSourceControlContext)),
  createdAt: IsoDateTime,
});

const ThreadTurnInterruptCommand = Schema.Struct({
  type: Schema.Literal("thread.turn.interrupt"),
  commandId: CommandId,
  threadId: ThreadId,
  turnId: Schema.optional(TurnId),
  createdAt: IsoDateTime,
});

const ThreadApprovalRespondCommand = Schema.Struct({
  type: Schema.Literal("thread.approval.respond"),
  commandId: CommandId,
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  decision: ProviderApprovalDecision,
  createdAt: IsoDateTime,
});

const ThreadUserInputRespondCommand = Schema.Struct({
  type: Schema.Literal("thread.user-input.respond"),
  commandId: CommandId,
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  answers: ProviderUserInputAnswers,
  createdAt: IsoDateTime,
});

const ThreadCheckpointRevertCommand = Schema.Struct({
  type: Schema.Literal("thread.checkpoint.revert"),
  commandId: CommandId,
  threadId: ThreadId,
  turnCount: NonNegativeInt,
  createdAt: IsoDateTime,
});

const ThreadSessionStopCommand = Schema.Struct({
  type: Schema.Literal("thread.session.stop"),
  commandId: CommandId,
  threadId: ThreadId,
  createdAt: IsoDateTime,
});

const WorktreeCreateCommand = Schema.Struct({
  type: Schema.Literal("worktree.create"),
  commandId: CommandId,
  worktreeId: WorktreeId,
  projectId: ProjectId,
  branch: TrimmedNonEmptyString,
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  origin: WorktreeOrigin,
  prNumber: Schema.NullOr(Schema.Number),
  issueNumber: Schema.NullOr(Schema.Number),
  prTitle: Schema.NullOr(TrimmedNonEmptyString),
  issueTitle: Schema.NullOr(TrimmedNonEmptyString),
  workItemProvider: Schema.optional(Schema.NullOr(WorkItemProviderKind)),
  workItemKey: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  workItemTitle: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  workItemState: Schema.optional(Schema.NullOr(WorkItemState)),
  workItemStateName: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  workItemUrl: Schema.optional(Schema.NullOr(Schema.String)),
  createdAt: IsoDateTime,
});

const WorktreeArchiveCommand = Schema.Struct({
  type: Schema.Literal("worktree.archive"),
  commandId: CommandId,
  worktreeId: WorktreeId,
  archivedAt: IsoDateTime,
  deletedBranch: Schema.Boolean,
});

const WorktreeMetaUpdateCommand = Schema.Struct({
  type: Schema.Literal("worktree.meta.update"),
  commandId: CommandId,
  worktreeId: WorktreeId,
  title: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  branch: Schema.optional(TrimmedNonEmptyString),
  changedAt: IsoDateTime,
});

const WorktreeSourceControlStateUpdateCommand = Schema.Struct({
  type: Schema.Literal("worktree.source-control-state.update"),
  commandId: CommandId,
  worktreeId: WorktreeId,
  prNumber: Schema.optional(Schema.NullOr(Schema.Number)),
  prTitle: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  prState: Schema.NullOr(PullRequestState),
  prIsDraft: Schema.NullOr(Schema.Boolean),
  issueState: Schema.NullOr(IssueState),
  updatedAt: IsoDateTime,
});

const WorktreeRestoreCommand = Schema.Struct({
  type: Schema.Literal("worktree.restore"),
  commandId: CommandId,
  worktreeId: WorktreeId,
  worktreePath: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  restoredAt: IsoDateTime,
});

const WorktreeDeleteCommand = Schema.Struct({
  type: Schema.Literal("worktree.delete"),
  commandId: CommandId,
  worktreeId: WorktreeId,
  deletedAt: IsoDateTime,
  deletedBranch: Schema.Boolean,
});

const ThreadAttachToWorktreeCommand = Schema.Struct({
  type: Schema.Literal("thread.attach-to-worktree"),
  commandId: CommandId,
  threadId: ThreadId,
  worktreeId: WorktreeId,
  attachedAt: IsoDateTime,
});

const ThreadStatusBucketOverrideCommand = Schema.Struct({
  type: Schema.Literal("thread.status-bucket.override"),
  commandId: CommandId,
  threadId: ThreadId,
  bucket: Schema.NullOr(StatusBucket),
  changedAt: IsoDateTime,
});

const ThreadManualPositionSetCommand = Schema.Struct({
  type: Schema.Literal("thread.manual-position.set"),
  commandId: CommandId,
  threadId: ThreadId,
  position: Schema.Number,
  changedAt: IsoDateTime,
});

const WorktreeManualPositionSetCommand = Schema.Struct({
  type: Schema.Literal("worktree.manual-position.set"),
  commandId: CommandId,
  worktreeId: WorktreeId,
  position: Schema.Number,
  changedAt: IsoDateTime,
});

const DispatchableClientOrchestrationCommand = Schema.Union([
  ProjectCreateCommand,
  ProjectMetaUpdateCommand,
  ProjectAvatarSetCommand,
  ProjectDeleteCommand,
  ThreadCreateCommand,
  ThreadDeleteCommand,
  ThreadArchiveCommand,
  ThreadUnarchiveCommand,
  ThreadMetaUpdateCommand,
  ThreadRuntimeModeSetCommand,
  ThreadInteractionModeSetCommand,
  ThreadTokenModeSetCommand,
  ThreadTurnStartCommand,
  ThreadTurnInterruptCommand,
  ThreadApprovalRespondCommand,
  ThreadUserInputRespondCommand,
  ThreadCheckpointRevertCommand,
  ThreadSessionStopCommand,
  WorktreeCreateCommand,
  WorktreeArchiveCommand,
  WorktreeMetaUpdateCommand,
  WorktreeSourceControlStateUpdateCommand,
  WorktreeRestoreCommand,
  WorktreeDeleteCommand,
  ThreadAttachToWorktreeCommand,
  ThreadStatusBucketOverrideCommand,
  ThreadManualPositionSetCommand,
  WorktreeManualPositionSetCommand,
]);
export type DispatchableClientOrchestrationCommand =
  typeof DispatchableClientOrchestrationCommand.Type;

export const ClientOrchestrationCommand = Schema.Union([
  ProjectCreateCommand,
  ProjectMetaUpdateCommand,
  ProjectAvatarSetCommand,
  ProjectDeleteCommand,
  ThreadCreateCommand,
  ThreadDeleteCommand,
  ThreadArchiveCommand,
  ThreadUnarchiveCommand,
  ThreadMetaUpdateCommand,
  ThreadRuntimeModeSetCommand,
  ThreadInteractionModeSetCommand,
  ThreadTokenModeSetCommand,
  ClientThreadTurnStartCommand,
  ThreadTurnInterruptCommand,
  ThreadApprovalRespondCommand,
  ThreadUserInputRespondCommand,
  ThreadCheckpointRevertCommand,
  ThreadSessionStopCommand,
  WorktreeCreateCommand,
  WorktreeArchiveCommand,
  WorktreeMetaUpdateCommand,
  WorktreeSourceControlStateUpdateCommand,
  WorktreeRestoreCommand,
  WorktreeDeleteCommand,
  ThreadAttachToWorktreeCommand,
  ThreadStatusBucketOverrideCommand,
  ThreadManualPositionSetCommand,
  WorktreeManualPositionSetCommand,
]);
export type ClientOrchestrationCommand = typeof ClientOrchestrationCommand.Type;

const ThreadSessionSetCommand = Schema.Struct({
  type: Schema.Literal("thread.session.set"),
  commandId: CommandId,
  threadId: ThreadId,
  session: OrchestrationSession,
  createdAt: IsoDateTime,
});

const ThreadMessageAssistantDeltaCommand = Schema.Struct({
  type: Schema.Literal("thread.message.assistant.delta"),
  commandId: CommandId,
  threadId: ThreadId,
  messageId: MessageId,
  delta: Schema.String,
  turnId: Schema.optional(TurnId),
  createdAt: IsoDateTime,
});

const ThreadMessageAssistantCompleteCommand = Schema.Struct({
  type: Schema.Literal("thread.message.assistant.complete"),
  commandId: CommandId,
  threadId: ThreadId,
  messageId: MessageId,
  turnId: Schema.optional(TurnId),
  createdAt: IsoDateTime,
});

const ThreadProposedPlanUpsertCommand = Schema.Struct({
  type: Schema.Literal("thread.proposed-plan.upsert"),
  commandId: CommandId,
  threadId: ThreadId,
  proposedPlan: OrchestrationProposedPlan,
  createdAt: IsoDateTime,
});

const ThreadTurnDiffCompleteCommand = Schema.Struct({
  type: Schema.Literal("thread.turn.diff.complete"),
  commandId: CommandId,
  threadId: ThreadId,
  turnId: TurnId,
  completedAt: IsoDateTime,
  checkpointRef: CheckpointRef,
  status: OrchestrationCheckpointStatus,
  files: Schema.Array(OrchestrationCheckpointFile),
  assistantMessageId: Schema.optional(MessageId),
  checkpointTurnCount: NonNegativeInt,
  createdAt: IsoDateTime,
});

const ThreadActivityAppendCommand = Schema.Struct({
  type: Schema.Literal("thread.activity.append"),
  commandId: CommandId,
  threadId: ThreadId,
  activity: OrchestrationThreadActivity,
  createdAt: IsoDateTime,
});

const ThreadRevertCompleteCommand = Schema.Struct({
  type: Schema.Literal("thread.revert.complete"),
  commandId: CommandId,
  threadId: ThreadId,
  turnCount: NonNegativeInt,
  createdAt: IsoDateTime,
});

const InternalOrchestrationCommand = Schema.Union([
  ThreadSessionSetCommand,
  ThreadMessageAssistantDeltaCommand,
  ThreadMessageAssistantCompleteCommand,
  ThreadProposedPlanUpsertCommand,
  ThreadTurnDiffCompleteCommand,
  ThreadActivityAppendCommand,
  ThreadRevertCompleteCommand,
]);
export type InternalOrchestrationCommand = typeof InternalOrchestrationCommand.Type;

export const OrchestrationCommand = Schema.Union([
  DispatchableClientOrchestrationCommand,
  InternalOrchestrationCommand,
]);
export type OrchestrationCommand = typeof OrchestrationCommand.Type;

export const OrchestrationEventType = Schema.Literals([
  "project.created",
  "project.meta-updated",
  "project.avatar-set",
  "project.deleted",
  "thread.created",
  "thread.deleted",
  "thread.archived",
  "thread.unarchived",
  "thread.meta-updated",
  "thread.runtime-mode-set",
  "thread.interaction-mode-set",
  "thread.token-mode-set",
  "thread.context-handoff-requested",
  "thread.message-sent",
  "thread.turn-start-requested",
  "thread.turn-interrupt-requested",
  "thread.approval-response-requested",
  "thread.user-input-response-requested",
  "thread.checkpoint-revert-requested",
  "thread.reverted",
  "thread.session-stop-requested",
  "thread.session-set",
  "thread.proposed-plan-upserted",
  "thread.turn-diff-completed",
  "thread.activity-appended",
  "worktree.created",
  "worktree.archived",
  "worktree.metaUpdated",
  "worktree.sourceControlStateUpdated",
  "worktree.restored",
  "worktree.deleted",
  "thread.attachedToWorktree",
  "thread.statusBucketOverridden",
  "thread.manualPositionSet",
  "worktree.manualPositionSet",
]);
export type OrchestrationEventType = typeof OrchestrationEventType.Type;

export const OrchestrationAggregateKind = Schema.Literals(["project", "thread", "worktree"]);
export type OrchestrationAggregateKind = typeof OrchestrationAggregateKind.Type;
export const OrchestrationActorKind = Schema.Literals(["client", "server", "provider"]);

export const ProjectCreatedPayload = Schema.Struct({
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  projectMetadataDir: Schema.optional(ProjectMetadataDir).pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROJECT_METADATA_DIR)),
  ),
  repositoryIdentity: Schema.optional(Schema.NullOr(RepositoryIdentity)),
  defaultModelSelection: Schema.NullOr(ModelSelection),
  customSystemPrompt: Schema.optional(Schema.NullOr(ProjectCustomSystemPrompt)),
  scripts: Schema.Array(ProjectScript),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const ProjectMetaUpdatedPayload = Schema.Struct({
  projectId: ProjectId,
  title: Schema.optional(TrimmedNonEmptyString),
  workspaceRoot: Schema.optional(TrimmedNonEmptyString),
  projectMetadataDir: Schema.optional(ProjectMetadataDir),
  repositoryIdentity: Schema.optional(Schema.NullOr(RepositoryIdentity)),
  defaultModelSelection: Schema.optional(Schema.NullOr(ModelSelection)),
  customSystemPrompt: Schema.optional(Schema.NullOr(ProjectCustomSystemPrompt)),
  scripts: Schema.optional(Schema.Array(ProjectScript)),
  preferredRemoteName: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  updatedAt: IsoDateTime,
});

export const ProjectAvatarSetPayload = Schema.Struct({
  projectId: ProjectId,
  contentHash: Schema.NullOr(TrimmedNonEmptyString),
  updatedAt: IsoDateTime,
});

export const ProjectDeletedPayload = Schema.Struct({
  projectId: ProjectId,
  deletedAt: IsoDateTime,
});

export const ThreadCreatedPayload = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(Effect.succeed(DEFAULT_RUNTIME_MODE))),
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
  ),
  tokenMode: Schema.optionalKey(AgentTokenMode),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const ThreadDeletedPayload = Schema.Struct({
  threadId: ThreadId,
  deletedAt: IsoDateTime,
});

export const ThreadArchivedPayload = Schema.Struct({
  threadId: ThreadId,
  archivedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const ThreadUnarchivedPayload = Schema.Struct({
  threadId: ThreadId,
  updatedAt: IsoDateTime,
});

export const ThreadMetaUpdatedPayload = Schema.Struct({
  threadId: ThreadId,
  title: Schema.optional(TrimmedNonEmptyString),
  modelSelection: Schema.optional(ModelSelection),
  branch: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  worktreePath: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  updatedAt: IsoDateTime,
});

export const ThreadRuntimeModeSetPayload = Schema.Struct({
  threadId: ThreadId,
  runtimeMode: RuntimeMode,
  updatedAt: IsoDateTime,
});

export const ThreadInteractionModeSetPayload = Schema.Struct({
  threadId: ThreadId,
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
  ),
  updatedAt: IsoDateTime,
});

export const ThreadTokenModeSetPayload = Schema.Struct({
  threadId: ThreadId,
  tokenMode: Schema.optionalKey(AgentTokenMode),
  updatedAt: IsoDateTime,
});

export const ThreadMessageSentPayload = Schema.Struct({
  threadId: ThreadId,
  messageId: MessageId,
  role: OrchestrationMessageRole,
  text: Schema.String,
  attachments: Schema.optional(Schema.Array(ChatAttachment)),
  turnId: Schema.NullOr(TurnId),
  streaming: Schema.Boolean,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const ThreadContextHandoffRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  handoffId: ContextHandoffId,
  activityId: EventId,
  mode: ContextHandoffMode,
  targetMessageId: MessageId,
  sourceSelection: ModelSelection,
  targetSelection: ModelSelection,
  sourceRuntimeSessionId: Schema.optional(RuntimeSessionId),
  createdAt: IsoDateTime,
});
export type ThreadContextHandoffRequestedPayload = typeof ThreadContextHandoffRequestedPayload.Type;

export const ThreadTurnStartRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  messageId: MessageId,
  modelSelection: Schema.optional(ModelSelection),
  titleSeed: Schema.optional(TrimmedNonEmptyString),
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(Effect.succeed(DEFAULT_RUNTIME_MODE))),
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
  ),
  tokenMode: AgentTokenMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_AGENT_TOKEN_MODE)),
  ),
  sourceProposedPlan: Schema.optional(SourceProposedPlanReference),
  contextHandoff: Schema.optional(ContextHandoffReference),
  createdAt: IsoDateTime,
});

export const ThreadTurnInterruptRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  turnId: Schema.optional(TurnId),
  createdAt: IsoDateTime,
});

export const ThreadApprovalResponseRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  decision: ProviderApprovalDecision,
  createdAt: IsoDateTime,
});

const ThreadUserInputResponseRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  answers: ProviderUserInputAnswers,
  createdAt: IsoDateTime,
});

export const ThreadCheckpointRevertRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  turnCount: NonNegativeInt,
  createdAt: IsoDateTime,
});

export const ThreadRevertedPayload = Schema.Struct({
  threadId: ThreadId,
  turnCount: NonNegativeInt,
});

export const ThreadSessionStopRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  createdAt: IsoDateTime,
});

export const ThreadSessionSetPayload = Schema.Struct({
  threadId: ThreadId,
  session: OrchestrationSession,
});

export const ThreadProposedPlanUpsertedPayload = Schema.Struct({
  threadId: ThreadId,
  proposedPlan: OrchestrationProposedPlan,
});

export const ThreadTurnDiffCompletedPayload = Schema.Struct({
  threadId: ThreadId,
  turnId: TurnId,
  checkpointTurnCount: NonNegativeInt,
  checkpointRef: CheckpointRef,
  status: OrchestrationCheckpointStatus,
  files: Schema.Array(OrchestrationCheckpointFile),
  assistantMessageId: Schema.NullOr(MessageId),
  completedAt: IsoDateTime,
});

export const ThreadActivityAppendedPayload = Schema.Struct({
  threadId: ThreadId,
  activity: OrchestrationThreadActivity,
});

export const WorktreeCreatedPayload = Schema.Struct({
  worktreeId: WorktreeId,
  projectId: ProjectId,
  branch: TrimmedNonEmptyString,
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  origin: WorktreeOrigin,
  prNumber: Schema.NullOr(Schema.Number),
  issueNumber: Schema.NullOr(Schema.Number),
  prTitle: Schema.NullOr(TrimmedNonEmptyString),
  issueTitle: Schema.NullOr(TrimmedNonEmptyString),
  workItemProvider: Schema.optional(Schema.NullOr(WorkItemProviderKind)),
  workItemKey: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  workItemTitle: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  workItemState: Schema.optional(Schema.NullOr(WorkItemState)),
  workItemStateName: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  workItemUrl: Schema.optional(Schema.NullOr(Schema.String)),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const WorktreeArchivedPayload = Schema.Struct({
  worktreeId: WorktreeId,
  archivedAt: IsoDateTime,
  deletedBranch: Schema.Boolean,
});

export const WorktreeMetaUpdatedPayload = Schema.Struct({
  worktreeId: WorktreeId,
  title: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  branch: Schema.optional(TrimmedNonEmptyString),
  changedAt: IsoDateTime,
});

export const WorktreeSourceControlStateUpdatedPayload = Schema.Struct({
  worktreeId: WorktreeId,
  prNumber: Schema.optional(Schema.NullOr(Schema.Number)),
  prTitle: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  prState: Schema.NullOr(PullRequestState),
  prIsDraft: Schema.NullOr(Schema.Boolean),
  issueState: Schema.NullOr(IssueState),
  updatedAt: IsoDateTime,
});
export type WorktreeSourceControlStateUpdatedPayload =
  typeof WorktreeSourceControlStateUpdatedPayload.Type;

export const WorktreeRestoredPayload = Schema.Struct({
  worktreeId: WorktreeId,
  worktreePath: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  restoredAt: IsoDateTime,
});

export const WorktreeDeletedPayload = Schema.Struct({
  worktreeId: WorktreeId,
  deletedAt: IsoDateTime,
  deletedBranch: Schema.Boolean,
});

export const ThreadAttachedToWorktreePayload = Schema.Struct({
  threadId: ThreadId,
  worktreeId: WorktreeId,
  attachedAt: IsoDateTime,
});

export const ThreadStatusBucketOverriddenPayload = Schema.Struct({
  threadId: ThreadId,
  bucket: Schema.NullOr(StatusBucket),
  changedAt: IsoDateTime,
});

export const ThreadManualPositionSetPayload = Schema.Struct({
  threadId: ThreadId,
  position: Schema.Number,
  changedAt: IsoDateTime,
});

export const WorktreeManualPositionSetPayload = Schema.Struct({
  worktreeId: WorktreeId,
  position: Schema.Number,
  changedAt: IsoDateTime,
});

export const OrchestrationEventMetadata = Schema.Struct({
  providerTurnId: Schema.optional(TrimmedNonEmptyString),
  providerItemId: Schema.optional(ProviderItemId),
  adapterKey: Schema.optional(TrimmedNonEmptyString),
  requestId: Schema.optional(ApprovalRequestId),
  ingestedAt: Schema.optional(IsoDateTime),
});
export type OrchestrationEventMetadata = typeof OrchestrationEventMetadata.Type;

const EventBaseFields = {
  sequence: NonNegativeInt,
  eventId: EventId,
  aggregateKind: OrchestrationAggregateKind,
  aggregateId: Schema.Union([ProjectId, ThreadId, WorktreeId]),
  occurredAt: IsoDateTime,
  commandId: Schema.NullOr(CommandId),
  causationEventId: Schema.NullOr(EventId),
  correlationId: Schema.NullOr(CommandId),
  metadata: OrchestrationEventMetadata,
} as const;

export const OrchestrationEvent = Schema.Union([
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("project.created"),
    payload: ProjectCreatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("project.meta-updated"),
    payload: ProjectMetaUpdatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("project.deleted"),
    payload: ProjectDeletedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("project.avatar-set"),
    payload: ProjectAvatarSetPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.created"),
    payload: ThreadCreatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.deleted"),
    payload: ThreadDeletedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.archived"),
    payload: ThreadArchivedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.unarchived"),
    payload: ThreadUnarchivedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.meta-updated"),
    payload: ThreadMetaUpdatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.runtime-mode-set"),
    payload: ThreadRuntimeModeSetPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.interaction-mode-set"),
    payload: ThreadInteractionModeSetPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.token-mode-set"),
    payload: ThreadTokenModeSetPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.context-handoff-requested"),
    payload: ThreadContextHandoffRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.message-sent"),
    payload: ThreadMessageSentPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.turn-start-requested"),
    payload: ThreadTurnStartRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.turn-interrupt-requested"),
    payload: ThreadTurnInterruptRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.approval-response-requested"),
    payload: ThreadApprovalResponseRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.user-input-response-requested"),
    payload: ThreadUserInputResponseRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.checkpoint-revert-requested"),
    payload: ThreadCheckpointRevertRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.reverted"),
    payload: ThreadRevertedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.session-stop-requested"),
    payload: ThreadSessionStopRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.session-set"),
    payload: ThreadSessionSetPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.proposed-plan-upserted"),
    payload: ThreadProposedPlanUpsertedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.turn-diff-completed"),
    payload: ThreadTurnDiffCompletedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.activity-appended"),
    payload: ThreadActivityAppendedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("worktree.created"),
    payload: WorktreeCreatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("worktree.archived"),
    payload: WorktreeArchivedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("worktree.metaUpdated"),
    payload: WorktreeMetaUpdatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("worktree.sourceControlStateUpdated"),
    payload: WorktreeSourceControlStateUpdatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("worktree.restored"),
    payload: WorktreeRestoredPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("worktree.deleted"),
    payload: WorktreeDeletedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.attachedToWorktree"),
    payload: ThreadAttachedToWorktreePayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.statusBucketOverridden"),
    payload: ThreadStatusBucketOverriddenPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.manualPositionSet"),
    payload: ThreadManualPositionSetPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("worktree.manualPositionSet"),
    payload: WorktreeManualPositionSetPayload,
  }),
]);
export type OrchestrationEvent = typeof OrchestrationEvent.Type;

export const OrchestrationThreadStreamItem = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("snapshot"),
    snapshot: OrchestrationThreadDetailSnapshot,
  }),
  Schema.Struct({
    kind: Schema.Literal("event"),
    event: OrchestrationEvent,
  }),
]);
export type OrchestrationThreadStreamItem = typeof OrchestrationThreadStreamItem.Type;

export const OrchestrationCommandReceiptStatus = Schema.Literals(["accepted", "rejected"]);
export type OrchestrationCommandReceiptStatus = typeof OrchestrationCommandReceiptStatus.Type;

export const TurnCountRange = Schema.Struct({
  fromTurnCount: NonNegativeInt,
  toTurnCount: NonNegativeInt,
}).check(
  Schema.makeFilter(
    (input) =>
      input.fromTurnCount <= input.toTurnCount ||
      new SchemaIssue.InvalidValue(Option.some(input.fromTurnCount), {
        message: "fromTurnCount must be less than or equal to toTurnCount",
      }),
    { identifier: "OrchestrationTurnDiffRange" },
  ),
);

export const ThreadTurnDiff = TurnCountRange.mapFields(
  Struct.assign({
    threadId: ThreadId,
    diff: Schema.String,
  }),
  { unsafePreserveChecks: true },
);

export const ProviderSessionRuntimeStatus = Schema.Literals([
  "starting",
  "running",
  "stopped",
  "error",
]);
export type ProviderSessionRuntimeStatus = typeof ProviderSessionRuntimeStatus.Type;

const ProjectionThreadTurnStatus = Schema.Literals([
  "running",
  "completed",
  "interrupted",
  "error",
]);
export type ProjectionThreadTurnStatus = typeof ProjectionThreadTurnStatus.Type;

const ProjectionCheckpointRow = Schema.Struct({
  threadId: ThreadId,
  turnId: TurnId,
  checkpointTurnCount: NonNegativeInt,
  checkpointRef: CheckpointRef,
  status: OrchestrationCheckpointStatus,
  files: Schema.Array(OrchestrationCheckpointFile),
  assistantMessageId: Schema.NullOr(MessageId),
  completedAt: IsoDateTime,
});
export type ProjectionCheckpointRow = typeof ProjectionCheckpointRow.Type;

export const ProjectionPendingApprovalStatus = Schema.Literals(["pending", "resolved"]);
export type ProjectionPendingApprovalStatus = typeof ProjectionPendingApprovalStatus.Type;

export const ProjectionPendingApprovalDecision = Schema.NullOr(ProviderApprovalDecision);
export type ProjectionPendingApprovalDecision = typeof ProjectionPendingApprovalDecision.Type;

export const DispatchResult = Schema.Struct({
  sequence: NonNegativeInt,
});
export type DispatchResult = typeof DispatchResult.Type;

export const OrchestrationGetTurnDiffInput = TurnCountRange.mapFields(
  Struct.assign({
    threadId: ThreadId,
    ignoreWhitespace: Schema.optionalKey(Schema.Boolean),
  }),
  { unsafePreserveChecks: true },
);
export type OrchestrationGetTurnDiffInput = typeof OrchestrationGetTurnDiffInput.Type;

export const OrchestrationGetTurnDiffResult = ThreadTurnDiff;
export type OrchestrationGetTurnDiffResult = typeof OrchestrationGetTurnDiffResult.Type;

export const OrchestrationGetFullThreadDiffInput = Schema.Struct({
  threadId: ThreadId,
  toTurnCount: NonNegativeInt,
  ignoreWhitespace: Schema.optionalKey(Schema.Boolean),
});
export type OrchestrationGetFullThreadDiffInput = typeof OrchestrationGetFullThreadDiffInput.Type;

export const OrchestrationGetFullThreadDiffResult = ThreadTurnDiff;
export type OrchestrationGetFullThreadDiffResult = typeof OrchestrationGetFullThreadDiffResult.Type;

export const OrchestrationSearchThreadMessagesInput = Schema.Struct({
  query: TrimmedNonEmptyString,
  projectId: Schema.optional(ProjectId),
  limit: PositiveInt,
});
export type OrchestrationSearchThreadMessagesInput =
  typeof OrchestrationSearchThreadMessagesInput.Type;

export const OrchestrationThreadMessageSearchResult = Schema.Struct({
  threadId: ThreadId,
  messageId: MessageId,
  snippet: Schema.String,
  timestamp: IsoDateTime,
});
export type OrchestrationThreadMessageSearchResult =
  typeof OrchestrationThreadMessageSearchResult.Type;

export const OrchestrationSearchThreadMessagesResult = Schema.Array(
  OrchestrationThreadMessageSearchResult,
);
export type OrchestrationSearchThreadMessagesResult =
  typeof OrchestrationSearchThreadMessagesResult.Type;

export const OrchestrationReplayEventsInput = Schema.Struct({
  fromSequenceExclusive: NonNegativeInt,
});
export type OrchestrationReplayEventsInput = typeof OrchestrationReplayEventsInput.Type;

const OrchestrationReplayEventsResult = Schema.Array(OrchestrationEvent);
export type OrchestrationReplayEventsResult = typeof OrchestrationReplayEventsResult.Type;

export const OrchestrationReplayEventsPageInput = Schema.Struct({
  fromSequenceExclusive: NonNegativeInt,
  limit: PositiveInt,
});
export type OrchestrationReplayEventsPageInput = typeof OrchestrationReplayEventsPageInput.Type;

export const OrchestrationReplayEventsPageResult = Schema.Struct({
  events: Schema.Array(OrchestrationEvent),
  nextSequence: NonNegativeInt,
  hasMore: Schema.Boolean,
});
export type OrchestrationReplayEventsPageResult = typeof OrchestrationReplayEventsPageResult.Type;

export const OrchestrationRpcSchemas = {
  dispatchCommand: {
    input: ClientOrchestrationCommand,
    output: DispatchResult,
  },
  getTurnDiff: {
    input: OrchestrationGetTurnDiffInput,
    output: OrchestrationGetTurnDiffResult,
  },
  getFullThreadDiff: {
    input: OrchestrationGetFullThreadDiffInput,
    output: OrchestrationGetFullThreadDiffResult,
  },
  searchThreadMessages: {
    input: OrchestrationSearchThreadMessagesInput,
    output: OrchestrationSearchThreadMessagesResult,
  },
  replayEvents: {
    input: OrchestrationReplayEventsInput,
    output: OrchestrationReplayEventsResult,
  },
  replayEventsPage: {
    input: OrchestrationReplayEventsPageInput,
    output: OrchestrationReplayEventsPageResult,
  },
  subscribeThread: {
    input: OrchestrationSubscribeThreadInput,
    output: OrchestrationThreadStreamItem,
  },
  subscribeShell: {
    input: Schema.Struct({}),
    output: OrchestrationShellStreamItem,
  },
} as const;

export class OrchestrationGetSnapshotError extends Schema.TaggedErrorClass<OrchestrationGetSnapshotError>()(
  "OrchestrationGetSnapshotError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export class OrchestrationDispatchCommandError extends Schema.TaggedErrorClass<OrchestrationDispatchCommandError>()(
  "OrchestrationDispatchCommandError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export class OrchestrationGetTurnDiffError extends Schema.TaggedErrorClass<OrchestrationGetTurnDiffError>()(
  "OrchestrationGetTurnDiffError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export class OrchestrationGetFullThreadDiffError extends Schema.TaggedErrorClass<OrchestrationGetFullThreadDiffError>()(
  "OrchestrationGetFullThreadDiffError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export class OrchestrationReplayEventsError extends Schema.TaggedErrorClass<OrchestrationReplayEventsError>()(
  "OrchestrationReplayEventsError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}
