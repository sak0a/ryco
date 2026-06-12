import { AtlassianConnectionId, IsoDateTime, ProjectId } from "@ryco/contracts";
import { Context, Option, Schema } from "effect";
import type { Effect } from "effect";

import type { ProjectAtlassianLinkRepositoryError } from "../Errors.ts";

export const ProjectAtlassianLinkRecord = Schema.Struct({
  projectId: ProjectId,
  jiraConnectionId: Schema.NullOr(AtlassianConnectionId),
  bitbucketConnectionId: Schema.NullOr(AtlassianConnectionId),
  jiraCloudId: Schema.NullOr(Schema.String),
  jiraSiteUrl: Schema.NullOr(Schema.String),
  jiraProjectKeys: Schema.Array(Schema.String),
  bitbucketWorkspace: Schema.NullOr(Schema.String),
  bitbucketRepoSlug: Schema.NullOr(Schema.String),
  defaultIssueTypeName: Schema.NullOr(Schema.String),
  branchNameTemplate: Schema.String,
  commitMessageTemplate: Schema.String,
  pullRequestTitleTemplate: Schema.String,
  smartLinkingEnabled: Schema.Boolean,
  autoAttachWorkItems: Schema.Boolean,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ProjectAtlassianLinkRecord = typeof ProjectAtlassianLinkRecord.Type;

export const GetProjectAtlassianLinkInput = Schema.Struct({
  projectId: ProjectId,
});
export type GetProjectAtlassianLinkInput = typeof GetProjectAtlassianLinkInput.Type;

export const ClearProjectAtlassianConnectionReferencesInput = Schema.Struct({
  connectionId: AtlassianConnectionId,
  updatedAt: IsoDateTime,
});
export type ClearProjectAtlassianConnectionReferencesInput =
  typeof ClearProjectAtlassianConnectionReferencesInput.Type;

export const UpsertProjectAtlassianLinkInput = ProjectAtlassianLinkRecord;
export type UpsertProjectAtlassianLinkInput = typeof UpsertProjectAtlassianLinkInput.Type;

export interface ProjectAtlassianLinkRepositoryShape {
  readonly getByProjectId: (
    input: GetProjectAtlassianLinkInput,
  ) => Effect.Effect<
    Option.Option<ProjectAtlassianLinkRecord>,
    ProjectAtlassianLinkRepositoryError
  >;
  readonly upsert: (
    input: UpsertProjectAtlassianLinkInput,
  ) => Effect.Effect<void, ProjectAtlassianLinkRepositoryError>;
  readonly deleteByProjectId: (
    input: GetProjectAtlassianLinkInput,
  ) => Effect.Effect<void, ProjectAtlassianLinkRepositoryError>;
  readonly clearConnectionReferences: (
    input: ClearProjectAtlassianConnectionReferencesInput,
  ) => Effect.Effect<void, ProjectAtlassianLinkRepositoryError>;
}

export class ProjectAtlassianLinkRepository extends Context.Service<
  ProjectAtlassianLinkRepository,
  ProjectAtlassianLinkRepositoryShape
>()("ryco/persistence/Services/ProjectAtlassianLinks/ProjectAtlassianLinkRepository") {}
