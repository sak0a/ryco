import {
  PullRequestAiRunId,
  SourceControlProviderError,
  WS_METHODS,
  type PullRequestAiAnalysis,
  type PullRequestAiRun,
  type PullRequestAiRunProgress,
  type PullRequestInboxItem,
  type PullRequestInboxSnapshot,
  type SourceControlChangeRequestDetail,
} from "@ryco/contracts";
import {
  buildPullRequestAiAnalysis,
  deterministicPullRequestPriorityPoints,
  isPullRequestAiAnalysisCurrent,
  pullRequestAiSourceFingerprint,
  sortPullRequestsByAiPriority,
} from "@ryco/shared/pullRequestIntelligence";
import { DateTime, Duration, Effect, Fiber, Option, Random, Result, Stream } from "effect";

import { observeRpcEffect, observeRpcStreamEffect } from "../observability/RpcInstrumentation.ts";
import { refreshPullRequestInbox } from "../sourceControl/PullRequestInboxSynchronizer.ts";
import { defineWsHandlers, type WsRpcContext } from "./context.ts";

function pullRequestError(operation: string, detail: string) {
  return new SourceControlProviderError({ provider: "unknown", operation, detail });
}

const mapPersistenceError = (operation: string) => (error: unknown) =>
  pullRequestError(
    operation,
    error instanceof Error ? error.message : "The pull request inbox could not be read.",
  );

const PULL_REQUEST_AI_PROMPT_VERSION = 1;
const PULL_REQUEST_AI_SCHEMA_VERSION = 1;
const PULL_REQUEST_AI_MAX_VIEW = 25;

function pullRequestAnalysisFailureDetail(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const normalized = raw.replaceAll(/\s+/gu, " ").trim();
  return normalized.length > 600 ? `${normalized.slice(0, 597)}...` : normalized;
}

function providerUpdatedAt(item: PullRequestInboxItem): string | null {
  return Option.match(item.pullRequest.freshness.providerUpdatedAt, {
    onNone: () => null,
    onSome: DateTime.formatIso,
  });
}

function shallowAnalysisContext(item: PullRequestInboxItem): string {
  const pullRequest = item.pullRequest;
  return JSON.stringify({
    identity: {
      id: pullRequest.identity.id,
      repository: pullRequest.repository.displayName,
      number: pullRequest.identity.number,
      provider: pullRequest.identity.provider,
    },
    title: pullRequest.title,
    state: pullRequest.state,
    draft: pullRequest.isDraft,
    author: pullRequest.author,
    assignees: pullRequest.assignees,
    branches: { base: pullRequest.baseRefName, head: pullRequest.headRefName },
    labels: pullRequest.labels,
    review: pullRequest.review,
    checks: pullRequest.checks,
    viewer: pullRequest.viewer,
    unread: item.viewState.isUnread,
    providerUpdatedAt: providerUpdatedAt(item),
    relatedRycoWork: item.associations
      .filter((association) => Option.isNone(association.endedAt))
      .map((association) => ({
        subject: association.subject,
        relationship: association.relationship,
      })),
  });
}

function deepAnalysisContext(
  item: PullRequestInboxItem,
  detail: SourceControlChangeRequestDetail,
  diff: string,
): string {
  return JSON.stringify({
    summary: JSON.parse(shallowAnalysisContext(item)),
    description: detail.body,
    mergeability: detail.mergeability,
    changedFiles: detail.changedFiles,
    additions: detail.additions,
    deletions: detail.deletions,
    commits: detail.commits?.slice(0, 80),
    files: detail.files?.slice(0, 120),
    comments: detail.comments.slice(-20).map((comment) => ({
      author: comment.author,
      body: comment.body,
      createdAt: DateTime.formatIso(comment.createdAt),
      reviewState: comment.reviewState,
    })),
    truncatedByProvider: detail.truncated,
    boundedDiff: diff.slice(0, 80_000),
    diffTruncated: diff.length > 80_000,
  });
}

function sameModel(
  analysis: PullRequestAiAnalysis,
  modelSelection: PullRequestAiAnalysis["modelSelection"],
): boolean {
  return (
    analysis.modelSelection.instanceId === modelSelection.instanceId &&
    analysis.modelSelection.model === modelSelection.model &&
    JSON.stringify(analysis.modelSelection.options ?? []) ===
      JSON.stringify(modelSelection.options ?? [])
  );
}

