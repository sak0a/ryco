/**
 * StatisticsQuery - usage analytics over the orchestration projection tables.
 *
 * Aggregates the existing read models (threads, sessions, token-usage
 * activities, turns/checkpoints, worktrees) into a {@link StatisticsSnapshot}
 * on demand. No dedicated statistics tables exist; everything is derived from
 * data already persisted by the projection pipeline.
 *
 * Token figures use a per-turn delta attribution: for each `(thread, turn)` we
 * read the final `context-window.updated` activity and sum its `last*` deltas,
 * bucketed by day/project/model. When deltas are absent (older data / providers
 * that only report cumulative totals) we fall back to attributing a thread's
 * cumulative total to its primary model and last-activity day.
 *
 * @module StatisticsQuery
 */
import {
  ProjectId,
  type StatisticsDailyBucket,
  type StatisticsModelRef,
  type StatisticsProjectRef,
  type StatisticsSnapshot,
  type StatisticsTokenAttribution,
} from "@ryco/contracts";
import { Context, Effect, Layer, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import {
  toPersistenceDecodeError,
  toPersistenceSqlError,
  type ProjectionRepositoryError,
} from "../persistence/Errors.ts";

/**
 * StatisticsQueryShape - service API.
 */
export interface StatisticsQueryShape {
  readonly getStatistics: () => Effect.Effect<StatisticsSnapshot, ProjectionRepositoryError>;
}

/**
 * StatisticsQuery - service tag.
 */
export class StatisticsQuery extends Context.Service<StatisticsQuery, StatisticsQueryShape>()(
  "ryco/statistics/StatisticsQuery",
) {}

function toPersistenceSqlOrDecodeError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown): ProjectionRepositoryError =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(decodeOperation)(cause)
      : toPersistenceSqlError(sqlOperation)(cause);
}

const ThreadRow = Schema.Struct({
  threadId: Schema.String,
  projectId: ProjectId,
  model: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  providerName: Schema.NullOr(Schema.String),
});

const ProjectRow = Schema.Struct({
  projectId: ProjectId,
  title: Schema.String,
  deletedAt: Schema.NullOr(Schema.String),
});

const TokenActivityRow = Schema.Struct({
  threadId: Schema.String,
  turnId: Schema.NullOr(Schema.String),
  sequence: Schema.NullOr(Schema.Number),
  createdAt: Schema.String,
  payloadJson: Schema.String,
});

const ToolUseRow = Schema.Struct({
  threadId: Schema.String,
  date: Schema.String,
  count: Schema.Number,
});

const TurnRow = Schema.Struct({
  threadId: Schema.String,
  startedAt: Schema.NullOr(Schema.String),
  completedAt: Schema.NullOr(Schema.String),
  checkpointTurnCount: Schema.NullOr(Schema.Number),
  filesJson: Schema.String,
});

const WorktreeRow = Schema.Struct({
  createdAt: Schema.String,
  archivedAt: Schema.NullOr(Schema.String),
  prNumber: Schema.NullOr(Schema.Number),
});

