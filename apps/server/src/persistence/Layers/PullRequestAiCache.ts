import {
  PullRequestAiAnalysis,
  PullRequestAiRun,
  PullRequestMergeReadiness,
  type PullRequestAiSnapshot,
} from "@ryco/contracts";
import { DateTime, Effect, Layer, Option, PubSub, Schema, Stream, Struct } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { toPersistenceDecodeCauseError, toPersistenceSqlError } from "../Errors.ts";
import {
  PullRequestAiCache,
  type PullRequestAiCacheShape,
} from "../Services/PullRequestAiCache.ts";

const AnalysisJson = Schema.fromJsonString(
  PullRequestAiAnalysis.mapFields(
    Struct.assign({
      sourceProviderUpdatedAt: Schema.OptionFromNullOr(Schema.DateTimeUtcFromString),
      mergeReadiness: Schema.OptionFromNullOr(PullRequestMergeReadiness),
      analyzedAt: Schema.DateTimeUtcFromString,
      expiresAt: Schema.DateTimeUtcFromString,
    }),
  ),
);
const RunJson = Schema.fromJsonString(
  PullRequestAiRun.mapFields(
    Struct.assign({
      startedAt: Schema.DateTimeUtcFromString,
      completedAt: Schema.OptionFromNullOr(Schema.DateTimeUtcFromString),
    }),
  ),
);

const encodeAnalysis = Schema.encodeSync(AnalysisJson);
const decodeAnalysis = Schema.decodeUnknownSync(AnalysisJson);
const encodeRun = Schema.encodeSync(RunJson);
const decodeRun = Schema.decodeUnknownSync(RunJson);

interface AnalysisRow {
  readonly analysisJson: string;
  readonly providerUpdatedAt: string | null;
}

interface RunRow {
  readonly runJson: string;
}

interface GenerationRow {
  readonly generation: number;
}

const activeRunStatuses = ["planned", "ranking", "deep-analysis", "cancelling"] as const;

