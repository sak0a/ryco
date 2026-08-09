import { Schema } from "effect";

import {
  EnvironmentId,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { SourceControlProviderKind } from "./sourceControl.ts";
import { SourceControlChangeRequestDetail } from "./sourceControl.ts";
import { ProviderOptionSelections } from "./model.ts";
import { ProviderInstanceId } from "./providerInstance.ts";
import { WorktreeId } from "./worktree.ts";

const PullRequestHost = TrimmedNonEmptyString.check(
  Schema.makeFilter((value: string) =>
    /^(?:\[[0-9a-f:]+\]|[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::[1-9][0-9]{0,4})?$/i.test(value)
      ? undefined
      : "Expected a provider host without a scheme or path",
  ),
);

const PullRequestRepositoryPath = TrimmedNonEmptyString.check(
  Schema.makeFilter((value: string) => {
    const segments = value.split("/");
    return segments.length >= 2 &&
      segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..")
      ? undefined
      : "Expected an owner/repository path";
  }),
);

export const PullRequestId = TrimmedNonEmptyString.pipe(Schema.brand("PullRequestId"));
export type PullRequestId = typeof PullRequestId.Type;

export const PullRequestIdentity = Schema.Struct({
  id: PullRequestId,
  environmentId: EnvironmentId,
  provider: SourceControlProviderKind,
  host: PullRequestHost,
  repositoryPath: PullRequestRepositoryPath,
  number: PositiveInt,
});
export type PullRequestIdentity = typeof PullRequestIdentity.Type;

export const PullRequestRepository = Schema.Struct({
  canonicalKey: TrimmedNonEmptyString,
  host: PullRequestHost,
  path: PullRequestRepositoryPath,
  displayName: TrimmedNonEmptyString,
});
export type PullRequestRepository = typeof PullRequestRepository.Type;

export const PullRequestLifecycleState = Schema.Literals(["open", "closed", "merged"]);
export type PullRequestLifecycleState = typeof PullRequestLifecycleState.Type;

export const PullRequestReviewDisposition = Schema.Literals([
  "approved",
  "changes-requested",
  "review-required",
  "reviewed",
  "none",
  "unknown",
]);
export type PullRequestReviewDisposition = typeof PullRequestReviewDisposition.Type;

export const PullRequestCheckStatus = Schema.Literals([
  "passing",
  "failing",
  "pending",
  "neutral",
  "unknown",
]);
export type PullRequestCheckStatus = typeof PullRequestCheckStatus.Type;

export const PullRequestReviewSummary = Schema.Struct({
  disposition: PullRequestReviewDisposition,
  requestedReviewers: Schema.Array(TrimmedNonEmptyString),
  approvedBy: Schema.Array(TrimmedNonEmptyString),
});
export type PullRequestReviewSummary = typeof PullRequestReviewSummary.Type;

export const PullRequestCheckSummary = Schema.Struct({
  status: PullRequestCheckStatus,
  total: NonNegativeInt,
  passing: NonNegativeInt,
  failing: NonNegativeInt,
  pending: NonNegativeInt,
});
export type PullRequestCheckSummary = typeof PullRequestCheckSummary.Type;

export const PullRequestCapabilities = Schema.Struct({
  detail: Schema.Boolean,
  comments: Schema.Boolean,
  reviews: Schema.Boolean,
  checks: Schema.Boolean,
  commits: Schema.Boolean,
  files: Schema.Boolean,
  viewerIdentity: Schema.Boolean,
});
export type PullRequestCapabilities = typeof PullRequestCapabilities.Type;

export const PullRequestViewerRelationship = Schema.Struct({
  isAuthor: Schema.Boolean,
  isAssignee: Schema.Boolean,
  reviewRequested: Schema.Boolean,
});
export type PullRequestViewerRelationship = typeof PullRequestViewerRelationship.Type;

export const PullRequestFreshness = Schema.Struct({
  observedAt: Schema.DateTimeUtc,
  providerUpdatedAt: Schema.Option(Schema.DateTimeUtc),
  refreshGeneration: NonNegativeInt,
});
export type PullRequestFreshness = typeof PullRequestFreshness.Type;

export const PullRequestRecord = Schema.Struct({
  identity: PullRequestIdentity,
  repository: PullRequestRepository,
  title: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  state: PullRequestLifecycleState,
  isDraft: Schema.Boolean,
  author: Schema.optional(TrimmedNonEmptyString),
  assignees: Schema.Array(TrimmedNonEmptyString),
  baseRefName: TrimmedNonEmptyString,
  headRefName: TrimmedNonEmptyString,
  labels: Schema.Array(TrimmedNonEmptyString),
  review: PullRequestReviewSummary,
  checks: PullRequestCheckSummary,
  capabilities: PullRequestCapabilities,
  viewer: Schema.optional(PullRequestViewerRelationship),
  freshness: PullRequestFreshness,
});
export type PullRequestRecord = typeof PullRequestRecord.Type;

export const PullRequestAccessTarget = Schema.Struct({
  pullRequestId: PullRequestId,
  environmentId: EnvironmentId,
  projectId: Schema.optional(ProjectId),
  cwd: TrimmedNonEmptyString,
  remoteUrl: Schema.optional(TrimmedNonEmptyString),
  lastVerifiedAt: Schema.DateTimeUtc,
});
export type PullRequestAccessTarget = typeof PullRequestAccessTarget.Type;

export const PullRequestRelationshipKind = Schema.Literals([
  "created",
  "opened-existing",
  "current-branch",
  "explicitly-attached",
  "mentioned",
  "inspected",
]);
export type PullRequestRelationshipKind = typeof PullRequestRelationshipKind.Type;

export const PullRequestAssociationEvidence = Schema.Literals([
  "structured-provider-result",
  "branch-reconciliation",
  "user-attachment",
  "structured-thread-context",
  "verified-textual-reference",
  "verified-legacy-backfill",
]);
export type PullRequestAssociationEvidence = typeof PullRequestAssociationEvidence.Type;

export const PullRequestAssociationSubject = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("thread"), threadId: ThreadId }),
  Schema.Struct({ kind: Schema.Literal("worktree"), worktreeId: WorktreeId }),
]);
export type PullRequestAssociationSubject = typeof PullRequestAssociationSubject.Type;

