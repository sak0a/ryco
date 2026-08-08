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
