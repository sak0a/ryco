import {
  SourceControlProviderError,
  WS_METHODS,
  type PullRequestInboxSnapshot,
} from "@ryco/contracts";
import { DateTime, Duration, Effect, Option, Stream } from "effect";

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

export const makePullRequestHandlers = (ctx: WsRpcContext) => {
  const projection = Option.getOrNull(ctx.projectionPullRequests);

  const requireProjection = <A, E>(
    operation: string,
    run: (repo: NonNullable<typeof projection>) => Effect.Effect<A, E>,
  ) =>
    projection === null
      ? Effect.fail(pullRequestError(operation, "The pull request inbox is unavailable."))
      : run(projection).pipe(Effect.mapError(mapPersistenceError(operation)));

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
  });
};
