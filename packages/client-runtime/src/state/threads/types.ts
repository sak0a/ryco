import type {
  EnvironmentId,
  ModelSelection,
  OrchestrationLatestTurn,
  OrchestrationProposedPlanId,
  RepositoryIdentity,
  OrchestrationSessionStatus,
  OrchestrationThreadActivity,
  ProjectScript as ContractProjectScript,
  ThreadId,
  ProjectId,
  TurnId,
  MessageId,
  ProviderDriverKind,
  ProviderInstanceId,
  CheckpointRef,
  ProviderInteractionMode,
  RuntimeMode,
  AgentTokenMode,
  StatusBucket,
  ThreadSettlementOverride,
  WorktreeId,
  WorktreeOrigin,
} from "@ryco/contracts";

export type SessionPhase = "disconnected" | "connecting" | "ready" | "running";
export const DEFAULT_RUNTIME_MODE: RuntimeMode = "full-access";

export const DEFAULT_INTERACTION_MODE: ProviderInteractionMode = "default";
export const DEFAULT_AGENT_TOKEN_MODE: AgentTokenMode = "balanced";
export const DEFAULT_THREAD_TERMINAL_HEIGHT = 280;
export const DEFAULT_THREAD_TERMINAL_ID = "default";
export const MAX_TERMINALS_PER_GROUP = 4;
export type ProjectScript = ContractProjectScript;

export interface ThreadTerminalGroup {
  id: string;
  terminalIds: string[];
}

export interface ChatImageAttachment {
  type: "image";
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  previewUrl?: string;
}

export type ChatAttachment = ChatImageAttachment;

export interface ChatMessage {
  id: MessageId;
  role: "user" | "assistant" | "system";
  text: string;
  attachments?: ChatAttachment[];
  turnId?: TurnId | null;
  createdAt: string;
  completedAt?: string | undefined;
  streaming: boolean;
}

export interface ProposedPlan {
  id: OrchestrationProposedPlanId;
  turnId: TurnId | null;
  planMarkdown: string;
  implementedAt: string | null;
  implementationThreadId: ThreadId | null;
  createdAt: string;
  updatedAt: string;
}

export interface TurnDiffFileChange {
  path: string;
  kind?: string | undefined;
  additions?: number | undefined;
  deletions?: number | undefined;
}

export interface TurnDiffSummary {
  turnId: TurnId;
  completedAt: string;
  status?: string | undefined;
  files: TurnDiffFileChange[];
  checkpointRef?: CheckpointRef | undefined;
  assistantMessageId?: MessageId | undefined;
  checkpointTurnCount?: number | undefined;
}

export interface Project {
  id: ProjectId;
  environmentId: EnvironmentId;
  name: string;
  cwd: string;
  projectMetadataDir?: string | undefined;
  repositoryIdentity?: RepositoryIdentity | null;
  defaultModelSelection: ModelSelection | null;
  customSystemPrompt?: string | null;
  customAvatarContentHash?: string | null;
  preferredRemoteName?: string | null;
  createdAt?: string | undefined;
  updatedAt?: string | undefined;
  scripts: ProjectScript[];
}

export interface Thread {
  id: ThreadId;
  environmentId: EnvironmentId;
  codexThreadId: string | null;
  projectId: ProjectId;
  title: string;
  modelSelection: ModelSelection;
  runtimeMode: RuntimeMode;
  interactionMode: ProviderInteractionMode;
  tokenMode?: AgentTokenMode;
  session: ThreadSession | null;
  messages: ChatMessage[];
  proposedPlans: ProposedPlan[];
  error: string | null;
  createdAt: string;
  archivedAt: string | null;
  /** Absent only for an object retained from a pre-settlement client snapshot. */
  settledOverride?: ThreadSettlementOverride | null | undefined;
  /** Absent only for an object retained from a pre-settlement client snapshot. */
  settledAt?: string | null | undefined;
  updatedAt?: string | undefined;
  latestTurn: OrchestrationLatestTurn | null;
  pendingSourceProposedPlan?: OrchestrationLatestTurn["sourceProposedPlan"];
  branch: string | null;
  worktreePath: string | null;
  worktreeId?: string | null | undefined;
  manualStatusBucket?: StatusBucket | null | undefined;
  manualPosition?: number | undefined;
  turnDiffSummaries: TurnDiffSummary[];
  activities: OrchestrationThreadActivity[];
}

