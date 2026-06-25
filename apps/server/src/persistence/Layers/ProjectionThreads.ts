import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { Effect, Layer, Schema, Struct } from "effect";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  DeleteProjectionThreadInput,
  GetProjectionThreadInput,
  ListProjectionThreadsByProjectInput,
  ProjectionThread,
  ProjectionThreadRepository,
  AttachProjectionThreadToWorktreeInput,
  SetProjectionThreadManualBucketInput,
  SetProjectionThreadManualPositionInput,
  type ProjectionThreadRepositoryShape,
} from "../Services/ProjectionThreads.ts";
import { DEFAULT_AGENT_TOKEN_MODE, ModelSelection } from "@ryco/contracts";

const ProjectionThreadDbRow = ProjectionThread.mapFields(
  Struct.assign({
    modelSelection: Schema.fromJsonString(ModelSelection),
  }),
);
type ProjectionThreadDbRow = typeof ProjectionThreadDbRow.Type;

const makeProjectionThreadRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertProjectionThreadRow = SqlSchema.void({
    Request: ProjectionThread,
    execute: (row) =>
      sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          model_selection_json,
          runtime_mode,
          interaction_mode,
          token_mode,
          branch,
          worktree_path,
          worktree_id,
          manual_status_bucket,
          manual_position,
          latest_turn_id,
          created_at,
          updated_at,
          archived_at,
          latest_user_message_at,
          pending_approval_count,
          pending_user_input_count,
          has_actionable_proposed_plan,
          deleted_at
        )
        VALUES (
          ${row.threadId},
          ${row.projectId},
          ${row.title},
          ${JSON.stringify(row.modelSelection)},
          ${row.runtimeMode},
          ${row.interactionMode},
          ${row.tokenMode ?? DEFAULT_AGENT_TOKEN_MODE},
          ${row.branch},
          ${row.worktreePath},
          ${row.worktreeId ?? null},
          ${row.manualStatusBucket ?? null},
          ${row.manualPosition ?? 0},
          ${row.latestTurnId},
          ${row.createdAt},
          ${row.updatedAt},
          ${row.archivedAt},
          ${row.latestUserMessageAt},
          ${row.pendingApprovalCount},
          ${row.pendingUserInputCount},
          ${row.hasActionableProposedPlan},
          ${row.deletedAt}
        )
        ON CONFLICT (thread_id)
        DO UPDATE SET
          project_id = excluded.project_id,
          title = excluded.title,
          model_selection_json = excluded.model_selection_json,
          runtime_mode = excluded.runtime_mode,
          interaction_mode = excluded.interaction_mode,
          token_mode = excluded.token_mode,
          branch = excluded.branch,
          worktree_path = excluded.worktree_path,
          worktree_id = excluded.worktree_id,
          manual_status_bucket = excluded.manual_status_bucket,
          manual_position = excluded.manual_position,
          latest_turn_id = excluded.latest_turn_id,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          archived_at = excluded.archived_at,
          latest_user_message_at = excluded.latest_user_message_at,
          pending_approval_count = excluded.pending_approval_count,
          pending_user_input_count = excluded.pending_user_input_count,
          has_actionable_proposed_plan = excluded.has_actionable_proposed_plan,
          deleted_at = excluded.deleted_at
      `,
  });

  const getProjectionThreadRow = SqlSchema.findOneOption({
    Request: GetProjectionThreadInput,
    Result: ProjectionThreadDbRow,
    execute: ({ threadId }) =>
      sql`
        SELECT
          thread_id AS "threadId",
          project_id AS "projectId",
          title,
          model_selection_json AS "modelSelection",
          runtime_mode AS "runtimeMode",
          interaction_mode AS "interactionMode",
          token_mode AS "tokenMode",
          branch,
          worktree_path AS "worktreePath",
          worktree_id AS "worktreeId",
          manual_status_bucket AS "manualStatusBucket",
          manual_position AS "manualPosition",
          latest_turn_id AS "latestTurnId",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          archived_at AS "archivedAt",
          latest_user_message_at AS "latestUserMessageAt",
          pending_approval_count AS "pendingApprovalCount",
          pending_user_input_count AS "pendingUserInputCount",
          has_actionable_proposed_plan AS "hasActionableProposedPlan",
          deleted_at AS "deletedAt"
        FROM projection_threads
        WHERE thread_id = ${threadId}
      `,
  });

  const listProjectionThreadRows = SqlSchema.findAll({
    Request: ListProjectionThreadsByProjectInput,
    Result: ProjectionThreadDbRow,
    execute: ({ projectId }) =>
      sql`
        SELECT
          thread_id AS "threadId",
          project_id AS "projectId",
          title,
          model_selection_json AS "modelSelection",
          runtime_mode AS "runtimeMode",
          interaction_mode AS "interactionMode",
          token_mode AS "tokenMode",
          branch,
          worktree_path AS "worktreePath",
          worktree_id AS "worktreeId",
          manual_status_bucket AS "manualStatusBucket",
          manual_position AS "manualPosition",
          latest_turn_id AS "latestTurnId",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          archived_at AS "archivedAt",
          latest_user_message_at AS "latestUserMessageAt",
          pending_approval_count AS "pendingApprovalCount",
          pending_user_input_count AS "pendingUserInputCount",
          has_actionable_proposed_plan AS "hasActionableProposedPlan",
          deleted_at AS "deletedAt"
        FROM projection_threads
        WHERE project_id = ${projectId}
        ORDER BY created_at ASC, thread_id ASC
      `,
  });

  const deleteProjectionThreadRow = SqlSchema.void({
    Request: DeleteProjectionThreadInput,
    execute: ({ threadId }) =>
      sql`
        DELETE FROM projection_threads
        WHERE thread_id = ${threadId}
      `,
  });

  const attachProjectionThreadToWorktree = SqlSchema.void({
    Request: AttachProjectionThreadToWorktreeInput,
    execute: ({ threadId, worktreeId }) =>
      sql`
        UPDATE projection_threads
        SET worktree_id = ${worktreeId}
        WHERE thread_id = ${threadId}
      `,
  });

  const setProjectionThreadManualBucket = SqlSchema.void({
    Request: SetProjectionThreadManualBucketInput,
    execute: ({ threadId, bucket }) =>
      sql`
        UPDATE projection_threads
        SET manual_status_bucket = ${bucket}
        WHERE thread_id = ${threadId}
      `,
  });

  const setProjectionThreadManualPosition = SqlSchema.void({
    Request: SetProjectionThreadManualPositionInput,
    execute: ({ threadId, position }) =>
      sql`
        UPDATE projection_threads
        SET manual_position = ${position}
        WHERE thread_id = ${threadId}
      `,
  });

  const upsert: ProjectionThreadRepositoryShape["upsert"] = (row) =>
    upsertProjectionThreadRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionThreadRepository.upsert:query")),
    );

  const getById: ProjectionThreadRepositoryShape["getById"] = (input) =>
    getProjectionThreadRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionThreadRepository.getById:query")),
    );

  const listByProjectId: ProjectionThreadRepositoryShape["listByProjectId"] = (input) =>
    listProjectionThreadRows(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionThreadRepository.listByProjectId:query")),
    );

  const deleteById: ProjectionThreadRepositoryShape["deleteById"] = (input) =>
    deleteProjectionThreadRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionThreadRepository.deleteById:query")),
    );

  const attachToWorktree: ProjectionThreadRepositoryShape["attachToWorktree"] = (input) =>
    attachProjectionThreadToWorktree(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionThreadRepository.attachToWorktree:query")),
    );

  const setManualBucket: ProjectionThreadRepositoryShape["setManualBucket"] = (input) =>
    setProjectionThreadManualBucket(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionThreadRepository.setManualBucket:query")),
    );

  const setManualPosition: ProjectionThreadRepositoryShape["setManualPosition"] = (input) =>
    setProjectionThreadManualPosition(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionThreadRepository.setManualPosition:query")),
    );

  return {
    upsert,
    getById,
    listByProjectId,
    deleteById,
    attachToWorktree,
    setManualBucket,
    setManualPosition,
  } satisfies ProjectionThreadRepositoryShape;
});

export const ProjectionThreadRepositoryLive = Layer.effect(
  ProjectionThreadRepository,
  makeProjectionThreadRepository,
);
