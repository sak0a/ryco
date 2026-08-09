import {
  PullRequestAccessTarget,
  PullRequestAssociation,
  PullRequestId,
  PullRequestFreshness,
  PullRequestRecord,
  EnvironmentId,
  ProjectId,
} from "@ryco/contracts";
import { DateTime, Effect, Layer, Option, PubSub, Schema, Stream, Struct } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { toPersistenceDecodeCauseError, toPersistenceSqlError } from "../Errors.ts";
import {
  ProjectionPullRequestRepository,
  type ProjectionPullRequestRepositoryShape,
} from "../Services/ProjectionPullRequests.ts";

const PullRequestFreshnessJson = PullRequestFreshness.mapFields(
  Struct.assign({
    observedAt: Schema.DateTimeUtcFromString,
    providerUpdatedAt: Schema.OptionFromNullOr(Schema.DateTimeUtcFromString),
  }),
);
const PullRequestRecordJson = Schema.fromJsonString(
  PullRequestRecord.mapFields(Struct.assign({ freshness: PullRequestFreshnessJson })),
);

const encodeRecord = Schema.encodeSync(PullRequestRecordJson);
const decodeRecord = Schema.decodeUnknownSync(PullRequestRecordJson);

interface PullRequestRow {
  readonly recordJson: string;
}

interface AccessTargetRow {
  readonly pullRequestId: string;
  readonly environmentId: string;
  readonly projectId: string | null;
  readonly cwd: string;
  readonly remoteUrl: string | null;
  readonly lastVerifiedAt: string;
}

interface AssociationRow {
  readonly pullRequestId: string;
  readonly subjectKind: "thread" | "worktree";
  readonly subjectId: string;
  readonly relationship: PullRequestAssociation["relationship"];
  readonly evidence: PullRequestAssociation["evidence"];
  readonly createdAt: string;
  readonly endedAt: string | null;
}

interface ViewStateRow {
  readonly pullRequestId: string;
  readonly viewedAt: string | null;
  readonly providerUpdatedAtWhenViewed: string | null;
  readonly markedUnreadAt: string | null;
}

const subjectParts = (subject: PullRequestAssociation["subject"]) =>
  subject.kind === "thread"
    ? { kind: subject.kind, id: subject.threadId }
    : { kind: subject.kind, id: subject.worktreeId };

const decodeAssociation = (row: AssociationRow): PullRequestAssociation => ({
  pullRequestId: row.pullRequestId as PullRequestId,
  subject:
    row.subjectKind === "thread"
      ? { kind: "thread", threadId: row.subjectId as never }
      : { kind: "worktree", worktreeId: row.subjectId as never },
  relationship: row.relationship,
  evidence: row.evidence,
  createdAt: DateTime.makeUnsafe(row.createdAt),
  endedAt: row.endedAt === null ? Option.none() : Option.some(DateTime.makeUnsafe(row.endedAt)),
});

const makeProjectionPullRequestRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const changes = yield* PubSub.unbounded<void>();
  const notify = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(Effect.tap(() => PubSub.publish(changes, undefined)));

  const upsert: ProjectionPullRequestRepositoryShape["upsert"] = (record) =>
    Effect.gen(function* () {
      const existing = yield* sql<{
        readonly refreshGeneration: number;
        readonly providerUpdatedAt: string | null;
      }>`
        SELECT refresh_generation AS "refreshGeneration",
          provider_updated_at AS "providerUpdatedAt"
        FROM projection_pull_requests
        WHERE pull_request_id = ${record.identity.id}
      `;
      const nextProviderUpdatedAt = Option.getOrNull(record.freshness.providerUpdatedAt);
      if (
        existing[0] !== undefined &&
        (existing[0].refreshGeneration > record.freshness.refreshGeneration ||
          (existing[0].providerUpdatedAt !== null &&
            nextProviderUpdatedAt !== null &&
            DateTime.toEpochMillis(DateTime.makeUnsafe(existing[0].providerUpdatedAt)) >
              DateTime.toEpochMillis(nextProviderUpdatedAt)))
      ) {
        return false;
      }
      yield* sql`
        INSERT INTO projection_pull_requests (
          pull_request_id, environment_id, provider, host, repository_path, repository_key,
          number, state, is_draft, title, author, provider_updated_at, observed_at,
          refresh_generation, record_json
        ) VALUES (
          ${record.identity.id}, ${record.identity.environmentId}, ${record.identity.provider},
          ${record.identity.host}, ${record.identity.repositoryPath}, ${record.repository.canonicalKey},
          ${record.identity.number}, ${record.state}, ${record.isDraft ? 1 : 0}, ${record.title},
          ${record.author ?? null}, ${nextProviderUpdatedAt === null ? null : DateTime.formatIso(nextProviderUpdatedAt)},
          ${DateTime.formatIso(record.freshness.observedAt)}, ${record.freshness.refreshGeneration},
          ${encodeRecord(record)}
        )
        ON CONFLICT(pull_request_id) DO UPDATE SET
          state = excluded.state,
          is_draft = excluded.is_draft,
          title = excluded.title,
          author = excluded.author,
          provider_updated_at = excluded.provider_updated_at,
          observed_at = excluded.observed_at,
          refresh_generation = excluded.refresh_generation,
          record_json = excluded.record_json
      `;
      yield* PubSub.publish(changes, undefined);
      return true;
    }).pipe(Effect.mapError(toPersistenceSqlError("ProjectionPullRequestRepository.upsert")));

  const getById: ProjectionPullRequestRepositoryShape["getById"] = (pullRequestId) =>
    sql<PullRequestRow>`
      SELECT record_json AS "recordJson"
      FROM projection_pull_requests
      WHERE pull_request_id = ${pullRequestId}
    `.pipe(
      Effect.flatMap((rows) =>
        rows[0] === undefined
          ? Effect.succeed(Option.none())
          : Effect.try({
              try: () => Option.some(decodeRecord(rows[0]!.recordJson)),
              catch: toPersistenceDecodeCauseError("ProjectionPullRequestRepository.getById"),
            }),
      ),
      Effect.mapError((error) =>
        "operation" in error
          ? error
          : toPersistenceSqlError("ProjectionPullRequestRepository.getById")(error),
      ),
    );

  const listAll: ProjectionPullRequestRepositoryShape["listAll"] = () =>
    sql<PullRequestRow>`
      SELECT record_json AS "recordJson"
      FROM projection_pull_requests
      ORDER BY COALESCE(provider_updated_at, observed_at) DESC, pull_request_id ASC
    `.pipe(
      Effect.flatMap((rows) =>
        Effect.try({
          try: () => rows.map((row) => decodeRecord(row.recordJson)),
          catch: toPersistenceDecodeCauseError("ProjectionPullRequestRepository.listAll"),
        }),
      ),
      Effect.mapError((error) =>
        "operation" in error
          ? error
          : toPersistenceSqlError("ProjectionPullRequestRepository.listAll")(error),
      ),
    );

  const upsertAccessTarget: ProjectionPullRequestRepositoryShape["upsertAccessTarget"] = (target) =>
    notify(
      sql`
      INSERT INTO projection_pull_request_access_targets (
        pull_request_id, environment_id, project_id, cwd, remote_url, last_verified_at
      ) VALUES (
        ${target.pullRequestId}, ${target.environmentId}, ${target.projectId ?? null}, ${target.cwd},
        ${target.remoteUrl ?? null}, ${DateTime.formatIso(target.lastVerifiedAt)}
      )
      ON CONFLICT(pull_request_id, cwd) DO UPDATE SET
        project_id = excluded.project_id,
        remote_url = excluded.remote_url,
        last_verified_at = excluded.last_verified_at
    `.pipe(
        Effect.asVoid,
        Effect.mapError(
          toPersistenceSqlError("ProjectionPullRequestRepository.upsertAccessTarget"),
        ),
      ),
    );

  const listAccessTargets: ProjectionPullRequestRepositoryShape["listAccessTargets"] = (
    pullRequestId,
  ) =>
    sql<AccessTargetRow>`
      SELECT pull_request_id AS "pullRequestId", environment_id AS "environmentId",
        project_id AS "projectId", cwd, remote_url AS "remoteUrl",
        last_verified_at AS "lastVerifiedAt"
      FROM projection_pull_request_access_targets
      WHERE pull_request_id = ${pullRequestId}
      ORDER BY last_verified_at DESC
    `.pipe(
      Effect.flatMap((rows) =>
        Effect.try({
          try: () =>
            rows.map(
              (row): PullRequestAccessTarget => ({
                pullRequestId: row.pullRequestId as PullRequestId,
                environmentId: row.environmentId as EnvironmentId,
                ...(row.projectId ? { projectId: row.projectId as ProjectId } : {}),
                cwd: row.cwd,
                ...(row.remoteUrl ? { remoteUrl: row.remoteUrl } : {}),
                lastVerifiedAt: DateTime.makeUnsafe(row.lastVerifiedAt),
              }),
            ),
          catch: toPersistenceDecodeCauseError("ProjectionPullRequestRepository.listAccessTargets"),
        }),
      ),
      Effect.mapError((error) =>
        "operation" in error
          ? error
          : toPersistenceSqlError("ProjectionPullRequestRepository.listAccessTargets")(error),
      ),
    );

  const recordAssociation: ProjectionPullRequestRepositoryShape["recordAssociation"] = (
    association,
  ) => {
    const subject = subjectParts(association.subject);
    return notify(
      sql`
      INSERT INTO projection_pull_request_associations (
        pull_request_id, subject_kind, subject_id, relationship, evidence, created_at, ended_at
      ) VALUES (
        ${association.pullRequestId}, ${subject.kind}, ${subject.id}, ${association.relationship},
        ${association.evidence}, ${DateTime.formatIso(association.createdAt)},
        ${Option.match(association.endedAt, { onNone: () => null, onSome: DateTime.formatIso })}
      )
      ON CONFLICT(pull_request_id, subject_kind, subject_id, relationship)
      WHERE ended_at IS NULL DO NOTHING
    `.pipe(
        Effect.asVoid,
        Effect.mapError(toPersistenceSqlError("ProjectionPullRequestRepository.recordAssociation")),
      ),
    );
  };

  const endAssociation: ProjectionPullRequestRepositoryShape["endAssociation"] = (input) => {
    const subject = subjectParts(input.subject);
    return notify(
      sql`
      UPDATE projection_pull_request_associations
      SET ended_at = ${DateTime.formatIso(input.endedAt)}
      WHERE pull_request_id = ${input.pullRequestId}
        AND subject_kind = ${subject.kind}
        AND subject_id = ${subject.id}
        AND relationship = ${input.relationship}
        AND ended_at IS NULL
    `.pipe(
        Effect.asVoid,
        Effect.mapError(toPersistenceSqlError("ProjectionPullRequestRepository.endAssociation")),
      ),
    );
  };

  const listAssociations: ProjectionPullRequestRepositoryShape["listAssociations"] = (
    pullRequestId,
  ) =>
    sql<AssociationRow>`
      SELECT pull_request_id AS "pullRequestId", subject_kind AS "subjectKind",
        subject_id AS "subjectId", relationship, evidence, created_at AS "createdAt",
        ended_at AS "endedAt"
      FROM projection_pull_request_associations
      WHERE pull_request_id = ${pullRequestId}
      ORDER BY created_at ASC, association_id ASC
    `.pipe(
      Effect.map((rows) => rows.map(decodeAssociation)),
      Effect.mapError(toPersistenceSqlError("ProjectionPullRequestRepository.listAssociations")),
    );

  const markViewed: ProjectionPullRequestRepositoryShape["markViewed"] = (input) =>
    notify(
      Effect.gen(function* () {
        const record = yield* getById(input.pullRequestId);
        if (Option.isNone(record)) return;
        const providerUpdatedAt = Option.getOrNull(record.value.freshness.providerUpdatedAt);
        yield* sql`
        INSERT INTO projection_pull_request_view_state (
          pull_request_id, viewer_key, viewed_at, provider_updated_at_when_viewed, marked_unread_at
        ) VALUES (
          ${input.pullRequestId}, ${input.viewerKey}, ${DateTime.formatIso(input.viewedAt)},
          ${providerUpdatedAt === null ? null : DateTime.formatIso(providerUpdatedAt)}, null
        )
        ON CONFLICT(pull_request_id, viewer_key) DO UPDATE SET
          viewed_at = excluded.viewed_at,
          provider_updated_at_when_viewed = excluded.provider_updated_at_when_viewed,
          marked_unread_at = null
      `;
      }).pipe(Effect.mapError(toPersistenceSqlError("ProjectionPullRequestRepository.markViewed"))),
    );

  const markUnread: ProjectionPullRequestRepositoryShape["markUnread"] = (input) =>
    notify(
      sql`
      INSERT INTO projection_pull_request_view_state (
        pull_request_id, viewer_key, viewed_at, provider_updated_at_when_viewed, marked_unread_at
      ) VALUES (${input.pullRequestId}, ${input.viewerKey}, null, null, ${DateTime.formatIso(input.markedAt)})
      ON CONFLICT(pull_request_id, viewer_key) DO UPDATE SET
        marked_unread_at = excluded.marked_unread_at
    `.pipe(
        Effect.asVoid,
        Effect.mapError(toPersistenceSqlError("ProjectionPullRequestRepository.markUnread")),
      ),
    );

  const listInbox: ProjectionPullRequestRepositoryShape["listInbox"] = (viewerKey) =>
    Effect.gen(function* () {
      const records = yield* listAll();
      const viewRows = yield* sql<ViewStateRow>`
        SELECT pull_request_id AS "pullRequestId", viewed_at AS "viewedAt",
          provider_updated_at_when_viewed AS "providerUpdatedAtWhenViewed",
          marked_unread_at AS "markedUnreadAt"
        FROM projection_pull_request_view_state
        WHERE viewer_key = ${viewerKey}
      `;
      const viewById = new Map(viewRows.map((row) => [row.pullRequestId, row]));
      const items = yield* Effect.forEach(records, (pullRequest) =>
        listAssociations(pullRequest.identity.id).pipe(
          Effect.map((associations) => {
            const row = viewById.get(pullRequest.identity.id);
            const providerUpdatedAt = Option.getOrNull(pullRequest.freshness.providerUpdatedAt);
            const viewedProviderAt = row?.providerUpdatedAtWhenViewed
              ? DateTime.makeUnsafe(row.providerUpdatedAtWhenViewed)
              : null;
            const manuallyUnread =
              row?.markedUnreadAt !== null && row?.markedUnreadAt !== undefined;
            const neverViewed = row?.viewedAt === null || row?.viewedAt === undefined;
            const updatedSinceView =
              providerUpdatedAt !== null &&
              (viewedProviderAt === null ||
                DateTime.toEpochMillis(providerUpdatedAt) >
                  DateTime.toEpochMillis(viewedProviderAt));
            return {
              pullRequest,
              associations,
              viewState: {
                pullRequestId: pullRequest.identity.id,
                isUnread: manuallyUnread || neverViewed || updatedSinceView,
                viewedAt: row?.viewedAt
                  ? Option.some(DateTime.makeUnsafe(row.viewedAt))
                  : Option.none(),
                providerUpdatedAtWhenViewed: viewedProviderAt
                  ? Option.some(viewedProviderAt)
                  : Option.none(),
              },
            };
          }),
        ),
      );
      return {
        generation: records.reduce(
          (max, record) => Math.max(max, record.freshness.refreshGeneration),
          0,
        ),
        items,
        coverage: [],
        lastSuccessAt:
          records[0] === undefined ? Option.none() : Option.some(records[0].freshness.observedAt),
      };
    }).pipe(
      Effect.mapError((error) =>
        "operation" in error
          ? error
          : toPersistenceSqlError("ProjectionPullRequestRepository.listInbox")(error),
      ),
    );

  return {
    streamChanges: Stream.fromPubSub(changes),
    upsert,
    getById,
    listAll,
    upsertAccessTarget,
    listAccessTargets,
    recordAssociation,
    endAssociation,
    listAssociations,
    markViewed,
    markUnread,
    listInbox,
  } satisfies ProjectionPullRequestRepositoryShape;
});

export const ProjectionPullRequestRepositoryLive = Layer.effect(
  ProjectionPullRequestRepository,
  makeProjectionPullRequestRepository,
);