interface MutableBucket {
  date: string;
  projectId: ProjectId;
  model: string;
  provider: string | undefined;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
  turns: number;
  activeMs: number;
  toolUses: number;
  filesChanged: number;
  additions: number;
  deletions: number;
  commits: number;
  pushes: number;
  threadsCreated: number;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function dayOf(iso: string): string | null {
  return iso.length >= 10 ? iso.slice(0, 10) : null;
}

const makeStatisticsQuery = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const listThreadRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ThreadRow,
    execute: () =>
      sql`
        SELECT
          t.thread_id AS "threadId",
          t.project_id AS "projectId",
          json_extract(t.model_selection_json, '$.model') AS "model",
          t.created_at AS "createdAt",
          COALESCE(
            s.provider_name,
            json_extract(t.model_selection_json, '$.provider')
          ) AS "providerName"
        FROM projection_threads t
        LEFT JOIN projection_thread_sessions s ON s.thread_id = t.thread_id
      `,
  });

  const listProjectRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectRow,
    execute: () =>
      sql`
        SELECT
          project_id AS "projectId",
          title,
          deleted_at AS "deletedAt"
        FROM projection_projects
      `,
  });

  const listTokenActivityRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: TokenActivityRow,
    execute: () =>
      sql`
        SELECT
          thread_id AS "threadId",
          turn_id AS "turnId",
          sequence,
          created_at AS "createdAt",
          payload_json AS "payloadJson"
        FROM projection_thread_activities
        WHERE kind = 'context-window.updated'
        ORDER BY thread_id ASC, turn_id ASC, sequence ASC, created_at ASC, activity_id ASC
      `,
  });

  const listToolUseRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ToolUseRow,
    execute: () =>
      sql`
        SELECT
          thread_id AS "threadId",
          substr(created_at, 1, 10) AS "date",
          COUNT(*) AS "count"
        FROM projection_thread_activities
        WHERE kind = 'tool.completed'
        GROUP BY thread_id, substr(created_at, 1, 10)
      `,
  });

  const listTurnRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: TurnRow,
    execute: () =>
      sql`
        SELECT
          thread_id AS "threadId",
          started_at AS "startedAt",
          completed_at AS "completedAt",
          checkpoint_turn_count AS "checkpointTurnCount",
          checkpoint_files_json AS "filesJson"
        FROM projection_turns
      `,
  });

  const listWorktreeRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: WorktreeRow,
    execute: () =>
      sql`
        SELECT
          created_at AS "createdAt",
          archived_at AS "archivedAt",
          pr_number AS "prNumber"
        FROM projection_worktrees
      `,
  });

  const getStatistics: StatisticsQueryShape["getStatistics"] = () =>
    Effect.gen(function* () {
      const [threadRows, projectRows, tokenRows, toolRows, turnRows, worktreeRows] =
        yield* Effect.all(
          [
            listThreadRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "StatisticsQuery.getStatistics:listThreads:query",
                  "StatisticsQuery.getStatistics:listThreads:decodeRows",
                ),
              ),
            ),
            listProjectRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "StatisticsQuery.getStatistics:listProjects:query",
                  "StatisticsQuery.getStatistics:listProjects:decodeRows",
                ),
              ),
            ),
            listTokenActivityRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "StatisticsQuery.getStatistics:listTokenActivities:query",
                  "StatisticsQuery.getStatistics:listTokenActivities:decodeRows",
                ),
              ),
            ),
            listToolUseRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "StatisticsQuery.getStatistics:listToolUses:query",
                  "StatisticsQuery.getStatistics:listToolUses:decodeRows",
                ),
              ),
            ),
            listTurnRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "StatisticsQuery.getStatistics:listTurns:query",
                  "StatisticsQuery.getStatistics:listTurns:decodeRows",
                ),
              ),
            ),
            listWorktreeRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "StatisticsQuery.getStatistics:listWorktrees:query",
                  "StatisticsQuery.getStatistics:listWorktrees:decodeRows",
                ),
              ),
            ),
          ],
          { concurrency: "unbounded" },
        );

      // ── Thread metadata + model→provider mapping ──────────────────────────
      const threadMeta = new Map<
        string,
        { projectId: ProjectId; model: string; provider: string | undefined; createdAt: string }
      >();
      const modelProvider = new Map<string, string | undefined>();
      for (const row of threadRows) {
        // Coalesce blanks to safe display values: empty/whitespace strings would
        // fail success-encoding downstream and crash the RPC.
        const provider = row.providerName?.trim() || undefined;
        const model = (row.model ?? "").trim() || "unknown";
        threadMeta.set(row.threadId, {
          projectId: row.projectId,
          model,
          provider,
          createdAt: row.createdAt,
        });
        if (!modelProvider.has(model) || (modelProvider.get(model) === undefined && provider)) {
          modelProvider.set(model, provider);
        }
      }

      const buckets = new Map<string, MutableBucket>();
      const getBucket = (date: string, projectId: ProjectId, model: string): MutableBucket => {
        const key = `${date} ${projectId} ${model}`;
        let bucket = buckets.get(key);
        if (!bucket) {
          bucket = {
            date,
            projectId,
            model,
            provider: modelProvider.get(model),
            inputTokens: 0,
            outputTokens: 0,
            cachedInputTokens: 0,
            reasoningTokens: 0,
            turns: 0,
            activeMs: 0,
            toolUses: 0,
            filesChanged: 0,
            additions: 0,
            deletions: 0,
            commits: 0,
            pushes: 0,
            threadsCreated: 0,
          };
          buckets.set(key, bucket);
        }
        return bucket;
      };

      let earliest: string | undefined;
      const considerIso = (iso: string | null | undefined) => {
        if (iso && (earliest === undefined || iso < earliest)) {
          earliest = iso;
        }
      };

      // ── Tokens: pick the final activity per (thread,turn) and per thread ───
      // Within a turn, rows iterate in (sequence, created_at) order so the last
      // write is the turn's final snapshot. Across turns we must NOT rely on
      // iteration order (turn_id is opaque/non-chronological), so the per-thread
      // pick uses an explicit latest-by-(createdAt, sequence) comparison.
      const lastPerTurn = new Map<string, (typeof tokenRows)[number]>();
      const lastPerThread = new Map<string, (typeof tokenRows)[number]>();
      const isLater = (a: (typeof tokenRows)[number], b: (typeof tokenRows)[number]): boolean => {
        if (a.createdAt !== b.createdAt) {
          return a.createdAt > b.createdAt;
        }
        return (a.sequence ?? -1) >= (b.sequence ?? -1);
      };
      for (const row of tokenRows) {
        considerIso(row.createdAt);
        lastPerTurn.set(`${row.threadId} ${row.turnId ?? ""}`, row);
        const prevThread = lastPerThread.get(row.threadId);
        if (!prevThread || isLater(row, prevThread)) {
          lastPerThread.set(row.threadId, row);
        }
      }

      let perTurnDeltaSum = 0;
      for (const row of lastPerTurn.values()) {
        const payload = safeParse(row.payloadJson);
        perTurnDeltaSum +=
          num(payload?.lastInputTokens) +
          num(payload?.lastOutputTokens) +
          num(payload?.lastCachedInputTokens) +
          num(payload?.lastReasoningOutputTokens);
      }
      let cumulativeSum = 0;
      for (const row of lastPerThread.values()) {
        const payload = safeParse(row.payloadJson);
        cumulativeSum += num(payload?.inputTokens) + num(payload?.outputTokens);
      }

      const attribution: StatisticsTokenAttribution =
        perTurnDeltaSum === 0 && cumulativeSum > 0 ? "thread-cumulative" : "per-turn-delta";

      if (attribution === "per-turn-delta") {
        for (const row of lastPerTurn.values()) {
          const meta = threadMeta.get(row.threadId);
          const date = dayOf(row.createdAt);
          if (!meta || !date) continue;
          const payload = safeParse(row.payloadJson);
          const bucket = getBucket(date, meta.projectId, meta.model);
          bucket.inputTokens += num(payload?.lastInputTokens);
          bucket.outputTokens += num(payload?.lastOutputTokens);
          bucket.cachedInputTokens += num(payload?.lastCachedInputTokens);
          bucket.reasoningTokens += num(payload?.lastReasoningOutputTokens);
        }
      } else {
        for (const row of lastPerThread.values()) {
          const meta = threadMeta.get(row.threadId);
          const date = dayOf(row.createdAt);
          if (!meta || !date) continue;
          const payload = safeParse(row.payloadJson);
          const bucket = getBucket(date, meta.projectId, meta.model);
          bucket.inputTokens += num(payload?.inputTokens);
          bucket.outputTokens += num(payload?.outputTokens);
          bucket.cachedInputTokens += num(payload?.cachedInputTokens);
          bucket.reasoningTokens += num(payload?.reasoningOutputTokens);
        }
      }

      // ── Turns: counts, active time, and file/line changes ─────────────────
      for (const row of turnRows) {
        const meta = threadMeta.get(row.threadId);
        if (!meta) continue;
        considerIso(row.startedAt);
        considerIso(row.completedAt);
        const anchor = row.completedAt ?? row.startedAt;
        const date = anchor ? dayOf(anchor) : null;
        if (!date) continue;
        const bucket = getBucket(date, meta.projectId, meta.model);
        if (row.completedAt) {
          bucket.turns += 1;
          if (row.startedAt) {
            const delta = Date.parse(row.completedAt) - Date.parse(row.startedAt);
            if (Number.isFinite(delta) && delta > 0) {
              bucket.activeMs += delta;
            }
          }
        }
        const files = safeParseArray(row.filesJson);
        if (files.length > 0) {
          bucket.filesChanged += files.length;
          for (const file of files) {
            bucket.additions += num((file as Record<string, unknown> | null)?.additions);
            bucket.deletions += num((file as Record<string, unknown> | null)?.deletions);
          }
        }
      }

      // ── Tool uses (completed tool calls) ──────────────────────────────────
      for (const row of toolRows) {
        const meta = threadMeta.get(row.threadId);
        if (!meta) continue;
        const bucket = getBucket(row.date, meta.projectId, meta.model);
        bucket.toolUses += num(row.count);
      }

      // ── Threads created ───────────────────────────────────────────────────
      for (const meta of threadMeta.values()) {
        considerIso(meta.createdAt);
        const date = dayOf(meta.createdAt);
        if (!date) continue;
        getBucket(date, meta.projectId, meta.model).threadsCreated += 1;
      }

      // ── Worktree summary ──────────────────────────────────────────────────
      let wtCreated = 0;
      let wtArchived = 0;
      let wtOpenPrs = 0;
      for (const row of worktreeRows) {
        considerIso(row.createdAt);
        wtCreated += 1;
        if (row.archivedAt) {
          wtArchived += 1;
        } else if (row.prNumber !== null) {
          wtOpenPrs += 1;
        }
      }

      // ── Assemble output ───────────────────────────────────────────────────
      const dailyBuckets: Array<StatisticsDailyBucket> = [];
      const totals = {
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
        turns: 0,
        activeMs: 0,
        toolUses: 0,
        filesChanged: 0,
        additions: 0,
        deletions: 0,
        commits: 0,
        pushes: 0,
        threads: threadMeta.size,
        projects: 0,
      };
      for (const bucket of buckets.values()) {
        const { provider, ...rest } = bucket;
        dailyBuckets.push(provider ? { ...rest, provider } : rest);
        totals.inputTokens += bucket.inputTokens;
        totals.outputTokens += bucket.outputTokens;
        totals.cachedInputTokens += bucket.cachedInputTokens;
        totals.reasoningTokens += bucket.reasoningTokens;
        totals.turns += bucket.turns;
        totals.activeMs += bucket.activeMs;
        totals.toolUses += bucket.toolUses;
        totals.filesChanged += bucket.filesChanged;
        totals.additions += bucket.additions;
        totals.deletions += bucket.deletions;
        totals.commits += bucket.commits;
        totals.pushes += bucket.pushes;
      }
      totals.totalTokens = totals.inputTokens + totals.outputTokens;

      const projectTitle = new Map<ProjectId, string>();
      for (const row of projectRows) {
        projectTitle.set(row.projectId, row.title);
      }
      const projectIdsInData = new Set<ProjectId>();
      for (const meta of threadMeta.values()) {
        projectIdsInData.add(meta.projectId);
      }
      for (const bucket of buckets.values()) {
        projectIdsInData.add(bucket.projectId);
      }
      totals.projects = projectIdsInData.size;

      const projects: Array<StatisticsProjectRef> = [...projectIdsInData].map((id) => ({
        id,
        title: projectTitle.get(id)?.trim() || id,
      }));
      const models: Array<StatisticsModelRef> = [...modelProvider].map(([model, provider]) =>
        provider ? { model, provider } : { model },
      );

      const snapshot: StatisticsSnapshot = {
        generatedAt: new Date().toISOString(),
        ...(earliest ? { earliestActivityAt: earliest } : {}),
        projects,
        models,
        dailyBuckets,
        worktrees: {
          created: wtCreated,
          archived: wtArchived,
          active: wtCreated - wtArchived,
          openPrs: wtOpenPrs,
        },
        totals,
        tokenAttribution: attribution,
      };
      return snapshot;
    });

  return { getStatistics } satisfies StatisticsQueryShape;
});

function safeParse(json: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function safeParseArray(json: string): ReadonlyArray<unknown> {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export const StatisticsQueryLive = Layer.effect(StatisticsQuery, makeStatisticsQuery);