export interface ThreadShell {
  id: ThreadId;
  environmentId: EnvironmentId;
  codexThreadId: string | null;
  projectId: ProjectId;
  title: string;
  modelSelection: ModelSelection;
  runtimeMode: RuntimeMode;
  interactionMode: ProviderInteractionMode;
  tokenMode?: AgentTokenMode;
  error: string | null;
  createdAt: string;
  archivedAt: string | null;
  /** Optional at the runtime boundary for mixed-version shell snapshots. */
  settledOverride?: ThreadSettlementOverride | null | undefined;
  /** Optional at the runtime boundary for mixed-version shell snapshots. */
  settledAt?: string | null | undefined;
  updatedAt?: string | undefined;
  branch: string | null;
  worktreePath: string | null;
  worktreeId?: string | null | undefined;
  manualStatusBucket?: StatusBucket | null | undefined;
  manualPosition?: number | undefined;
}

export interface ThreadTurnState {
  latestTurn: OrchestrationLatestTurn | null;
  pendingSourceProposedPlan?: OrchestrationLatestTurn["sourceProposedPlan"];
}

export interface SidebarThreadSummary {
  id: ThreadId;
  environmentId: EnvironmentId;
  projectId: ProjectId;
  title: string;
  /** Optional at the runtime boundary for retained pre-rich-row summaries. */
  modelSelection?: ModelSelection | undefined;
  interactionMode: ProviderInteractionMode;
  tokenMode?: AgentTokenMode;
  session: ThreadSession | null;
  /** Sanitized provider/session failure shown by summary-only surfaces. */
  error?: string | null | undefined;
  createdAt: string;
  archivedAt: string | null;
  /** Optional at the runtime boundary for mixed-version shell snapshots. */
  settledOverride?: ThreadSettlementOverride | null | undefined;
  /** Optional at the runtime boundary for mixed-version shell snapshots. */
  settledAt?: string | null | undefined;
  updatedAt?: string | undefined;
  latestTurn: OrchestrationLatestTurn | null;
  branch: string | null;
  worktreePath: string | null;
  worktreeId?: string | null | undefined;
  manualStatusBucket?: StatusBucket | null | undefined;
  manualPosition?: number | undefined;
  latestUserMessageAt: string | null;
  hasPendingApprovals: boolean;
  hasPendingUserInput: boolean;
  hasActionableProposedPlan: boolean;
}

export interface SidebarWorktreeSummary {
  id: WorktreeId;
  environmentId: EnvironmentId;
  projectId: ProjectId;
  title?: string | null | undefined;
  branch: string;
  worktreePath: string | null;
  origin: WorktreeOrigin;
  prNumber: number | null;
  issueNumber: number | null;
  prTitle: string | null;
  issueTitle: string | null;
  prState: "open" | "closed" | "merged" | null;
  prIsDraft: boolean | null;
  issueState: "open" | "closed" | null;
  workItemProvider: "jira" | null;
  workItemKey: string | null;
  workItemTitle: string | null;
  workItemState: "open" | "in_progress" | "done" | "closed" | "unknown" | null;
  workItemStateName: string | null;
  workItemUrl: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  manualPosition: number;
}

export interface ThreadSession {
  provider: ProviderDriverKind;
  providerInstanceId?: ProviderInstanceId | undefined;
  status: SessionPhase | "error" | "closed";
  activeTurnId?: TurnId | undefined;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
  orchestrationStatus: OrchestrationSessionStatus;
}
