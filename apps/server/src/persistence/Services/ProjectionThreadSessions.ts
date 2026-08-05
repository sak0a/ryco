/**
 * ProjectionThreadSessionRepository - Repository interface for thread sessions.
 *
 * Owns persistence operations for projected provider-session linkage and
 * runtime status for each thread.
 *
 * @module ProjectionThreadSessionRepository
 */
import {
  AgentTokenMode,
  RuntimeMode,
  IsoDateTime,
  OrchestrationSessionStatus,
  ProviderInstanceId,
  RuntimeSessionId,
  ThreadId,
  TurnId,
} from "@ryco/contracts";
import { Option, Schema, Context } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionThreadSession = Schema.Struct({
  threadId: ThreadId,
  status: OrchestrationSessionStatus,
  providerName: Schema.NullOr(Schema.String),
  providerInstanceId: Schema.NullOr(ProviderInstanceId),
  /** Nullable only for session projections created before migration 042. */
  runtimeSessionId: Schema.NullOr(RuntimeSessionId),
  runtimeMode: RuntimeMode,
  tokenMode: AgentTokenMode,
  activeTurnId: Schema.NullOr(TurnId),
  lastError: Schema.NullOr(Schema.String),
  updatedAt: IsoDateTime,
});
type DecodedProjectionThreadSession = typeof ProjectionThreadSession.Type;
export type ProjectionThreadSession = Omit<DecodedProjectionThreadSession, "runtimeSessionId"> & {
  /** Omission is accepted only for legacy callers and is persisted as NULL. */
  readonly runtimeSessionId?: DecodedProjectionThreadSession["runtimeSessionId"];
};

export const GetProjectionThreadSessionInput = Schema.Struct({
  threadId: ThreadId,
});
export type GetProjectionThreadSessionInput = typeof GetProjectionThreadSessionInput.Type;

export const DeleteProjectionThreadSessionInput = Schema.Struct({
  threadId: ThreadId,
});
export type DeleteProjectionThreadSessionInput = typeof DeleteProjectionThreadSessionInput.Type;

/**
 * ProjectionThreadSessionRepositoryShape - Service API for projected thread sessions.
 */
export interface ProjectionThreadSessionRepositoryShape {
  /**
   * Insert or replace a projected thread-session row.
   *
   * Upserts by `threadId`.
   */
  readonly upsert: (row: ProjectionThreadSession) => Effect.Effect<void, ProjectionRepositoryError>;

  /**
   * Read projected thread-session state by thread id.
   */
  readonly getByThreadId: (
    input: GetProjectionThreadSessionInput,
  ) => Effect.Effect<Option.Option<ProjectionThreadSession>, ProjectionRepositoryError>;

  /**
   * Delete projected thread-session state by thread id.
   */
  readonly deleteByThreadId: (
    input: DeleteProjectionThreadSessionInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

/**
 * ProjectionThreadSessionRepository - Service tag for thread-session persistence.
 */
export class ProjectionThreadSessionRepository extends Context.Service<
  ProjectionThreadSessionRepository,
  ProjectionThreadSessionRepositoryShape
>()("ryco/persistence/Services/ProjectionThreadSessions/ProjectionThreadSessionRepository") {}
