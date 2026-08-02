import { Effect, Option, Schema, Stream } from "effect";
import { clamp } from "effect/Number";
import {
  AuthRpcError,
  CommandId,
  OrchestrationDispatchCommandError,
  OrchestrationGetFullThreadDiffError,
  OrchestrationGetSnapshotError,
  OrchestrationGetTurnDiffError,
  OrchestrationReplayEventsError,
  ORCHESTRATION_WS_METHODS,
  WS_METHODS,
} from "@ryco/contracts";

import { normalizeDispatchCommand } from "../orchestration/Normalizer.ts";
import { observeRpcEffect, observeRpcStreamEffect } from "../observability/RpcInstrumentation.ts";
import {
  isServerPerfProfileEnabled,
  recordServerPerfPayload,
} from "../observability/PerfInstrumentation.ts";
import { defineWsHandlers, type WsRpcContext } from "./context.ts";
import {
  ORCHESTRATION_LEGACY_REPLAY_MAX_EVENTS,
  ORCHESTRATION_REPLAY_PAGE_MAX_LIMIT,
} from "./context/constants.ts";

export const makeOrchestrationHandlers = (ctx: WsRpcContext) => {
  const {
    ownerEffect,
    projectionSnapshotQuery,
    dispatchNormalizedCommand,
    dispatchWorktreeCommand,
    serverCommandId,
    terminalManager,
    checkpointDiffQuery,
    orchestrationEngine,
    enrichOrchestrationEvents,
    makeReplayableShellStream,
    makeReplayableThreadStream,
    recordThreadSnapshotDurationMs,
  } = ctx;

  return defineWsHandlers({
    [ORCHESTRATION_WS_METHODS.dispatchCommand]: (command) =>
      observeRpcEffect(
        ORCHESTRATION_WS_METHODS.dispatchCommand,
        ownerEffect(
          ORCHESTRATION_WS_METHODS.dispatchCommand,
          Effect.gen(function* () {
            const normalizedCommand = yield* normalizeDispatchCommand(command);
            const shouldStopSessionAfterArchive =
              normalizedCommand.type === "thread.archive"
                ? yield* projectionSnapshotQuery
                    .getThreadShellById(normalizedCommand.threadId)
                    .pipe(
                      Effect.map(
                        Option.match({
                          onNone: () => false,
                          onSome: (thread) =>
                            thread.session !== null && thread.session.status !== "stopped",
                        }),
                      ),
                      Effect.catch(() => Effect.succeed(false)),
                    )
                : false;
            const result = yield* dispatchNormalizedCommand(normalizedCommand);
            if (normalizedCommand.type === "thread.archive") {
              if (shouldStopSessionAfterArchive) {
                yield* Effect.gen(function* () {
                  const stopCommand = yield* normalizeDispatchCommand({
                    type: "thread.session.stop",
                    commandId: CommandId.make(
                      `session-stop-for-archive:${normalizedCommand.commandId}`,
                    ),
                    threadId: normalizedCommand.threadId,
                    createdAt: new Date().toISOString(),
                  });

                  yield* dispatchNormalizedCommand(stopCommand);
                }).pipe(
                  Effect.catchCause((cause) =>
                    Effect.logWarning("failed to stop provider session during archive", {
                      threadId: normalizedCommand.threadId,
                      cause,
                    }),
                  ),
                );
              }

              yield* terminalManager.close({ threadId: normalizedCommand.threadId }).pipe(
                Effect.catch((error) =>
                  Effect.logWarning("failed to close thread terminals after archive", {
                    threadId: normalizedCommand.threadId,
                    error: error.message,
                  }),
                ),
              );
            }
            return result;
          }).pipe(
            Effect.mapError((cause) =>
              Schema.is(OrchestrationDispatchCommandError)(cause)
                ? cause
                : new OrchestrationDispatchCommandError({
                    message: "Failed to dispatch orchestration command",
                    cause,
                  }),
            ),
          ),
        ),
        { "rpc.aggregate": "orchestration" },
      ),
    [ORCHESTRATION_WS_METHODS.getTurnDiff]: (input) =>
      observeRpcEffect(
        ORCHESTRATION_WS_METHODS.getTurnDiff,
        checkpointDiffQuery.getTurnDiff(input).pipe(
          Effect.mapError(
            (cause) =>
              new OrchestrationGetTurnDiffError({
                message: "Failed to load turn diff",
                cause,
              }),
          ),
        ),
        { "rpc.aggregate": "orchestration" },
      ),
    [ORCHESTRATION_WS_METHODS.getFullThreadDiff]: (input) =>
      observeRpcEffect(
        ORCHESTRATION_WS_METHODS.getFullThreadDiff,
        checkpointDiffQuery.getFullThreadDiff(input).pipe(
          Effect.mapError(
            (cause) =>
              new OrchestrationGetFullThreadDiffError({
                message: "Failed to load full thread diff",
                cause,
              }),
          ),
        ),
        { "rpc.aggregate": "orchestration" },
      ),
    [ORCHESTRATION_WS_METHODS.searchThreadMessages]: (input) =>
      observeRpcEffect(
        ORCHESTRATION_WS_METHODS.searchThreadMessages,
        projectionSnapshotQuery
          .searchThreadMessages({
            ...input,
            limit: clamp(input.limit, {
              maximum: 50,
              minimum: 1,
            }),
          })
          .pipe(
            Effect.mapError(
              (cause) =>
                new OrchestrationGetSnapshotError({
                  message: "Failed to search thread messages",
                  cause,
                }),
            ),
          ),
        { "rpc.aggregate": "orchestration" },
      ),
    [ORCHESTRATION_WS_METHODS.replayEvents]: (input) =>
      observeRpcEffect(
        ORCHESTRATION_WS_METHODS.replayEvents,
        Stream.runCollect(
          orchestrationEngine.readEvents(
            clamp(input.fromSequenceExclusive, {
              maximum: Number.MAX_SAFE_INTEGER,
              minimum: 0,
            }),
            ORCHESTRATION_LEGACY_REPLAY_MAX_EVENTS,
          ),
        ).pipe(
          Effect.map((events) => Array.from(events)),
          Effect.flatMap(enrichOrchestrationEvents),
          Effect.mapError(
            (cause) =>
              new OrchestrationReplayEventsError({
                message: "Failed to replay orchestration events",
                cause,
              }),
          ),
        ),
        { "rpc.aggregate": "orchestration" },
      ),
    [ORCHESTRATION_WS_METHODS.replayEventsPage]: (input) =>
      observeRpcEffect(
        ORCHESTRATION_WS_METHODS.replayEventsPage,
        orchestrationEngine
          .readEventsPage(
            clamp(input.fromSequenceExclusive, {
              maximum: Number.MAX_SAFE_INTEGER,
              minimum: 0,
            }),
            clamp(input.limit, {
              maximum: ORCHESTRATION_REPLAY_PAGE_MAX_LIMIT,
              minimum: 1,
            }),
          )
          .pipe(
            Effect.flatMap((page) =>
              enrichOrchestrationEvents(page.events).pipe(
                Effect.map((events) => ({
                  events,
                  nextSequence: page.nextSequence,
                  hasMore: page.hasMore,
                })),
              ),
            ),
            Effect.mapError(
              (cause) =>
                new OrchestrationReplayEventsError({
                  message: "Failed to replay orchestration events page",
                  cause,
                }),
            ),
          ),
        { "rpc.aggregate": "orchestration" },
      ),
    [ORCHESTRATION_WS_METHODS.subscribeShell]: (_input) =>
      observeRpcStreamEffect(
        ORCHESTRATION_WS_METHODS.subscribeShell,
        Effect.succeed(
          makeReplayableShellStream(
            projectionSnapshotQuery.getShellSnapshot().pipe(
              Effect.tapError((cause) =>
                Effect.logError("orchestration shell snapshot load failed", { cause }),
              ),
              Effect.mapError(
                (cause) =>
                  new OrchestrationGetSnapshotError({
                    message: "Failed to load orchestration shell snapshot",
                    cause,
                  }),
              ),
            ),
          ).pipe(
            Stream.tap((item) =>
              Effect.sync(() =>
                recordServerPerfPayload("server.ws.orchestration.subscribeShell", item),
              ),
            ),
          ),
        ),
        { "rpc.aggregate": "orchestration" },
      ),
    [ORCHESTRATION_WS_METHODS.subscribeThread]: (input) =>
      observeRpcStreamEffect(
        ORCHESTRATION_WS_METHODS.subscribeThread,
        Effect.succeed(
          makeReplayableThreadStream(
            Effect.gen(function* () {
              const perfEnabled = isServerPerfProfileEnabled();
              const startedAtMs = performance.now();
              const [threadDetail, snapshotSequence] = yield* Effect.all([
                projectionSnapshotQuery.getThreadDetailById(input.threadId).pipe(
                  Effect.mapError(
                    (cause) =>
                      new OrchestrationGetSnapshotError({
                        message: `Failed to load thread ${input.threadId}`,
                        cause,
                      }),
                  ),
                ),
                projectionSnapshotQuery.getSnapshotSequence().pipe(
                  Effect.map(({ snapshotSequence }) => snapshotSequence),
                  Effect.mapError(
                    (cause) =>
                      new OrchestrationGetSnapshotError({
                        message: "Failed to load orchestration snapshot sequence",
                        cause,
                      }),
                  ),
                ),
              ]);

              if (Option.isNone(threadDetail)) {
                return yield* new OrchestrationGetSnapshotError({
                  message: `Thread ${input.threadId} was not found`,
                  cause: input.threadId,
                });
              }

              const snapshot = {
                snapshotSequence,
                thread: threadDetail.value,
              };
              const snapshotDurationMs = Math.max(0, performance.now() - startedAtMs);
              yield* recordThreadSnapshotDurationMs(snapshotDurationMs);
              if (perfEnabled) {
                yield* Effect.sync(() =>
                  recordServerPerfPayload(
                    "server.ws.orchestration.subscribeThread.snapshot",
                    snapshot,
                    { durationMs: snapshotDurationMs },
                  ),
                );
              }
              return snapshot;
            }),
            input.threadId,
          ).pipe(
            Stream.tap((item) =>
              Effect.sync(() =>
                recordServerPerfPayload("server.ws.orchestration.subscribeThread", item),
              ),
            ),
          ),
        ),
        { "rpc.aggregate": "orchestration" },
      ),
    [WS_METHODS.threadsSetManualBucket]: (input) =>
      observeRpcEffect(
        WS_METHODS.threadsSetManualBucket,
        ownerEffect(
          WS_METHODS.threadsSetManualBucket,
          dispatchWorktreeCommand(
            {
              type: "thread.status-bucket.override",
              commandId: serverCommandId("thread-status-bucket-override"),
              threadId: input.threadId,
              bucket: input.bucket,
              changedAt: new Date().toISOString(),
            },
            "threads.setManualBucket",
          ).pipe(Effect.as({})),
        ),
        { "rpc.aggregate": "orchestration" },
      ),
    [WS_METHODS.threadsSetManualPosition]: (input) =>
      observeRpcEffect(
        WS_METHODS.threadsSetManualPosition,
        ownerEffect(
          WS_METHODS.threadsSetManualPosition,
          dispatchWorktreeCommand(
            {
              type: "thread.manual-position.set",
              commandId: serverCommandId("thread-manual-position-set"),
              threadId: input.threadId,
              position: input.position,
              changedAt: new Date().toISOString(),
            },
            "threads.setManualPosition",
          ).pipe(Effect.as({})),
        ),
        { "rpc.aggregate": "orchestration" },
      ),
    [WS_METHODS.searchThreadMessages]: (input) =>
      observeRpcEffect(
        WS_METHODS.searchThreadMessages,
        ownerEffect(
          WS_METHODS.searchThreadMessages,
          Effect.gen(function* () {
            const query = input.query.trim();
            if (query.length === 0) {
              return { results: [] };
            }
            const results = yield* projectionSnapshotQuery.searchThreadMessages({
              query,
              ...(input.projectId ? { projectId: input.projectId } : {}),
              limit: clamp(input.limit ?? 20, {
                maximum: 50,
                minimum: 1,
              }),
            });
            return { results };
          }).pipe(
            Effect.mapError(
              () =>
                new AuthRpcError({
                  message: "Failed to search thread messages.",
                  status: 403,
                }),
            ),
          ),
        ),
        { "rpc.aggregate": "orchestration" },
      ),
  });
};