function sameProviderRevision(
  analysis: PullRequestAiAnalysis,
  item: PullRequestInboxItem,
): boolean {
  return (
    Option.match(analysis.sourceProviderUpdatedAt, {
      onNone: () => null,
      onSome: DateTime.formatIso,
    }) === providerUpdatedAt(item)
  );
}

function emptyProgress(planned: number, deepPlanned = 0): PullRequestAiRunProgress {
  return { planned, ranked: 0, deepPlanned, deepCompleted: 0, cached: 0, failed: 0 };
}

export const makePullRequestHandlers = (ctx: WsRpcContext) => {
  const projection = Option.getOrNull(ctx.projectionPullRequests);
  const aiCache = Option.getOrNull(ctx.pullRequestAiCache);

  const requireProjection = <A, E>(
    operation: string,
    run: (repo: NonNullable<typeof projection>) => Effect.Effect<A, E>,
  ) =>
    projection === null
      ? Effect.fail(pullRequestError(operation, "The pull request inbox is unavailable."))
      : run(projection).pipe(Effect.mapError(mapPersistenceError(operation)));

  const requireAiCache = <A, E>(
    operation: string,
    run: (cache: NonNullable<typeof aiCache>) => Effect.Effect<A, E>,
  ) =>
    aiCache === null
      ? Effect.fail(pullRequestError(operation, "Pull request AI analysis is unavailable."))
      : run(aiCache).pipe(Effect.mapError(mapPersistenceError(operation)));

  const listSnapshot = () =>
    requireProjection("listInbox", (repo) =>
      repo.listInbox(ctx.pullRequestViewerKey).pipe(
        Effect.map(
          (snapshot): PullRequestInboxSnapshot => ({
            ...snapshot,
            coverage: [...ctx.pullRequestCoverageByRepository.values()],
          }),
        ),
      ),
    );

  const refresh = () =>
    requireProjection("refresh", (repo) =>
      Effect.flatMap(ctx.serverEnvironment.getEnvironmentId, (environmentId) =>
        refreshPullRequestInbox({
          environmentId,
          projection: repo,
          snapshots: ctx.projectionSnapshotQuery,
          sourceControl: ctx.sourceControlRegistry,
          coverageByRepository: ctx.pullRequestCoverageByRepository,
          viewerKey: ctx.pullRequestViewerKey,
          dispatchCommand: ctx.dispatchNormalizedCommand,
          serverCommandId: ctx.serverCommandId,
        }),
      ),
    );

  const dispatchPullRequestCommand = (
    command: Extract<
      Parameters<typeof ctx.dispatchNormalizedCommand>[0],
      { type: `pull-request.${string}` }
    >,
  ) =>
    ctx.dispatchNormalizedCommand(command).pipe(
      Effect.mapError((error) => pullRequestError(command.type, error.message)),
      Effect.asVoid,
    );

  const listAiSnapshot = () =>
    requireAiCache("listAi", (cache) =>
      Effect.flatMap(ctx.serverEnvironment.getEnvironmentId, (environmentId) =>
        cache.listSnapshot({ environmentId, viewerKey: ctx.pullRequestViewerKey }),
      ),
    );

  const startAiAnalysis = (input: {
    readonly pullRequestIds: ReadonlyArray<PullRequestInboxItem["pullRequest"]["identity"]["id"]>;
    readonly modelSelection: PullRequestAiAnalysis["modelSelection"];
    readonly scope: "view" | "single" | "scheduled";
    readonly resourceMode: "economical" | "balanced" | "thorough";
    readonly maxDeepAnalyses?: number | undefined;
    readonly force?: boolean | undefined;
  }) =>
    requireProjection("analyze", (repo) =>
      requireAiCache("analyze", (cache) =>
        Effect.gen(function* () {
          if (input.pullRequestIds.length === 0) {
            return yield* pullRequestError("analyze", "Select at least one pull request.");
          }
          if (input.pullRequestIds.length > PULL_REQUEST_AI_MAX_VIEW) {
            return yield* pullRequestError(
              "analyze",
              `A manual run can analyze at most ${PULL_REQUEST_AI_MAX_VIEW} pull requests.`,
            );
          }
          const environmentId = yield* ctx.serverEnvironment.getEnvironmentId;
          const existingSnapshot = yield* cache.listSnapshot({
            environmentId,
            viewerKey: ctx.pullRequestViewerKey,
          });
          if (Option.isSome(existingSnapshot.currentRun)) {
            return yield* pullRequestError(
              "analyze",
              "A pull request analysis run is already active.",
            );
          }
          const inbox = yield* repo.listInbox(ctx.pullRequestViewerKey);
          const itemById = new Map(
            inbox.items.map((item) => [item.pullRequest.identity.id, item] as const),
          );
          const items = input.pullRequestIds.map((pullRequestId) => itemById.get(pullRequestId));
          if (items.some((item) => item === undefined)) {
            return yield* pullRequestError(
              "analyze",
              "One or more pull requests are not available in this environment.",
            );
          }
          const selectedItems = items as ReadonlyArray<PullRequestInboxItem>;
          const startedAt = yield* DateTime.now;
          const runId = PullRequestAiRunId.make(yield* Random.nextUUIDv4);
          let runState: PullRequestAiRun = {
            id: runId,
            environmentId,
            viewerKey: ctx.pullRequestViewerKey,
            scope: input.scope,
            pullRequestIds: input.pullRequestIds,
            modelSelection: input.modelSelection,
            resourceMode: input.resourceMode,
            status: "planned",
            progress: emptyProgress(selectedItems.length),
            startedAt,
            completedAt: Option.none(),
          };
          yield* cache.upsertRun(runState);

          const concurrency =
            input.resourceMode === "economical" ? 1 : input.resourceMode === "thorough" ? 3 : 2;
          const maxDeep = Math.min(
            selectedItems.length,
            Math.max(0, input.maxDeepAnalyses ?? (input.scope === "single" ? 1 : 8)),
          );

          const persistRun = (next: PullRequestAiRun) => {
            runState = next;
            return cache.upsertRun(next);
          };

          const analyzeItem = (item: PullRequestInboxItem, depth: "shallow" | "deep") =>
            Effect.gen(function* () {
              const current = yield* cache.getCurrentAnalysis({
                pullRequestId: item.pullRequest.identity.id,
                viewerKey: ctx.pullRequestViewerKey,
              });
              if (
                input.force !== true &&
                Option.isSome(current) &&
                sameModel(current.value, input.modelSelection) &&
                sameProviderRevision(current.value, item) &&
                current.value.deterministicPriorityPoints ===
                  deterministicPullRequestPriorityPoints(item) &&
                !current.value.isStale &&
                DateTime.toEpochMillis(current.value.expiresAt) > Date.now() &&
                (depth === "shallow" || current.value.depth === "deep")
              ) {
                return { analysis: current.value, cached: true } as const;
              }

              const accessTargets = yield* repo.listAccessTargets(item.pullRequest.identity.id);
              const target = accessTargets[0];
              if (!target) {
                return yield* pullRequestError(
                  "analyze",
                  `No verified access target exists for ${item.pullRequest.repository.displayName} #${item.pullRequest.identity.number}.`,
                );
              }

              let context = shallowAnalysisContext(item);
              let mergeability: SourceControlChangeRequestDetail["mergeability"] = "unknown";
              if (depth === "deep") {
                const handle = yield* ctx.sourceControlRegistry.resolveHandle({ cwd: target.cwd });
                const providerInput = {
                  cwd: target.cwd,
                  ...(handle.context ? { context: handle.context } : {}),
                  reference: String(item.pullRequest.identity.number),
                };
                const detail = yield* handle.provider.getChangeRequestDetail({
                  ...providerInput,
                  fullContent: true,
                });
                const diff = yield* handle.provider
                  .getChangeRequestDiff(providerInput)
                  .pipe(Effect.catch(() => Effect.succeed("")));
                context = deepAnalysisContext(item, detail, diff);
                mergeability = detail.mergeability ?? "unknown";
              }

              const sourceFingerprint = pullRequestAiSourceFingerprint({
                depth,
                context,
              });
              if (
                input.force !== true &&
                Option.isSome(current) &&
                current.value.depth === depth &&
                sameModel(current.value, input.modelSelection) &&
                isPullRequestAiAnalysisCurrent({
                  analysis: current.value,
                  sourceFingerprint,
                })
              ) {
                return { analysis: current.value, cached: true } as const;
              }

              const assessment = yield* ctx.textGeneration.generatePullRequestAnalysis({
                cwd: target.cwd,
                pullRequestId: item.pullRequest.identity.id,
                depth,
                context,
                modelSelection: input.modelSelection,
              });
              if (
                assessment.pullRequestId !== item.pullRequest.identity.id ||
                assessment.depth !== depth
              ) {
                return yield* pullRequestError(
                  "analyze",
                  "The selected model returned analysis for a different pull request or depth.",
                );
              }
              const analyzedAt = yield* DateTime.now;
              const analysis = buildPullRequestAiAnalysis({
                item,
                viewerKey: ctx.pullRequestViewerKey,
                modelSelection: input.modelSelection,
                assessment,
                mergeability,
                promptVersion: PULL_REQUEST_AI_PROMPT_VERSION,
                schemaVersion: PULL_REQUEST_AI_SCHEMA_VERSION,
                sourceFingerprint,
                analyzedAt,
                expiresAt: DateTime.add(analyzedAt, { hours: 24 }),
              });
              yield* cache.upsertAnalysis(analysis);
              return { analysis, cached: false } as const;
            });

          const execute = Effect.gen(function* () {
            yield* persistRun({ ...runState, status: "ranking" });
            const shallowSuccesses: Array<{
              readonly analysis: PullRequestAiAnalysis;
              readonly cached: boolean;
            }> = [];
            let shallowFailures = 0;
            let cached = 0;
            let firstFailureDetail: string | null = null;
            for (let offset = 0; offset < selectedItems.length; offset += concurrency) {
              const batch = selectedItems.slice(offset, offset + concurrency);
              const batchResults = yield* Effect.forEach(
                batch,
                (item) => Effect.result(analyzeItem(item, "shallow")),
                { concurrency },
              );
              for (const result of batchResults) {
                if (Result.isSuccess(result)) {
                  shallowSuccesses.push(result.success);
                  if (result.success.cached) cached += 1;
                } else {
                  shallowFailures += 1;
                  firstFailureDetail ??= pullRequestAnalysisFailureDetail(result.failure);
                }
              }
              yield* persistRun({
                ...runState,
                progress: {
                  ...runState.progress,
                  ranked: shallowSuccesses.length,
                  cached,
                  failed: shallowFailures,
                },
              });
            }
            const analysisById = Object.fromEntries(
              shallowSuccesses.map((result) => [result.analysis.pullRequestId, result.analysis]),
            );
            const deepItems = sortPullRequestsByAiPriority(selectedItems, analysisById).slice(
              0,
              maxDeep,
            );
            yield* persistRun({
              ...runState,
              status: "deep-analysis",
              progress: {
                planned: selectedItems.length,
                ranked: shallowSuccesses.length,
                deepPlanned: deepItems.length,
                deepCompleted: 0,
                cached,
                failed: shallowFailures,
              },
            });
            let deepSuccesses = 0;
            let deepFailures = 0;
            for (let offset = 0; offset < deepItems.length; offset += concurrency) {
              const batch = deepItems.slice(offset, offset + concurrency);
              const batchResults = yield* Effect.forEach(
                batch,
                (item) => Effect.result(analyzeItem(item, "deep")),
                { concurrency },
              );
              deepSuccesses += batchResults.filter(Result.isSuccess).length;
              for (const result of batchResults) {
                if (Result.isFailure(result)) {
                  deepFailures += 1;
                  firstFailureDetail ??= pullRequestAnalysisFailureDetail(result.failure);
                }
              }
              yield* persistRun({
                ...runState,
                progress: {
                  ...runState.progress,
                  deepCompleted: deepSuccesses,
                  failed: shallowFailures + deepFailures,
                },
              });
            }
            const completedAt = yield* DateTime.now;
            const failed = shallowFailures + deepFailures;
            yield* persistRun({
              ...runState,
              status: failed > 0 ? "partially-completed" : "completed",
              progress: {
                ...runState.progress,
                deepCompleted: deepSuccesses,
                failed,
              },
              completedAt: Option.some(completedAt),
              ...(failed > 0
                ? {
                    error: `${failed} pull request analysis step${failed === 1 ? "" : "s"} failed.${firstFailureDetail ? ` First failure: ${firstFailureDetail}` : ""}`,
                  }
                : {}),
            });
          }).pipe(
            Effect.onInterrupt(() =>
              DateTime.now.pipe(
                Effect.flatMap((completedAt) =>
                  persistRun({
                    ...runState,
                    status: "cancelled",
                    completedAt: Option.some(completedAt),
                  }),
                ),
                Effect.ignore,
              ),
            ),
            Effect.catch((error) =>
              DateTime.now.pipe(
                Effect.flatMap((completedAt) =>
                  persistRun({
                    ...runState,
                    status: "failed",
                    completedAt: Option.some(completedAt),
                    error: error instanceof Error ? error.message : "Pull request analysis failed.",
                  }),
                ),
                Effect.ignore,
              ),
            ),
            Effect.ensuring(
              Effect.sync(() => {
                ctx.pullRequestAiRunFibers.delete(runId);
              }),
            ),
          );
          const fiber = yield* Effect.forkDetach(execute);
          ctx.pullRequestAiRunFibers.set(runId, fiber);
          return runState;
        }),
      ),
    );

  return defineWsHandlers({
    [WS_METHODS.pullRequestsListInbox]: () =>
      observeRpcEffect(
        WS_METHODS.pullRequestsListInbox,
        ctx.ownerEffect(WS_METHODS.pullRequestsListInbox, listSnapshot()),
        { "rpc.aggregate": "pull-requests" },
      ),
    [WS_METHODS.pullRequestsSubscribeInbox]: () =>
      observeRpcStreamEffect(
        WS_METHODS.pullRequestsSubscribeInbox,
        ctx.ownerStreamEffect(
          WS_METHODS.pullRequestsSubscribeInbox,
          requireProjection("subscribeInbox", (repo) => {
            const persistedSnapshot = Stream.fromEffect(listSnapshot());
            const projectedChanges = repo.streamChanges.pipe(
              Stream.debounce(Duration.millis(40)),
              Stream.mapEffect(listSnapshot),
            );
            return Effect.succeed(Stream.merge(persistedSnapshot, projectedChanges));
          }),
        ),
        { "rpc.aggregate": "pull-requests" },
      ),
    [WS_METHODS.pullRequestsRefresh]: () =>
      observeRpcEffect(
        WS_METHODS.pullRequestsRefresh,
        ctx.ownerEffect(WS_METHODS.pullRequestsRefresh, refresh()),
        { "rpc.aggregate": "pull-requests" },
      ),
    [WS_METHODS.pullRequestsGetDetail]: ({ pullRequestId }) =>
      observeRpcEffect(
        WS_METHODS.pullRequestsGetDetail,
        ctx.ownerEffect(
          WS_METHODS.pullRequestsGetDetail,
          requireProjection("getDetail", (repo) =>
            Effect.gen(function* () {
              const record = yield* repo.getById(pullRequestId);
              if (Option.isNone(record)) {
                return yield* pullRequestError("getDetail", "Pull request not found.");
              }
              const accessTargets = yield* repo.listAccessTargets(pullRequestId);
              const target = accessTargets[0];
              if (!target) {
                return yield* pullRequestError(
                  "getDetail",
                  "No verified repository access target remains.",
                );
              }
              const handle = yield* ctx.sourceControlRegistry.resolveHandle({ cwd: target.cwd });
              const detail = yield* handle.provider.getChangeRequestDetail({
                cwd: target.cwd,
                ...(handle.context ? { context: handle.context } : {}),
                reference: String(record.value.identity.number),
                fullContent: true,
              });
              const detailHost = yield* Effect.try({
                try: () => new URL(detail.url).host.toLowerCase(),
                catch: () =>
                  pullRequestError("getDetail", "Provider returned a malformed pull request URL."),
              });
              if (
                detail.number !== record.value.identity.number ||
                detailHost !== record.value.identity.host
              ) {
                return yield* pullRequestError(
                  "getDetail",
                  "Provider detail did not match the canonical pull request.",
                );
              }
              const now = yield* DateTime.now;
              yield* dispatchPullRequestCommand({
                type: "pull-request.viewed",
                commandId: ctx.serverCommandId("pull-request-viewed"),
                pullRequestId,
                viewerKey: ctx.pullRequestViewerKey,
                viewedAt: now,
                occurredAt: DateTime.formatIso(now),
              });
              const snapshot = yield* repo.listInbox(ctx.pullRequestViewerKey);
              const item = snapshot.items.find(
                (candidate) => candidate.pullRequest.identity.id === pullRequestId,
              );
              if (!item) {
                return yield* pullRequestError("getDetail", "Pull request not found.");
              }
              return { item, accessTargets, detail };
            }),
          ),
        ),
        { "rpc.aggregate": "pull-requests" },
      ),
    [WS_METHODS.pullRequestsMarkViewed]: ({ pullRequestId }) =>
      ctx.ownerEffect(
        WS_METHODS.pullRequestsMarkViewed,
        requireProjection("markViewed", (_repo) =>
          DateTime.now.pipe(
            Effect.flatMap((viewedAt) =>
              dispatchPullRequestCommand({
                type: "pull-request.viewed",
                commandId: ctx.serverCommandId("pull-request-viewed"),
                pullRequestId,
                viewerKey: ctx.pullRequestViewerKey,
                viewedAt,
                occurredAt: DateTime.formatIso(viewedAt),
              }),
            ),
          ),
        ),
      ),
    [WS_METHODS.pullRequestsMarkUnread]: ({ pullRequestId }) =>
      ctx.ownerEffect(
        WS_METHODS.pullRequestsMarkUnread,
        requireProjection("markUnread", (_repo) =>
          DateTime.now.pipe(
            Effect.flatMap((markedAt) =>
              dispatchPullRequestCommand({
                type: "pull-request.mark-unread",
                commandId: ctx.serverCommandId("pull-request-mark-unread"),
                pullRequestId,
                viewerKey: ctx.pullRequestViewerKey,
                markedAt,
                occurredAt: DateTime.formatIso(markedAt),
              }),
            ),
          ),
        ),
      ),
    [WS_METHODS.pullRequestsAttachRelationship]: ({ pullRequestId, subject, relationship }) =>
      ctx.ownerEffect(
        WS_METHODS.pullRequestsAttachRelationship,
        requireProjection("attachRelationship", (_repo) =>
          DateTime.now.pipe(
            Effect.flatMap((createdAt) =>
              dispatchPullRequestCommand({
                type: "pull-request.association.record",
                commandId: ctx.serverCommandId("pull-request-association-record"),
                pullRequestId,
                association: {
                  pullRequestId,
                  subject,
                  relationship,
                  evidence: "user-attachment",
                  createdAt,
                  endedAt: Option.none(),
                },
                occurredAt: DateTime.formatIso(createdAt),
              }),
            ),
            Effect.andThen(listSnapshot()),
          ),
        ),
      ),
    [WS_METHODS.pullRequestsRemoveExplicitRelationship]: ({
      pullRequestId,
      subject,
      relationship,
    }) =>
      ctx.ownerEffect(
        WS_METHODS.pullRequestsRemoveExplicitRelationship,
        requireProjection("removeExplicitRelationship", (_repo) =>
          DateTime.now.pipe(
            Effect.flatMap((endedAt) =>
              dispatchPullRequestCommand({
                type: "pull-request.association.end",
                commandId: ctx.serverCommandId("pull-request-association-end"),
                pullRequestId,
                subject,
                relationship,
                endedAt,
                occurredAt: DateTime.formatIso(endedAt),
              }),
            ),
            Effect.andThen(listSnapshot()),
          ),
        ),
      ),
    [WS_METHODS.pullRequestsListAi]: () =>
      observeRpcEffect(
        WS_METHODS.pullRequestsListAi,
        ctx.ownerEffect(WS_METHODS.pullRequestsListAi, listAiSnapshot()),
        { "rpc.aggregate": "pull-request-ai" },
      ),
    [WS_METHODS.pullRequestsSubscribeAi]: () =>
      observeRpcStreamEffect(
        WS_METHODS.pullRequestsSubscribeAi,
        ctx.ownerStreamEffect(
          WS_METHODS.pullRequestsSubscribeAi,
          requireAiCache("subscribeAi", (cache) => {
            const initial = Stream.fromEffect(listAiSnapshot());
            const changes = cache.streamChanges.pipe(
              Stream.debounce(Duration.millis(40)),
              Stream.mapEffect(listAiSnapshot),
            );
            return Effect.succeed(Stream.merge(initial, changes));
          }),
        ),
        { "rpc.aggregate": "pull-request-ai" },
      ),
    [WS_METHODS.pullRequestsAnalyze]: (input) =>
      observeRpcEffect(
        WS_METHODS.pullRequestsAnalyze,
        ctx.ownerEffect(WS_METHODS.pullRequestsAnalyze, startAiAnalysis(input)),
        { "rpc.aggregate": "pull-request-ai" },
      ),
    [WS_METHODS.pullRequestsCancelAiRun]: ({ runId }) =>
      observeRpcEffect(
        WS_METHODS.pullRequestsCancelAiRun,
        ctx.ownerEffect(
          WS_METHODS.pullRequestsCancelAiRun,
          Effect.gen(function* () {
            const fiber = ctx.pullRequestAiRunFibers.get(runId);
            if (!fiber) {
              return yield* pullRequestError(
                "cancelAiRun",
                "The analysis run is no longer active in this session.",
              );
            }
            yield* Fiber.interrupt(fiber);
          }),
        ),
        { "rpc.aggregate": "pull-request-ai" },
      ),
  });
};