export const PullRequestAssociation = Schema.Struct({
  pullRequestId: PullRequestId,
  subject: PullRequestAssociationSubject,
  relationship: PullRequestRelationshipKind,
  evidence: PullRequestAssociationEvidence,
  createdAt: Schema.DateTimeUtc,
  endedAt: Schema.Option(Schema.DateTimeUtc),
});
export type PullRequestAssociation = typeof PullRequestAssociation.Type;

export const PullRequestViewState = Schema.Struct({
  pullRequestId: PullRequestId,
  isUnread: Schema.Boolean,
  viewedAt: Schema.Option(Schema.DateTimeUtc),
  providerUpdatedAtWhenViewed: Schema.Option(Schema.DateTimeUtc),
});
export type PullRequestViewState = typeof PullRequestViewState.Type;

export const PullRequestRepositoryCoverageState = Schema.Literals([
  "complete",
  "partial",
  "failed",
  "unsupported",
]);
export type PullRequestRepositoryCoverageState = typeof PullRequestRepositoryCoverageState.Type;

export const PullRequestRepositoryCoverage = Schema.Struct({
  environmentId: EnvironmentId,
  repository: PullRequestRepository,
  state: PullRequestRepositoryCoverageState,
  fetched: NonNegativeInt,
  capped: Schema.Boolean,
  lastSuccessAt: Schema.Option(Schema.DateTimeUtc),
  message: Schema.optional(TrimmedNonEmptyString),
});
export type PullRequestRepositoryCoverage = typeof PullRequestRepositoryCoverage.Type;

export const PullRequestInboxItem = Schema.Struct({
  pullRequest: PullRequestRecord,
  associations: Schema.Array(PullRequestAssociation),
  viewState: PullRequestViewState,
});
export type PullRequestInboxItem = typeof PullRequestInboxItem.Type;

export const PullRequestInboxSnapshot = Schema.Struct({
  generation: NonNegativeInt,
  items: Schema.Array(PullRequestInboxItem),
  coverage: Schema.Array(PullRequestRepositoryCoverage),
  lastSuccessAt: Schema.Option(Schema.DateTimeUtc),
});
export type PullRequestInboxSnapshot = typeof PullRequestInboxSnapshot.Type;

