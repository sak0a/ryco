import {
  CommandId,
  DEFAULT_MODEL,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  type ModelSelection,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@ryco/contracts";
import {
  Data,
  Deferred,
  Effect,
  Exit,
  Layer,
  Option,
  Path,
  Queue,
  Ref,
  Scope,
  Context,
  Console,
  Duration,
  Clock,
  Metric,
} from "effect";

import { ServerConfig } from "./config.ts";
import { Keybindings } from "./keybindings.ts";
import { Open } from "./open.ts";
import { OrchestrationEngineService } from "./orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "./orchestration/Services/ProjectionSnapshotQuery.ts";
import { OrchestrationReactor } from "./orchestration/Services/OrchestrationReactor.ts";
import { ServerLifecycleEvents } from "./serverLifecycleEvents.ts";
import { ServerSettingsService } from "./serverSettings.ts";
import { ServerEnvironment } from "./environment/Services/ServerEnvironment.ts";
import { AnalyticsService } from "./telemetry/Services/AnalyticsService.ts";
import { ServerAuth } from "./auth/Services/ServerAuth.ts";
import { ProviderSessionReaper } from "./provider/Services/ProviderSessionReaper.ts";
import {
  increment,
  metricAttributes,
  startupCommandGateEnqueuesTotal,
  startupCommandGateQueueDepth,
  startupCommandGateQueueHighWater,
  startupCommandGateQueueWaitDuration,
} from "./observability/Metrics.ts";
import {
  formatHeadlessServeOutput,
  formatHostForUrl,
  isWildcardHost,
  issueHeadlessServeAccessInfo,
} from "./startupAccess.ts";

export const DEFAULT_STARTUP_COMMAND_GATE_MAX_PENDING = 2_048;
export const DEFAULT_STARTUP_COMMAND_GATE_READY_TIMEOUT_MS = 30_000;

export type ServerRuntimeStartupErrorReason = "startup" | "busy" | "timeout";

export class ServerRuntimeStartupError extends Data.TaggedError("ServerRuntimeStartupError")<{
  readonly message: string;
  readonly reason?: ServerRuntimeStartupErrorReason;
  readonly cause?: unknown;
}> {}

export interface ServerRuntimeStartupShape {
  readonly awaitCommandReady: Effect.Effect<void, ServerRuntimeStartupError>;
  readonly markHttpListening: Effect.Effect<void>;
  readonly enqueueCommand: <A, E>(
    effect: Effect.Effect<A, E>,
  ) => Effect.Effect<A, E | ServerRuntimeStartupError>;
}

export class ServerRuntimeStartup extends Context.Service<
  ServerRuntimeStartup,
  ServerRuntimeStartupShape
>()("ryco/serverRuntimeStartup") {}

interface QueuedCommand {
  readonly run: Effect.Effect<void, never>;
}

type CommandReadinessState = "pending" | "ready" | ServerRuntimeStartupError;

export interface CommandGateOptions {
  readonly maxPendingCommands?: number;
  readonly readyTimeoutMs?: number;
}

interface CommandGate {
  readonly awaitCommandReady: Effect.Effect<void, ServerRuntimeStartupError>;
  readonly signalCommandReady: Effect.Effect<void>;
  readonly failCommandReady: (error: ServerRuntimeStartupError) => Effect.Effect<void>;
  readonly enqueueCommand: <A, E>(
    effect: Effect.Effect<A, E>,
  ) => Effect.Effect<A, E | ServerRuntimeStartupError>;
}

const settleQueuedCommand = <A, E>(deferred: Deferred.Deferred<A, E>, exit: Exit.Exit<A, E>) =>
  Exit.isSuccess(exit)
    ? Deferred.succeed(deferred, exit.value)
    : Deferred.failCause(deferred, exit.cause);

const normalizePositiveInt = (value: number | undefined, fallback: number): number =>
  value === undefined || !Number.isFinite(value) ? fallback : Math.max(1, Math.floor(value));

const recordStartupCommandGateDepth = (input: {
  readonly depth: number;
  readonly highWater: number;
  readonly maxPendingCommands: number;
}) =>
  Effect.gen(function* () {
    const attributes = metricAttributes({
      maxPendingCommands: input.maxPendingCommands,
    });
    yield* Metric.update(
      Metric.withAttributes(startupCommandGateQueueDepth, attributes),
      input.depth,
    );
    yield* Metric.update(
      Metric.withAttributes(startupCommandGateQueueHighWater, attributes),
      input.highWater,
    );
  });

const recordStartupCommandGateWait = (input: {
  readonly queuedAtMs: number;
  readonly outcome: string;
  readonly maxPendingCommands: number;
}) =>
  Effect.gen(function* () {
    const nowMs = yield* Clock.currentTimeMillis;
    yield* Metric.update(
      Metric.withAttributes(
        startupCommandGateQueueWaitDuration,
        metricAttributes({
          outcome: input.outcome,
          maxPendingCommands: input.maxPendingCommands,
        }),
      ),
      Duration.millis(Math.max(0, nowMs - input.queuedAtMs)),
    );
  });

export const makeCommandGate = (options: CommandGateOptions = {}) =>
  Effect.gen(function* () {
    const maxPendingCommands = normalizePositiveInt(
      options.maxPendingCommands,
      DEFAULT_STARTUP_COMMAND_GATE_MAX_PENDING,
    );
    const readyTimeoutMs = normalizePositiveInt(
      options.readyTimeoutMs,
      DEFAULT_STARTUP_COMMAND_GATE_READY_TIMEOUT_MS,
    );
    const commandReady = yield* Deferred.make<void, ServerRuntimeStartupError>();
    const commandQueue = yield* Queue.unbounded<QueuedCommand>();
    const commandReadinessState = yield* Ref.make<CommandReadinessState>("pending");
    const pendingCommandCount = yield* Ref.make(0);
    const pendingCommandHighWater = yield* Ref.make(0);

    const commandWorker = Effect.forever(
      Queue.take(commandQueue).pipe(Effect.flatMap((command) => command.run)),
    );
    yield* Effect.forkScoped(commandWorker);

    return {
      awaitCommandReady: Deferred.await(commandReady),
      signalCommandReady: Effect.gen(function* () {
        yield* Ref.set(commandReadinessState, "ready");
        yield* Deferred.succeed(commandReady, undefined).pipe(Effect.orDie);
      }),
      failCommandReady: (error) =>
        Effect.gen(function* () {
          yield* Ref.set(commandReadinessState, error);
          yield* Deferred.fail(commandReady, error).pipe(Effect.orDie);
        }),
      enqueueCommand: <A, E>(effect: Effect.Effect<A, E>) =>
        Effect.gen(function* () {
          const readinessState = yield* Ref.get(commandReadinessState);
          if (readinessState === "ready") {
            return yield* effect;
          }
          if (readinessState !== "pending") {
            return yield* readinessState;
          }

          const reservation = yield* Ref.modify(pendingCommandCount, (count) => {
            if (count >= maxPendingCommands) {
              return [Option.none<number>(), count] as const;
            }
            const nextCount = count + 1;
            return [Option.some(nextCount), nextCount] as const;
          });
          if (Option.isNone(reservation)) {
            yield* increment(startupCommandGateEnqueuesTotal, {
              outcome: "busy",
              maxPendingCommands,
            });
            return yield* new ServerRuntimeStartupError({
              reason: "busy",
              message: `Server startup command gate is busy (${maxPendingCommands} pending commands).`,
            });
          }

          const highWater = yield* Ref.updateAndGet(pendingCommandHighWater, (current) =>
            Math.max(current, reservation.value),
          );
          yield* increment(startupCommandGateEnqueuesTotal, {
            outcome: "queued",
            maxPendingCommands,
          });
          yield* recordStartupCommandGateDepth({
            depth: reservation.value,
            highWater,
            maxPendingCommands,
          });

          const result = yield* Deferred.make<A, E | ServerRuntimeStartupError>();
          const queuedAtMs = yield* Clock.currentTimeMillis;
          const releaseReservation = Effect.gen(function* () {
            const depth = yield* Ref.updateAndGet(pendingCommandCount, (count) =>
              Math.max(0, count - 1),
            );
            const currentHighWater = yield* Ref.get(pendingCommandHighWater);
            yield* recordStartupCommandGateDepth({
              depth,
              highWater: currentHighWater,
              maxPendingCommands,
            });
          });
          yield* Queue.offer(commandQueue, {
            run: Effect.gen(function* () {
              const latestReadinessState = yield* Ref.get(commandReadinessState);
              if (latestReadinessState === "ready") {
                const exit = yield* effect.pipe(Effect.exit);
                yield* increment(startupCommandGateEnqueuesTotal, {
                  outcome: Exit.isSuccess(exit) ? "drained_success" : "drained_failure",
                  maxPendingCommands,
                });
                yield* recordStartupCommandGateWait({
                  queuedAtMs,
                  outcome: Exit.isSuccess(exit) ? "success" : "failure",
                  maxPendingCommands,
                });
                yield* settleQueuedCommand(result, exit);
                return;
              }
              if (latestReadinessState !== "pending") {
                yield* increment(startupCommandGateEnqueuesTotal, {
                  outcome: "readiness_failure",
                  maxPendingCommands,
                });
                yield* recordStartupCommandGateWait({
                  queuedAtMs,
                  outcome: "readiness_failure",
                  maxPendingCommands,
                });
                yield* Deferred.fail(result, latestReadinessState).pipe(Effect.orDie);
                return;
              }

              const nowMs = yield* Clock.currentTimeMillis;
              const elapsedMs = Math.max(0, nowMs - queuedAtMs);
              const remainingReadyTimeoutMs = Math.max(0, readyTimeoutMs - elapsedMs);
              const readyExit = yield* Deferred.await(commandReady).pipe(
                Effect.timeoutOption(Duration.millis(remainingReadyTimeoutMs)),
                Effect.exit,
              );
              if (Exit.isFailure(readyExit)) {
                yield* increment(startupCommandGateEnqueuesTotal, {
                  outcome: "readiness_failure",
                  maxPendingCommands,
                });
                yield* recordStartupCommandGateWait({
                  queuedAtMs,
                  outcome: "readiness_failure",
                  maxPendingCommands,
                });
                yield* Deferred.failCause(result, readyExit.cause).pipe(Effect.orDie);
                return;
              }
              const ready = readyExit.value;
              if (Option.isNone(ready)) {
                const error = new ServerRuntimeStartupError({
                  reason: "timeout",
                  message: `Server startup command gate timed out after ${readyTimeoutMs}ms waiting for command readiness.`,
                });
                yield* increment(startupCommandGateEnqueuesTotal, {
                  outcome: "timeout",
                  maxPendingCommands,
                });
                yield* recordStartupCommandGateWait({
                  queuedAtMs,
                  outcome: "timeout",
                  maxPendingCommands,
                });
                yield* Deferred.fail(result, error).pipe(Effect.orDie);
                return;
              }

              const exit = yield* effect.pipe(Effect.exit);
              yield* increment(startupCommandGateEnqueuesTotal, {
                outcome: Exit.isSuccess(exit) ? "drained_success" : "drained_failure",
                maxPendingCommands,
              });
              yield* recordStartupCommandGateWait({
                queuedAtMs,
                outcome: Exit.isSuccess(exit) ? "success" : "failure",
                maxPendingCommands,
              });
              yield* settleQueuedCommand(result, exit);
            }).pipe(Effect.ensuring(releaseReservation)),
          });
          return yield* Deferred.await(result);
        }),
    } satisfies CommandGate;
  });

export const recordStartupHeartbeat = Effect.gen(function* () {
  const analytics = yield* AnalyticsService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;

  const { threadCount, projectCount } = yield* projectionSnapshotQuery.getCounts().pipe(
    Effect.catch((cause) =>
      Effect.logWarning("failed to gather startup projection counts for telemetry", {
        cause,
      }).pipe(
        Effect.as({
          threadCount: 0,
          projectCount: 0,
        }),
      ),
    ),
  );

  yield* analytics.record("server.boot.heartbeat", {
    threadCount,
    projectCount,
  });
});

export const launchStartupHeartbeat = recordStartupHeartbeat.pipe(
  Effect.annotateSpans({ "startup.phase": "heartbeat.record" }),
  Effect.withSpan("server.startup.heartbeat.record"),
  Effect.ignoreCause({ log: true }),
  Effect.forkScoped,
  Effect.asVoid,
);

export const getAutoBootstrapDefaultModelSelection = (): ModelSelection => ({
  instanceId: ProviderInstanceId.make("codex"),
  model: DEFAULT_MODEL,
});

export const resolveWelcomeBase = Effect.gen(function* () {
  const serverConfig = yield* ServerConfig;
  const segments = serverConfig.cwd.split(/[/\\]/).filter(Boolean);
  const projectName = segments[segments.length - 1] ?? "project";

  return {
    cwd: serverConfig.cwd,
    projectName,
  } as const;
});

export const resolveAutoBootstrapWelcomeTargets = Effect.gen(function* () {
  const serverConfig = yield* ServerConfig;
  const projectionReadModelQuery = yield* ProjectionSnapshotQuery;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const path = yield* Path.Path;

  let bootstrapProjectId: ProjectId | undefined;
  let bootstrapThreadId: ThreadId | undefined;

  if (serverConfig.autoBootstrapProjectFromCwd) {
    yield* Effect.gen(function* () {
      const existingProject = yield* projectionReadModelQuery.getActiveProjectByWorkspaceRoot(
        serverConfig.cwd,
      );
      let nextProjectId: ProjectId;
      let nextProjectDefaultModelSelection: ModelSelection;

      if (Option.isNone(existingProject)) {
        const createdAt = new Date().toISOString();
        nextProjectId = ProjectId.make(crypto.randomUUID());
        const bootstrapProjectTitle = path.basename(serverConfig.cwd) || "project";
        nextProjectDefaultModelSelection = getAutoBootstrapDefaultModelSelection();
        yield* orchestrationEngine.dispatch({
          type: "project.create",
          commandId: CommandId.make(crypto.randomUUID()),
          projectId: nextProjectId,
          title: bootstrapProjectTitle,
          workspaceRoot: serverConfig.cwd,
          defaultModelSelection: nextProjectDefaultModelSelection,
          createdAt,
        });
      } else {
        nextProjectId = existingProject.value.id;
        nextProjectDefaultModelSelection =
          existingProject.value.defaultModelSelection ?? getAutoBootstrapDefaultModelSelection();
      }

      const existingThreadId =
        yield* projectionReadModelQuery.getFirstActiveThreadIdByProjectId(nextProjectId);
      if (Option.isNone(existingThreadId)) {
        const createdAt = new Date().toISOString();
        const createdThreadId = ThreadId.make(crypto.randomUUID());
        yield* orchestrationEngine.dispatch({
          type: "thread.create",
          commandId: CommandId.make(crypto.randomUUID()),
          threadId: createdThreadId,
          projectId: nextProjectId,
          title: "New thread",
          modelSelection: nextProjectDefaultModelSelection,
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt,
        });
        bootstrapProjectId = nextProjectId;
        bootstrapThreadId = createdThreadId;
      } else {
        bootstrapProjectId = nextProjectId;
        bootstrapThreadId = existingThreadId.value;
      }
    });
  }

  return {
    ...(bootstrapProjectId ? { bootstrapProjectId } : {}),
    ...(bootstrapThreadId ? { bootstrapThreadId } : {}),
  } as const;
});

const resolveStartupBrowserTarget = Effect.gen(function* () {
  const serverConfig = yield* ServerConfig;
  const serverAuth = yield* ServerAuth;
  const localUrl = `http://localhost:${serverConfig.port}`;
  const bindUrl =
    serverConfig.host && !isWildcardHost(serverConfig.host)
      ? `http://${formatHostForUrl(serverConfig.host)}:${serverConfig.port}`
      : localUrl;
  const baseTarget = serverConfig.devUrl?.toString() ?? bindUrl;
  return yield* Effect.succeed(serverConfig.mode === "desktop" ? baseTarget : undefined).pipe(
    Effect.flatMap((target) =>
      target ? Effect.succeed(target) : serverAuth.issueStartupPairingUrl(baseTarget),
    ),
  );
});

const maybeOpenBrowser = (target: string) =>
  Effect.gen(function* () {
    const serverConfig = yield* ServerConfig;
    if (serverConfig.noBrowser) {
      return;
    }
    const { openBrowser } = yield* Open;

    yield* openBrowser(target).pipe(
      Effect.catch(() =>
        Effect.logInfo("browser auto-open unavailable", {
          hint: `Open ${target} in your browser.`,
        }),
      ),
    );
  });

const runStartupPhase = <A, E, R>(phase: string, effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.annotateSpans({ "startup.phase": phase }),
    Effect.withSpan(`server.startup.${phase}`),
  );

export const makeServerRuntimeStartup = Effect.gen(function* () {
  const runtimeStartedAt = Date.now();
  const serverConfig = yield* ServerConfig;
  const keybindings = yield* Keybindings;
  const orchestrationReactor = yield* OrchestrationReactor;
  const providerSessionReaper = yield* ProviderSessionReaper;
  const lifecycleEvents = yield* ServerLifecycleEvents;
  const serverSettings = yield* ServerSettingsService;
  const serverEnvironment = yield* ServerEnvironment;

  const commandGate = yield* makeCommandGate();
  const httpListening = yield* Deferred.make<void>();
  const reactorScope = yield* Scope.make("sequential");

  yield* Effect.addFinalizer(() => Scope.close(reactorScope, Exit.void));

  const startup = Effect.gen(function* () {
    yield* Effect.logDebug("startup phase: starting keybindings runtime");
    yield* runStartupPhase(
      "keybindings.start",
      keybindings.start.pipe(
        Effect.catch((error) =>
          Effect.logWarning("failed to start keybindings runtime", {
            path: error.configPath,
            detail: error.detail,
            cause: error.cause,
          }),
        ),
        Effect.forkScoped,
      ),
    );

    yield* Effect.logDebug("startup phase: starting server settings runtime");
    yield* runStartupPhase(
      "settings.start",
      serverSettings.start.pipe(
        Effect.catch((error) =>
          Effect.logWarning("failed to start server settings runtime", {
            path: error.settingsPath,
            detail: error.detail,
            cause: error.cause,
          }),
        ),
        Effect.forkScoped,
      ),
    );

    yield* Effect.logDebug("startup phase: starting orchestration reactors");
    yield* runStartupPhase(
      "reactors.start",
      Effect.all(
        [
          orchestrationReactor.start().pipe(Scope.provide(reactorScope)),
          providerSessionReaper.start().pipe(Scope.provide(reactorScope)),
        ],
        { concurrency: "unbounded", discard: true },
      ),
    );

    const welcomeBase = yield* resolveWelcomeBase;
    const environment = yield* serverEnvironment.getDescriptor;
    yield* Effect.logDebug("startup phase: preparing welcome payload");
    yield* Effect.logDebug("startup phase: publishing welcome event", {
      environmentId: environment.environmentId,
      cwd: welcomeBase.cwd,
      projectName: welcomeBase.projectName,
    });
    yield* runStartupPhase(
      "welcome.publish",
      lifecycleEvents.publish({
        version: 1,
        type: "welcome",
        payload: {
          environment,
          ...welcomeBase,
        },
      }),
    );

    if (serverConfig.autoBootstrapProjectFromCwd) {
      yield* Effect.forkScoped(
        runStartupPhase(
          "welcome.autobootstrap",
          Effect.gen(function* () {
            const bootstrapTargets = yield* resolveAutoBootstrapWelcomeTargets;
            if (!bootstrapTargets.bootstrapProjectId && !bootstrapTargets.bootstrapThreadId) {
              return;
            }

            yield* Effect.logDebug("startup phase: publishing bootstrapped welcome event", {
              environmentId: environment.environmentId,
              cwd: welcomeBase.cwd,
              projectName: welcomeBase.projectName,
              bootstrapProjectId: bootstrapTargets.bootstrapProjectId,
              bootstrapThreadId: bootstrapTargets.bootstrapThreadId,
            });
            yield* lifecycleEvents.publish({
              version: 1,
              type: "welcome",
              payload: {
                environment,
                ...welcomeBase,
                ...bootstrapTargets,
              },
            });
          }).pipe(
            Effect.catch((cause) =>
              Effect.logWarning("startup auto-bootstrap welcome failed", {
                cause,
              }),
            ),
          ),
        ),
      );
    }
  }).pipe(
    Effect.annotateSpans({
      "server.mode": serverConfig.mode,
      "server.port": serverConfig.port,
      "server.host": serverConfig.host ?? "default",
    }),
    Effect.withSpan("server.startup", { kind: "server", root: true }),
  );

  yield* Effect.forkScoped(
    Effect.gen(function* () {
      const startupExit = yield* Effect.exit(startup);
      if (Exit.isFailure(startupExit)) {
        const error = new ServerRuntimeStartupError({
          message: "Server runtime startup failed before command readiness.",
          cause: startupExit.cause,
        });
        yield* Effect.logError("server runtime startup failed", { cause: startupExit.cause });
        yield* commandGate.failCommandReady(error);
        return;
      }

      yield* Effect.logInfo("startup command gate ready", {
        durationMs: Date.now() - runtimeStartedAt,
      });
      yield* commandGate.signalCommandReady;
      yield* Effect.logDebug("startup phase: waiting for http listener");
      yield* runStartupPhase("http.wait", Deferred.await(httpListening));
      yield* Effect.logInfo("startup http listener ready", {
        durationMs: Date.now() - runtimeStartedAt,
      });
      yield* Effect.logDebug("startup phase: publishing ready event");
      yield* runStartupPhase(
        "ready.publish",
        lifecycleEvents.publish({
          version: 1,
          type: "ready",
          payload: {
            at: new Date().toISOString(),
            environment: yield* serverEnvironment.getDescriptor,
          },
        }),
      );

      yield* Effect.logDebug("startup phase: recording startup heartbeat");
      yield* launchStartupHeartbeat;
      if (serverConfig.startupPresentation === "headless") {
        yield* Effect.logDebug("startup phase: headless access info");
        const accessInfo = yield* issueHeadlessServeAccessInfo();
        yield* runStartupPhase(
          "headless.output",
          Console.log(formatHeadlessServeOutput(accessInfo)),
        );
      } else {
        yield* Effect.logDebug("startup phase: browser open check");
        const startupBrowserTarget = yield* resolveStartupBrowserTarget;
        if (serverConfig.mode !== "desktop") {
          yield* Effect.logInfo("Authentication required. Open Ryco using the pairing URL.").pipe(
            Effect.annotateLogs({ pairingUrl: startupBrowserTarget }),
          );
        }
        yield* runStartupPhase("browser.open", maybeOpenBrowser(startupBrowserTarget));
      }
      yield* Effect.logInfo("startup phase complete", {
        durationMs: Date.now() - runtimeStartedAt,
      });
    }),
  );

  return {
    awaitCommandReady: commandGate.awaitCommandReady,
    markHttpListening: Effect.gen(function* () {
      yield* Effect.logDebug("startup http listener marked");
      yield* Deferred.succeed(httpListening, undefined);
    }),
    enqueueCommand: commandGate.enqueueCommand,
  } satisfies ServerRuntimeStartupShape;
});

export const ServerRuntimeStartupLive = Layer.effect(
  ServerRuntimeStartup,
  makeServerRuntimeStartup,
);