const makePullRequestAiCache = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const changes = yield* PubSub.unbounded<void>();

  const notify = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.tap(
        () => sql`UPDATE pull_request_ai_meta SET generation = generation + 1 WHERE singleton = 1`,
      ),
      Effect.tap(() => PubSub.publish(changes, undefined)),
    );

  const getCurrentAnalysis: PullRequestAiCacheShape["getCurrentAnalysis"] = ({
    pullRequestId,
    viewerKey,
  }) =>
    sql<AnalysisRow>`
      SELECT analysis_json AS "analysisJson"
      FROM pull_request_ai_analyses
      WHERE pull_request_id = ${pullRequestId} AND viewer_key = ${viewerKey}
    `.pipe(
      Effect.flatMap((rows) =>
        rows[0] === undefined
          ? Effect.succeed(Option.none())
          : Effect.try({
              try: () => Option.some(decodeAnalysis(rows[0]!.analysisJson)),
              catch: toPersistenceDecodeCauseError("PullRequestAiCache.getCurrentAnalysis"),
            }),
      ),
      Effect.mapError((error) =>
        "operation" in error
          ? error
          : toPersistenceSqlError("PullRequestAiCache.getCurrentAnalysis")(error),
      ),
    );

  const upsertAnalysis: PullRequestAiCacheShape["upsertAnalysis"] = (analysis) =>
    notify(
      sql`
        INSERT INTO pull_request_ai_analyses (
          pull_request_id, viewer_key, provider_instance_id, model, prompt_version,
          schema_version, source_fingerprint, depth, priority_score, analyzed_at,
          expires_at, analysis_json
        ) VALUES (
          ${analysis.pullRequestId}, ${analysis.viewerKey}, ${analysis.modelSelection.instanceId},
          ${analysis.modelSelection.model}, ${analysis.promptVersion}, ${analysis.schemaVersion},
          ${analysis.sourceFingerprint}, ${analysis.depth}, ${analysis.priorityScore},
          ${DateTime.formatIso(analysis.analyzedAt)}, ${DateTime.formatIso(analysis.expiresAt)},
          ${encodeAnalysis(analysis)}
        )
        ON CONFLICT(pull_request_id, viewer_key) DO UPDATE SET
          provider_instance_id = excluded.provider_instance_id,
          model = excluded.model,
          prompt_version = excluded.prompt_version,
          schema_version = excluded.schema_version,
          source_fingerprint = excluded.source_fingerprint,
          depth = excluded.depth,
          priority_score = excluded.priority_score,
          analyzed_at = excluded.analyzed_at,
          expires_at = excluded.expires_at,
          analysis_json = excluded.analysis_json
      `,
    ).pipe(
      Effect.asVoid,
      Effect.mapError(toPersistenceSqlError("PullRequestAiCache.upsertAnalysis")),
    );

  const upsertRun: PullRequestAiCacheShape["upsertRun"] = (run) =>
    notify(
      sql`
        INSERT INTO pull_request_ai_runs (
          run_id, environment_id, viewer_key, status, started_at, completed_at, run_json
        ) VALUES (
          ${run.id}, ${run.environmentId}, ${run.viewerKey}, ${run.status},
          ${DateTime.formatIso(run.startedAt)},
          ${Option.match(run.completedAt, { onNone: () => null, onSome: DateTime.formatIso })},
          ${encodeRun(run)}
        )
        ON CONFLICT(run_id) DO UPDATE SET
          status = excluded.status,
          completed_at = excluded.completed_at,
          run_json = excluded.run_json
      `,
    ).pipe(Effect.asVoid, Effect.mapError(toPersistenceSqlError("PullRequestAiCache.upsertRun")));

  const listSnapshot: PullRequestAiCacheShape["listSnapshot"] = ({ environmentId, viewerKey }) =>
    Effect.all([
      sql<AnalysisRow>`
          SELECT analysis.analysis_json AS "analysisJson",
                 pr.provider_updated_at AS "providerUpdatedAt"
          FROM pull_request_ai_analyses analysis
          INNER JOIN projection_pull_requests pr
            ON pr.pull_request_id = analysis.pull_request_id
          WHERE analysis.viewer_key = ${viewerKey} AND pr.environment_id = ${environmentId}
          ORDER BY analysis.priority_score DESC, analysis.analyzed_at DESC
        `,
      sql<RunRow>`
          SELECT run_json AS "runJson"
          FROM pull_request_ai_runs
          WHERE viewer_key = ${viewerKey} AND environment_id = ${environmentId}
          ORDER BY started_at DESC
          LIMIT 20
        `,
      sql<GenerationRow>`SELECT generation FROM pull_request_ai_meta WHERE singleton = 1`,
    ]).pipe(
      Effect.flatMap(([analysisRows, runRows, generationRows]) =>
        Effect.try({
          try: () => {
            const analyses = analysisRows.map((row) => {
              const analysis = decodeAnalysis(row.analysisJson);
              const sourceProviderUpdatedAt = Option.match(analysis.sourceProviderUpdatedAt, {
                onNone: () => null,
                onSome: DateTime.formatIso,
              });
              return {
                ...analysis,
                isStale:
                  analysis.isStale ||
                  sourceProviderUpdatedAt !== row.providerUpdatedAt ||
                  DateTime.toEpochMillis(analysis.expiresAt) <= Date.now(),
              };
            });
            const runs = runRows.map((row) => decodeRun(row.runJson));
            const currentRun = runs.find((run) => activeRunStatuses.includes(run.status as never));
            const latestRun = runs[0];
            const lastAnalysis = analyses
              .map((analysis) => analysis.analyzedAt)
              .toSorted(
                (left, right) => DateTime.toEpochMillis(right) - DateTime.toEpochMillis(left),
              )[0];
            return {
              generation: generationRows[0]?.generation ?? 0,
              analyses,
              currentRun: currentRun ? Option.some(currentRun) : Option.none(),
              latestRun: latestRun ? Option.some(latestRun) : Option.none(),
              lastSuccessAt: lastAnalysis ? Option.some(lastAnalysis) : Option.none(),
            } satisfies PullRequestAiSnapshot;
          },
          catch: toPersistenceDecodeCauseError("PullRequestAiCache.listSnapshot"),
        }),
      ),
      Effect.mapError((error) =>
        "operation" in error
          ? error
          : toPersistenceSqlError("PullRequestAiCache.listSnapshot")(error),
      ),
    );

  return {
    streamChanges: Stream.fromPubSub(changes),
    getCurrentAnalysis,
    upsertAnalysis,
    upsertRun,
    listSnapshot,
  } satisfies PullRequestAiCacheShape;
});

export const PullRequestAiCacheLive = Layer.effect(PullRequestAiCache, makePullRequestAiCache);
