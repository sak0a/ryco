import { ApprovalRequestId, IsoDateTime, NonNegativeInt, ThreadId } from "@ryco/contracts";
import { Effect, Layer, Option, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  ProjectionThreadUserInputRequest,
  ProjectionThreadUserInputRequestRepository,
  type ProjectionThreadUserInputRequestRepositoryShape,
} from "../Services/ProjectionThreadUserInputRequests.ts";

const ProjectionThreadUserInputRequestDbRow = Schema.Struct({
  requestId: ApprovalRequestId,
  threadId: ThreadId,
  isPending: NonNegativeInt,
  updatedAt: IsoDateTime,
});

const makeProjectionThreadUserInputRequestRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertRow = SqlSchema.void({
    Request: ProjectionThreadUserInputRequest,
    execute: (row) => sql`
      INSERT INTO projection_thread_user_input_requests (
        request_id,
        thread_id,
        is_pending,
        updated_at
      )
      VALUES (
        ${row.requestId},
        ${row.threadId},
        ${Number(row.isPending)},
        ${row.updatedAt}
      )
      ON CONFLICT (request_id)
      DO UPDATE SET
        thread_id = excluded.thread_id,
        is_pending = excluded.is_pending,
        updated_at = excluded.updated_at
    `,
  });

  const getRow = SqlSchema.findOneOption({
    Request: Schema.Struct({ requestId: ApprovalRequestId }),
    Result: ProjectionThreadUserInputRequestDbRow,
    execute: ({ requestId }) => sql`
      SELECT
        request_id AS "requestId",
        thread_id AS "threadId",
        is_pending AS "isPending",
        updated_at AS "updatedAt"
      FROM projection_thread_user_input_requests
      WHERE request_id = ${requestId}
    `,
  });

  const deleteRowsByThread = SqlSchema.void({
    Request: Schema.Struct({ threadId: ThreadId }),
    execute: ({ threadId }) => sql`
      DELETE FROM projection_thread_user_input_requests
      WHERE thread_id = ${threadId}
    `,
  });

  const upsert: ProjectionThreadUserInputRequestRepositoryShape["upsert"] = (row) =>
    upsertRow(row).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadUserInputRequestRepository.upsert:query"),
      ),
    );

  const getByRequestId: ProjectionThreadUserInputRequestRepositoryShape["getByRequestId"] = (
    input,
  ) =>
    getRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadUserInputRequestRepository.getByRequestId:query"),
      ),
      Effect.map(
        Option.map((row) => ({
          requestId: row.requestId,
          threadId: row.threadId,
          isPending: row.isPending === 1,
          updatedAt: row.updatedAt,
        })),
      ),
    );

  const deleteByThreadId: ProjectionThreadUserInputRequestRepositoryShape["deleteByThreadId"] = (
    input,
  ) =>
    deleteRowsByThread(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadUserInputRequestRepository.deleteByThreadId:query"),
      ),
    );

  return {
    upsert,
    getByRequestId,
    deleteByThreadId,
  } satisfies ProjectionThreadUserInputRequestRepositoryShape;
});

export const ProjectionThreadUserInputRequestRepositoryLive = Layer.effect(
  ProjectionThreadUserInputRequestRepository,
  makeProjectionThreadUserInputRequestRepository,
);
