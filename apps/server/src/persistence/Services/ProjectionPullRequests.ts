import {
  PullRequestAccessTarget,
  PullRequestAssociation,
  PullRequestAssociationSubject,
  PullRequestId,
  PullRequestInboxSnapshot,
  PullRequestRecord,
} from "@ryco/contracts";
import { Context, Schema } from "effect";
import type { Effect, Option, Stream } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const PullRequestViewerKey = Schema.String.pipe(Schema.brand("PullRequestViewerKey"));
export type PullRequestViewerKey = typeof PullRequestViewerKey.Type;

export interface ProjectionPullRequestRepositoryShape {
  /** Emits after a committed record, relationship, access-target, or view-state mutation. */
  readonly streamChanges: Stream.Stream<void>;
  readonly upsert: (record: PullRequestRecord) => Effect.Effect<boolean, ProjectionRepositoryError>;
  readonly getById: (
    pullRequestId: PullRequestId,
  ) => Effect.Effect<Option.Option<PullRequestRecord>, ProjectionRepositoryError>;
  readonly listAll: () => Effect.Effect<
    ReadonlyArray<PullRequestRecord>,
    ProjectionRepositoryError
  >;
  readonly upsertAccessTarget: (
    target: PullRequestAccessTarget,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly listAccessTargets: (
    pullRequestId: PullRequestId,
  ) => Effect.Effect<ReadonlyArray<PullRequestAccessTarget>, ProjectionRepositoryError>;
  readonly recordAssociation: (
    association: PullRequestAssociation,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly endAssociation: (input: {
    readonly pullRequestId: PullRequestId;
    readonly subject: PullRequestAssociationSubject;
    readonly relationship: PullRequestAssociation["relationship"];
    readonly endedAt: PullRequestAssociation["createdAt"];
  }) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly listAssociations: (
    pullRequestId: PullRequestId,
  ) => Effect.Effect<ReadonlyArray<PullRequestAssociation>, ProjectionRepositoryError>;
  readonly markViewed: (input: {
    readonly pullRequestId: PullRequestId;
    readonly viewerKey: PullRequestViewerKey;
    readonly viewedAt: PullRequestAssociation["createdAt"];
  }) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly markUnread: (input: {
    readonly pullRequestId: PullRequestId;
    readonly viewerKey: PullRequestViewerKey;
    readonly markedAt: PullRequestAssociation["createdAt"];
  }) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly listInbox: (
    viewerKey: PullRequestViewerKey,
  ) => Effect.Effect<PullRequestInboxSnapshot, ProjectionRepositoryError>;
}

export class ProjectionPullRequestRepository extends Context.Service<
  ProjectionPullRequestRepository,
  ProjectionPullRequestRepositoryShape
>()("ryco/persistence/Services/ProjectionPullRequests/ProjectionPullRequestRepository") {}