export const PullRequestDetailResult = Schema.Struct({
  item: PullRequestInboxItem,
  accessTargets: Schema.Array(PullRequestAccessTarget),
  detail: SourceControlChangeRequestDetail,
});
export type PullRequestDetailResult = typeof PullRequestDetailResult.Type;

export const PullRequestAiRunId = TrimmedNonEmptyString.pipe(Schema.brand("PullRequestAiRunId"));
export type PullRequestAiRunId = typeof PullRequestAiRunId.Type;

export const PullRequestAiScore = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(100),
);
export type PullRequestAiScore = typeof PullRequestAiScore.Type;

export const PullRequestAiModelSelection = Schema.Struct({
  instanceId: ProviderInstanceId,
  model: TrimmedNonEmptyString,
  options: Schema.optionalKey(ProviderOptionSelections),
});
export type PullRequestAiModelSelection = typeof PullRequestAiModelSelection.Type;

export const PullRequestAiPriority = Schema.Literals(["urgent", "high", "normal", "low"]);
export type PullRequestAiPriority = typeof PullRequestAiPriority.Type;

export const PullRequestAiRisk = Schema.Literals(["high", "medium", "low", "uncertain"]);
export type PullRequestAiRisk = typeof PullRequestAiRisk.Type;

export const PullRequestAiImplementationPhase = Schema.Literals([
  "early-work",
  "active-implementation",
  "validation-cleanup",
  "review-ready",
  "blocked",
  "uncertain",
]);
export type PullRequestAiImplementationPhase = typeof PullRequestAiImplementationPhase.Type;

export const PullRequestAiAnalysisDepth = Schema.Literals(["shallow", "deep"]);
export type PullRequestAiAnalysisDepth = typeof PullRequestAiAnalysisDepth.Type;

export const PullRequestAiHotspot = Schema.Struct({
  filePath: Schema.optional(TrimmedNonEmptyString),
  title: TrimmedNonEmptyString,
  explanation: TrimmedNonEmptyString,
  risk: PullRequestAiRisk,
});
export type PullRequestAiHotspot = typeof PullRequestAiHotspot.Type;

const PullRequestAiRiskPoints = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(15),
);
const PullRequestAiTenPointScore = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(10),
);
const PullRequestAiFivePointScore = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(5),
);

/** Structured, provider-neutral output accepted from a configured model. */
export const PullRequestAiModelAssessment = Schema.Struct({
  pullRequestId: PullRequestId,
  depth: PullRequestAiAnalysisDepth,
  summary: TrimmedNonEmptyString,
  implementationPhase: PullRequestAiImplementationPhase,
  attentionReason: TrimmedNonEmptyString,
  suggestedNextAction: TrimmedNonEmptyString,
  risk: PullRequestAiRisk,
  riskEvidence: Schema.Array(TrimmedNonEmptyString),
  hotspots: Schema.Array(PullRequestAiHotspot),
  riskPoints: PullRequestAiRiskPoints,
  blockerPoints: PullRequestAiTenPointScore,
  reviewImpactPoints: PullRequestAiTenPointScore,
  timeSensitivityPoints: PullRequestAiFivePointScore,
  implementationCompletenessPoints: PullRequestAiRiskPoints,
  unresolvedDiscussionRiskPoints: PullRequestAiFivePointScore,
  confidence: PullRequestAiScore,
});
export type PullRequestAiModelAssessment = typeof PullRequestAiModelAssessment.Type;

export const PullRequestMergeReadinessFactorKind = Schema.Literals([
  "provider-mergeability",
  "checks",
  "review",
  "lifecycle",
  "implementation-completeness",
  "discussion-risk",
]);
export type PullRequestMergeReadinessFactorKind = typeof PullRequestMergeReadinessFactorKind.Type;

export const PullRequestMergeReadinessFactor = Schema.Struct({
  kind: PullRequestMergeReadinessFactorKind,
  points: PullRequestAiScore,
  possiblePoints: PullRequestAiScore,
  known: Schema.Boolean,
  explanation: TrimmedNonEmptyString,
});
export type PullRequestMergeReadinessFactor = typeof PullRequestMergeReadinessFactor.Type;

export const PullRequestMergeReadiness = Schema.Struct({
  score: PullRequestAiScore,
  confidence: PullRequestAiScore,
  insufficientEvidence: Schema.Boolean,
  factors: Schema.Array(PullRequestMergeReadinessFactor),
  appliedCaps: Schema.Array(TrimmedNonEmptyString),
});
export type PullRequestMergeReadiness = typeof PullRequestMergeReadiness.Type;

