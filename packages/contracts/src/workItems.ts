import { Schema } from "effect";

import { AtlassianConnectionId, ProjectId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import {
  ChangeRequestState,
  SourceControlIssueComment,
  SourceControlProviderKind,
} from "./sourceControl.ts";

export const WorkItemProviderKind = Schema.Literals(["jira"]);
export type WorkItemProviderKind = typeof WorkItemProviderKind.Type;

export const WorkItemState = Schema.Literals(["open", "in_progress", "done", "closed", "unknown"]);
export type WorkItemState = typeof WorkItemState.Type;

export const WorkItemStateFilter = Schema.Literals([
  "open",
  "in_progress",
  "done",
  "closed",
  "all",
]);
export type WorkItemStateFilter = typeof WorkItemStateFilter.Type;

export const WorkItemTransition = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  toState: WorkItemState,
});
export type WorkItemTransition = typeof WorkItemTransition.Type;

export const WorkItemProject = Schema.Struct({
  provider: WorkItemProviderKind,
  key: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  url: Schema.String,
  projectTypeKey: Schema.optional(TrimmedNonEmptyString),
  simplified: Schema.optional(Schema.Boolean),
  avatarUrl: Schema.optional(Schema.String),
});
export type WorkItemProject = typeof WorkItemProject.Type;

export const LinkedChangeRequest = Schema.Struct({
  provider: SourceControlProviderKind,
  number: Schema.Number,
  title: TrimmedNonEmptyString,
  url: Schema.String,
  state: ChangeRequestState,
});
export type LinkedChangeRequest = typeof LinkedChangeRequest.Type;

export const WorkItemSummary = Schema.Struct({
  provider: WorkItemProviderKind,
  key: TrimmedNonEmptyString,
  id: Schema.optional(TrimmedNonEmptyString),
  title: TrimmedNonEmptyString,
  url: Schema.String,
  state: WorkItemState,
  issueType: Schema.optional(TrimmedNonEmptyString),
  priority: Schema.optional(TrimmedNonEmptyString),
  assignee: Schema.NullOr(TrimmedNonEmptyString),
  reporter: Schema.optional(TrimmedNonEmptyString),
  labels: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  createdAt: Schema.optional(Schema.Option(Schema.DateTimeUtc)),
  updatedAt: Schema.Option(Schema.DateTimeUtc),
});
export type WorkItemSummary = typeof WorkItemSummary.Type;

export const WORK_ITEM_DETAIL_BODY_MAX_BYTES = 8 * 1024;
export const WORK_ITEM_DETAIL_COMMENT_BODY_MAX_BYTES = 2 * 1024;
export const WORK_ITEM_DETAIL_MAX_COMMENTS = 5;

export const WorkItemDetail = Schema.Struct({
  ...WorkItemSummary.fields,
  description: Schema.String,
  comments: Schema.Array(SourceControlIssueComment),
  transitions: Schema.Array(WorkItemTransition),
  linkedChangeRequests: Schema.Array(LinkedChangeRequest),
  parentKey: Schema.optional(TrimmedNonEmptyString),
  epicKey: Schema.optional(TrimmedNonEmptyString),
  truncated: Schema.Boolean,
});
export type WorkItemDetail = typeof WorkItemDetail.Type;

export const ComposerWorkItemContext = Schema.Struct({
  id: TrimmedNonEmptyString,
  provider: WorkItemProviderKind,
  key: TrimmedNonEmptyString,
  detail: WorkItemDetail,
  fetchedAt: Schema.DateTimeUtc,
  staleAfter: Schema.DateTimeUtc,
});
export type ComposerWorkItemContext = typeof ComposerWorkItemContext.Type;

export const WorkItemListInput = Schema.Struct({
  projectId: Schema.optional(ProjectId),
  cwd: Schema.optional(TrimmedNonEmptyString),
  state: WorkItemStateFilter,
  query: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.Number),
  projectKeys: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
});
export type WorkItemListInput = typeof WorkItemListInput.Type;

export const WorkItemListProjectsInput = Schema.Struct({
  connectionId: AtlassianConnectionId,
  siteUrl: Schema.optional(Schema.String),
});
export type WorkItemListProjectsInput = typeof WorkItemListProjectsInput.Type;

export const WorkItemSearchInput = Schema.Struct({
  projectId: Schema.optional(ProjectId),
  cwd: Schema.optional(TrimmedNonEmptyString),
  query: TrimmedNonEmptyString,
  limit: Schema.optional(Schema.Number),
  projectKeys: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
});
export type WorkItemSearchInput = typeof WorkItemSearchInput.Type;

export const WorkItemGetInput = Schema.Struct({
  projectId: Schema.optional(ProjectId),
  cwd: Schema.optional(TrimmedNonEmptyString),
  key: TrimmedNonEmptyString,
  fullContent: Schema.optional(Schema.Boolean),
});
export type WorkItemGetInput = typeof WorkItemGetInput.Type;

export const WorkItemAddCommentInput = Schema.Struct({
  projectId: Schema.optional(ProjectId),
  cwd: Schema.optional(TrimmedNonEmptyString),
  key: TrimmedNonEmptyString,
  body: TrimmedNonEmptyString,
});
export type WorkItemAddCommentInput = typeof WorkItemAddCommentInput.Type;

export const WorkItemListTransitionsInput = Schema.Struct({
  projectId: Schema.optional(ProjectId),
  cwd: Schema.optional(TrimmedNonEmptyString),
  key: TrimmedNonEmptyString,
});
export type WorkItemListTransitionsInput = typeof WorkItemListTransitionsInput.Type;

export const WorkItemTransitionInput = Schema.Struct({
  projectId: Schema.optional(ProjectId),
  cwd: Schema.optional(TrimmedNonEmptyString),
  key: TrimmedNonEmptyString,
  transitionId: TrimmedNonEmptyString,
  comment: Schema.optional(TrimmedNonEmptyString),
});
export type WorkItemTransitionInput = typeof WorkItemTransitionInput.Type;

export class WorkItemProviderError extends Schema.TaggedErrorClass<WorkItemProviderError>()(
  "WorkItemProviderError",
  {
    provider: WorkItemProviderKind,
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}
