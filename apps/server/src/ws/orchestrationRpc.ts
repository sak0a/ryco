import { Effect, Option, Schema, Stream } from "effect";
import { clamp } from "effect/Number";
import {
  AuthRpcError,
  CommandId,
  OrchestrationDispatchCommandError,
  OrchestrationGetFullThreadDiffError,
  OrchestrationGetSnapshotError,
  OrchestrationGetTaskOutputError,
  OrchestrationGetTurnDiffError,
  OrchestrationGetWorkflowScriptError,
  OrchestrationReplayEventsError,
  OrchestrationStopBackgroundTaskError,
  ORCHESTRATION_WS_METHODS,
  WS_METHODS,
  type ThreadId,
} from "@ryco/contracts";

import { normalizeDispatchCommand } from "../orchestration/Normalizer.ts";
import {
  readTaskOutput,
  taskOutputRootsFromSettings,
} from "../orchestration/taskOutputQuery.ts";
import {
  readWorkflowScript,
  workflowScriptRootsFromSettings,
} from "../orchestration/workflowScriptQuery.ts";
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
    serverSettings,
    providerService,
    terminalManager,
    checkpointDiffQuery,
    orchestrationEngine,
    enrichOrchestrationEvents,
    makeReplayableShellStream,
    makeReplayableThreadStream,
    recordThreadSnapshotDurationMs,
  } = ctx;

  /**
   * The file paths a thread's persisted task activities actually reference
   * (workflow `runHandles.scriptPath` and task `outputFile`). Script and
   * task-output reads are authorized against this set, binding each read to
   * the requested thread — global root containment alone would let any
   * caller read any script or output under the Claude projects roots by
   * guessing absolute paths. Failures resolve to empty sets: fail closed.
   *
   * getTaskOutput polls while a task runs, so the narrow payload-only
   * projection is preferred; the full thread detail is only a fallback for
   * query implementations that don't provide it.
   */
  const referencedTaskPaths = (
    threadId: ThreadId,
  ): Effect.Effect<{
    readonly scriptPaths: ReadonlySet<string>;
    readonly outputPaths: ReadonlySet<string>;
  }> => {
    const narrow = projectionSnapshotQuery.listThreadTaskPathRefs;
    const refs = narrow
      ? narrow(threadId).pipe(
          Effect.map((result) => ({
            scriptPaths: new Set(result.scriptPaths),
            outputPaths: new Set(result.outputPaths),
          })),
        )
      : projectionSnapshotQuery.getThreadDetailById(threadId).pipe(
          Effect.map(
            Option.match({
              onNone: () => ({ scriptPaths: new Set<string>(), outputPaths: new Set<string>() }),
              onSome: (thread) => {
                const scriptPaths = new Set<string>();
                const outputPaths = new Set<string>();
                for (const activity of thread.activities) {
                  const payload = activity.payload;
                  if (payload === null || typeof payload !== "object") {
                    continue;
                  }
                  const record = payload as Record<string, unknown>;
                  const runHandles = record.runHandles;
                  if (runHandles !== null && typeof runHandles === "object") {
                    const scriptPath = (runHandles as { scriptPath?: unknown }).scriptPath;
                    if (typeof scriptPath === "string") {
                      scriptPaths.add(scriptPath);
                    }
                  }
                  if (typeof record.outputFile === "string") {
                    outputPaths.add(record.outputFile);
                  }
                }
                return { scriptPaths, outputPaths };
              },
            }),
          ),
        );
    return refs.pipe(
      Effect.tapError((cause) =>
        Effect.logWarning("thread lookup for task-path authorization failed", {
          threadId,
          cause,
        }),
      ),
      Effect.catch(() =>
        Effect.succeed({ scriptPaths: new Set<string>(), outputPaths: new Set<string>() }),
      ),
    );
  };

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
    [ORCHESTRATION_WS_METHODS.getWorkflowScript]: (input) =>
      observeRpcEffect(
        ORCHESTRATION_WS_METHODS.getWorkflowScript,
        // ownerEffect enforces the "operator" tier from RPC_ACCESS_POLICY —
        // the policy table alone is advisory; per-handler guards are the
        // only server-side enforcement in this codebase.
        ownerEffect(
          ORCHESTRATION_WS_METHODS.getWorkflowScript,
          Effect.gen(function* () {
          // Thread binding first: the requested thread's persisted
          // activities must reference this exact script path. "not-found"
          // deliberately does not distinguish unknown threads, unreferenced
          // paths, and missing files (anti-probing).
          const referenced = yield* referencedTaskPaths(input.threadId);
          if (!referenced.scriptPaths.has(input.scriptPath)) {
            return yield* new OrchestrationGetWorkflowScriptError({
              reason: "not-found",
              scriptPath: input.scriptPath,
            });
          }
          // Settings only widen the containment roots; a settings failure
          // must not block reads under the default home root.
          const settings = yield* serverSettings.getSettings.pipe(
            Effect.catch(() => Effect.succeed(undefined)),
          );
          return yield* readWorkflowScript({
            scriptPath: input.scriptPath,
            roots: workflowScriptRootsFromSettings(settings),
          });
          }),
        ),
        { "rpc.aggregate": "orchestration" },
      ),
    [ORCHESTRATION_WS_METHODS.getTaskOutput]: (input) =>
      observeRpcEffect(
        ORCHESTRATION_WS_METHODS.getTaskOutput,
        ownerEffect(
          ORCHESTRATION_WS_METHODS.getTaskOutput,
          Effect.gen(function* () {
          // Same thread binding as getWorkflowScript, against the task
          // `outputFile` handles the thread's activities reference.
          const referenced = yield* referencedTaskPaths(input.threadId);
          if (!referenced.outputPaths.has(input.outputPath)) {
            return yield* new OrchestrationGetTaskOutputError({
              reason: "not-found",
              outputPath: input.outputPath,
            });
          }
          const settings = yield* serverSettings.getSettings.pipe(
            Effect.catch(() => Effect.succeed(undefined)),
          );
          return yield* readTaskOutput({
            outputPath: input.outputPath,
            offset: input.offset,
            roots: taskOutputRootsFromSettings(settings),
          });
          }),
        ),
        { "rpc.aggregate": "orchestration" },
      ),
    [ORCHESTRATION_WS_METHODS.stopBackgroundTask]: (input) =>
      observeRpcEffect(
        ORCHESTRATION_WS_METHODS.stopBackgroundTask,
        ownerEffect(
          ORCHESTRATION_WS_METHODS.stopBackgroundTask,
          Option.match(providerService, {
          onNone: () =>
            // No ProviderService in the environment is a wiring gap, not a
            // client mistake — log loudly and fail closed.
            Effect.logError("stopBackgroundTask has no ProviderService in context").pipe(
              Effect.andThen(
                Effect.fail(
                  new OrchestrationStopBackgroundTaskError({
                    reason: "stop-failed",
                    threadId: input.threadId,
                    taskId: input.taskId,
                  }),
                ),
              ),
            ),
          onSome: (service) =>
            service.stopBackgroundTask({ threadId: input.threadId, taskId: input.taskId }).pipe(
              Effect.tapError((cause) =>
                Effect.logWarning("stopBackgroundTask failed", {
                  threadId: input.threadId,
                  taskId: input.taskId,
                  cause,
                }),
              ),
              // The raw provider cause stays in server logs; the wire error
              // carries only the classified reason.
              Effect.mapError(
                (cause) =>
                  new OrchestrationStopBackgroundTaskError({
                    reason:
                      cause._tag === "ProviderUnsupportedError"
                        ? "unsupported"
                        : cause._tag === "ProviderSessionNotFoundError" ||
                            cause._tag === "ProviderAdapterSessionNotFoundError" ||
                            cause._tag === "ProviderAdapterSessionClosedError"
                          ? "session-not-found"
                          : "stop-failed",
                    threadId: input.threadId,
                    taskId: input.taskId,
                  }),
              ),
            ),
          }).pipe(Effect.as({})),
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
