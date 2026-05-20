import { Effect, Schema } from "effect";

import { IsoDateTime, ProjectId, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const WorktreeId = Schema.String.pipe(Schema.brand("WorktreeId"));
export type WorktreeId = typeof WorktreeId.Type;

export const WorktreeOrigin = Schema.Literals(["main", "branch", "pr", "issue", "manual"]);
export type WorktreeOrigin = typeof WorktreeOrigin.Type;

export const PullRequestState = Schema.Literals(["open", "closed", "merged"]);
export type PullRequestState = typeof PullRequestState.Type;

export const IssueState = Schema.Literals(["open", "closed"]);
export type IssueState = typeof IssueState.Type;

export const StatusBucket = Schema.Literals(["idle", "in_progress", "review", "done"]);
export type StatusBucket = typeof StatusBucket.Type;

export const WorktreeCheckoutLocation = Schema.Literals(["appManaged", "projectMetadata"]);
export type WorktreeCheckoutLocation = typeof WorktreeCheckoutLocation.Type;

export const Worktree = Schema.Struct({
  worktreeId: WorktreeId,
  projectId: ProjectId,
  title: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  branch: TrimmedNonEmptyString,
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  origin: WorktreeOrigin,
  prNumber: Schema.NullOr(Schema.Number),
  issueNumber: Schema.NullOr(Schema.Number),
  prTitle: Schema.NullOr(TrimmedNonEmptyString),
  issueTitle: Schema.NullOr(TrimmedNonEmptyString),
  prState: Schema.optional(Schema.NullOr(PullRequestState)).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  prIsDraft: Schema.optional(Schema.NullOr(Schema.Boolean)).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  issueState: Schema.optional(Schema.NullOr(IssueState)).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  archivedAt: Schema.NullOr(IsoDateTime),
  manualPosition: Schema.Number,
});
export type Worktree = typeof Worktree.Type;

export const CreateWorktreeIntent = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("branch"), branchName: TrimmedNonEmptyString }),
  Schema.Struct({ kind: Schema.Literal("pr"), number: Schema.Number }),
  Schema.Struct({
    kind: Schema.Literal("issue"),
    number: Schema.Number,
    branchName: Schema.optional(TrimmedNonEmptyString),
  }),
  Schema.Struct({
    kind: Schema.Literal("newBranch"),
    branchName: Schema.optional(TrimmedNonEmptyString),
    baseBranch: Schema.optional(TrimmedNonEmptyString),
  }),
]);
export type CreateWorktreeIntent = typeof CreateWorktreeIntent.Type;
