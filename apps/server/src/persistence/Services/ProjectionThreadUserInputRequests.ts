import { ApprovalRequestId, IsoDateTime, ThreadId } from "@ryco/contracts";
import { Context, Option, Schema } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionThreadUserInputRequest = Schema.Struct({
  requestId: ApprovalRequestId,
  threadId: ThreadId,
  isPending: Schema.Boolean,
  updatedAt: IsoDateTime,
});
export type ProjectionThreadUserInputRequest = typeof ProjectionThreadUserInputRequest.Type;

export interface ProjectionThreadUserInputRequestRepositoryShape {
  readonly upsert: (
    row: ProjectionThreadUserInputRequest,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getByRequestId: (input: {
    readonly requestId: ApprovalRequestId;
  }) => Effect.Effect<Option.Option<ProjectionThreadUserInputRequest>, ProjectionRepositoryError>;
  readonly deleteByThreadId: (input: {
    readonly threadId: ThreadId;
  }) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ProjectionThreadUserInputRequestRepository extends Context.Service<
  ProjectionThreadUserInputRequestRepository,
  ProjectionThreadUserInputRequestRepositoryShape
>()(
  "ryco/persistence/Services/ProjectionThreadUserInputRequests/ProjectionThreadUserInputRequestRepository",
) {}