export const PullRequestAiAnalysis = Schema.Struct({
  pullRequestId: PullRequestId,
  viewerKey: TrimmedNonEmptyString,
  modelSelection: PullRequestAiModelSelection,
  promptVersion: PositiveInt,
  schemaVersion: PositiveInt,
  sourceFingerprint: TrimmedNonEmptyString,
  sourceProviderUpdatedAt: Schema.Option(Schema.DateTimeUtc),
  depth: PullRequestAiAnalysisDepth,
  priorityScore: PullRequestAiScore,
  priority: PullRequestAiPriority,
  deterministicPriorityPoints: PullRequestAiScore,
  modelPriorityPoints: PullRequestAiScore,
  priorityExplanation: TrimmedNonEmptyString,
  assessment: PullRequestAiModelAssessment,
  mergeReadiness: Schema.Option(PullRequestMergeReadiness),
  analyzedAt: Schema.DateTimeUtc,
  expiresAt: Schema.DateTimeUtc,
  isStale: Schema.Boolean,
});
export type PullRequestAiAnalysis = typeof PullRequestAiAnalysis.Type;

export const PullRequestAiResourceMode = Schema.Literals(["economical", "balanced", "thorough"]);
export type PullRequestAiResourceMode = typeof PullRequestAiResourceMode.Type;

export const PullRequestAiScheduleIntervalMinutes = Schema.Literals([30, 60, 180, 360, 720, 1440]);
export type PullRequestAiScheduleIntervalMinutes = typeof PullRequestAiScheduleIntervalMinutes.Type;

export const PullRequestAiConfiguration = Schema.Struct({
  backgroundEnabled: Schema.Boolean,
  modelSelection: PullRequestAiModelSelection,
  intervalMinutes: PullRequestAiScheduleIntervalMinutes,
  maxPullRequests: PositiveInt,
  maxDeepAnalyses: NonNegativeInt,
  activeWindowDays: PositiveInt,
  includeDrafts: Schema.Boolean,
  resourceMode: PullRequestAiResourceMode,
});
export type PullRequestAiConfiguration = typeof PullRequestAiConfiguration.Type;

export const PullRequestAiRunStatus = Schema.Literals([
  "planned",
  "ranking",
  "deep-analysis",
  "cancelling",
  "completed",
  "partially-completed",
  "cancelled",
  "failed",
]);
export type PullRequestAiRunStatus = typeof PullRequestAiRunStatus.Type;

export const PullRequestAiRunScope = Schema.Literals(["view", "single", "scheduled"]);
export type PullRequestAiRunScope = typeof PullRequestAiRunScope.Type;

export const PullRequestAiRunProgress = Schema.Struct({
  planned: NonNegativeInt,
  ranked: NonNegativeInt,
  deepPlanned: NonNegativeInt,
  deepCompleted: NonNegativeInt,
  cached: NonNegativeInt,
  failed: NonNegativeInt,
});
export type PullRequestAiRunProgress = typeof PullRequestAiRunProgress.Type;

export const PullRequestAiRun = Schema.Struct({
  id: PullRequestAiRunId,
  environmentId: EnvironmentId,
  viewerKey: TrimmedNonEmptyString,
  scope: PullRequestAiRunScope,
  pullRequestIds: Schema.Array(PullRequestId),
  modelSelection: PullRequestAiModelSelection,
  resourceMode: PullRequestAiResourceMode,
  status: PullRequestAiRunStatus,
  progress: PullRequestAiRunProgress,
  startedAt: Schema.DateTimeUtc,
  completedAt: Schema.Option(Schema.DateTimeUtc),
  error: Schema.optional(TrimmedNonEmptyString),
});
export type PullRequestAiRun = typeof PullRequestAiRun.Type;

export const PullRequestAiSnapshot = Schema.Struct({
  generation: NonNegativeInt,
  analyses: Schema.Array(PullRequestAiAnalysis),
  currentRun: Schema.Option(PullRequestAiRun),
  latestRun: Schema.Option(PullRequestAiRun),
  lastSuccessAt: Schema.Option(Schema.DateTimeUtc),
});
export type PullRequestAiSnapshot = typeof PullRequestAiSnapshot.Type;
