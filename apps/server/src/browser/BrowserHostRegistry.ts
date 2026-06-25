import {
  BrowserCommandId,
  BrowserServiceError,
  type BrowserCommandResult,
  type BrowserEvent,
  type BrowserHostCommand,
  type BrowserHostCommandEnvelope,
  type BrowserHostHeartbeatInput,
  type BrowserHostId,
  type BrowserHostRegisterInput,
  type BrowserHostRegisterResult,
  type BrowserHostRunId,
  type BrowserHostSnapshot,
  type BrowserSessionSnapshot,
} from "@ryco/contracts";
import { Context, Deferred, Effect, Layer, PubSub, Queue, Ref, Stream } from "effect";

interface PendingCommand {
  readonly runId: BrowserHostRunId;
  readonly deferred: Deferred.Deferred<BrowserCommandResult, BrowserServiceError>;
  readonly timeout: ReturnType<typeof setTimeout>;
}

interface BrowserHostRegistryState {
  readonly host: BrowserHostSnapshot | null;
  readonly sessions: ReadonlyMap<string, BrowserSessionSnapshot>;
  readonly pending: ReadonlyMap<string, PendingCommand>;
}

export interface BrowserHostRegistryShape {
  readonly register: (
    input: BrowserHostRegisterInput,
  ) => Effect.Effect<BrowserHostRegisterResult, BrowserServiceError>;
  readonly heartbeat: (
    input: BrowserHostHeartbeatInput,
  ) => Effect.Effect<void, BrowserServiceError>;
  readonly disconnect: (input: {
    readonly hostId: BrowserHostId;
    readonly runId: BrowserHostRunId;
  }) => Effect.Effect<void>;
  readonly snapshot: Effect.Effect<{
    readonly host: BrowserHostSnapshot | null;
    readonly sessions: ReadonlyArray<BrowserSessionSnapshot>;
  }>;
  readonly sendCommand: (input: {
    readonly command: BrowserHostCommand;
    readonly timeoutMs?: number;
  }) => Effect.Effect<BrowserCommandResult, BrowserServiceError>;
  readonly completeCommand: (input: {
    readonly hostId: BrowserHostId;
    readonly runId: BrowserHostRunId;
    readonly result: BrowserCommandResult;
  }) => Effect.Effect<void, BrowserServiceError>;
  readonly publishHostEvent: (input: {
    readonly hostId: BrowserHostId;
    readonly runId: BrowserHostRunId;
    readonly event: BrowserEvent;
  }) => Effect.Effect<void, BrowserServiceError>;
  readonly commandStream: (input: {
    readonly hostId: BrowserHostId;
    readonly runId: BrowserHostRunId;
  }) => Stream.Stream<BrowserHostCommandEnvelope, BrowserServiceError>;
  readonly eventStream: Stream.Stream<BrowserEvent>;
}

export class BrowserHostRegistry extends Context.Service<
  BrowserHostRegistry,
  BrowserHostRegistryShape
>()("ryco/browser/BrowserHostRegistry") {}

const DEFAULT_COMMAND_TIMEOUT_MS = 15_000;
const COMMAND_QUEUE_SIZE = 64;

const staleHostError = () =>
  new BrowserServiceError({
    code: "host_disconnected",
    message: "Browser host registration is stale.",
    retryable: true,
  });

function isCurrentHost(
  host: BrowserHostSnapshot | null,
  hostId: BrowserHostId,
  runId: BrowserHostRunId,
): boolean {
  return host?.hostId === hostId && host.runId === runId && host.connected;
}

export const BrowserHostRegistryLive = Layer.effect(
  BrowserHostRegistry,
  Effect.gen(function* () {
    const state = yield* Ref.make<BrowserHostRegistryState>({
      host: null,
      sessions: new Map(),
      pending: new Map(),
    });
    const commandQueue = yield* Queue.bounded<BrowserHostCommandEnvelope>(COMMAND_QUEUE_SIZE);
    const eventPubSub = yield* PubSub.unbounded<BrowserEvent>();
    const context = yield* Effect.context<never>();
    const runFork = Effect.runForkWith(context);

    const failPending = (
      pending: ReadonlyMap<string, PendingCommand>,
      error: BrowserServiceError,
    ) =>
      Effect.forEach(
        [...pending.values()],
        (command) =>
          Effect.sync(() => clearTimeout(command.timeout)).pipe(
            Effect.andThen(Deferred.fail(command.deferred, error)),
            Effect.ignore,
          ),
        { discard: true },
      );

    const publish = (event: BrowserEvent) => PubSub.publish(eventPubSub, event).pipe(Effect.asVoid);

    return {
      register: (input) =>
        Effect.gen(function* () {
          const now = new Date().toISOString();
          const host = {
            hostId: input.hostId,
            runId: input.runId,
            connected: true,
            capabilities: input.capabilities,
            registeredAt: now,
            heartbeatAt: now,
          } satisfies BrowserHostSnapshot;
          const previous = yield* Ref.get(state);
          yield* failPending(previous.pending, staleHostError());
          yield* Ref.set(state, {
            host,
            sessions: previous.sessions,
            pending: new Map(),
          });
          yield* publish({
            type: "host.connected",
            host,
            createdAt: now,
          });
          return { accepted: true, host } satisfies BrowserHostRegisterResult;
        }),
      heartbeat: (input) =>
        Effect.gen(function* () {
          const current = yield* Ref.get(state);
          const host = current.host;
          if (!host || !isCurrentHost(host, input.hostId, input.runId)) {
            return yield* staleHostError();
          }
          const heartbeatAt = new Date().toISOString();
          const sessions = new Map(current.sessions);
          for (const session of input.sessions ?? []) {
            sessions.set(session.sessionId, session);
          }
          yield* Ref.set(state, {
            ...current,
            host: { ...host, heartbeatAt },
            sessions,
          });
        }),
      disconnect: (input) =>
        Effect.gen(function* () {
          const current = yield* Ref.get(state);
          const host = current.host;
          if (!host || !isCurrentHost(host, input.hostId, input.runId)) return;
          yield* failPending(
            current.pending,
            new BrowserServiceError({
              code: "host_disconnected",
              message: "Browser host disconnected while commands were in flight.",
              retryable: true,
            }),
          );
          yield* Ref.set(state, {
            ...current,
            host: { ...host, connected: false },
            pending: new Map(),
          });
          yield* publish({
            type: "host.disconnected",
            hostId: input.hostId,
            runId: input.runId,
            createdAt: new Date().toISOString(),
          });
        }),
      snapshot: Ref.get(state).pipe(
        Effect.map((current) => ({
          host: current.host,
          sessions: [...current.sessions.values()],
        })),
      ),
      sendCommand: (input) =>
        Effect.gen(function* () {
          const current = yield* Ref.get(state);
          const host = current.host;
          if (!host?.connected) {
            return yield* new BrowserServiceError({
              code: "host_unavailable",
              message: "No desktop browser host is connected.",
              retryable: true,
            });
          }

          const deferred = yield* Deferred.make<BrowserCommandResult, BrowserServiceError>();
          const commandId = BrowserCommandId.make(`browser-command:${crypto.randomUUID()}`);
          const timeoutMs = input.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
          const timeout = setTimeout(() => {
            runFork(
              Deferred.fail(
                deferred,
                new BrowserServiceError({
                  code: "command_timeout",
                  message: "Browser command timed out.",
                  retryable: true,
                }),
              ).pipe(
                Effect.andThen(
                  Ref.update(state, (latest) => {
                    const pending = new Map(latest.pending);
                    pending.delete(commandId);
                    return { ...latest, pending };
                  }),
                ),
                Effect.ignore,
              ),
            );
          }, timeoutMs);

          const envelope = {
            commandId,
            hostId: host.hostId,
            runId: host.runId,
            command: input.command,
            issuedAt: new Date().toISOString(),
            timeoutMs,
          } satisfies BrowserHostCommandEnvelope;

          yield* Ref.update(state, (latest) => {
            const pending = new Map(latest.pending);
            pending.set(commandId, {
              runId: host.runId,
              deferred,
              timeout,
            });
            return { ...latest, pending };
          });
          yield* Queue.offer(commandQueue, envelope);
          return yield* Deferred.await(deferred);
        }),
      completeCommand: (input) =>
        Effect.gen(function* () {
          const current = yield* Ref.get(state);
          if (!isCurrentHost(current.host, input.hostId, input.runId)) {
            return yield* staleHostError();
          }
          const pending = current.pending.get(input.result.commandId);
          if (!pending || pending.runId !== input.runId) {
            return;
          }
          yield* Ref.update(state, (latest) => {
            const nextPending = new Map(latest.pending);
            nextPending.delete(input.result.commandId);
            return { ...latest, pending: nextPending };
          });
          yield* Effect.sync(() => clearTimeout(pending.timeout));
          yield* Deferred.succeed(pending.deferred, input.result).pipe(Effect.ignore);
        }),
      publishHostEvent: (input) =>
        Effect.gen(function* () {
          const current = yield* Ref.get(state);
          if (!isCurrentHost(current.host, input.hostId, input.runId)) {
            return yield* staleHostError();
          }
          const event = input.event;
          if (event.type === "session.updated" && "session" in event) {
            yield* Ref.update(state, (latest) => {
              const sessions = new Map(latest.sessions);
              sessions.set(event.session.sessionId, event.session);
              return { ...latest, sessions };
            });
          } else if (event.type === "session.closed" && "sessionId" in event) {
            yield* Ref.update(state, (latest) => {
              const sessions = new Map(latest.sessions);
              sessions.delete(event.sessionId);
              return { ...latest, sessions };
            });
          }
          yield* publish(event);
        }),
      commandStream: (input) =>
        Stream.fromQueue(commandQueue).pipe(
          Stream.filter(
            (envelope) => envelope.hostId === input.hostId && envelope.runId === input.runId,
          ),
        ),
      get eventStream() {
        return Stream.fromPubSub(eventPubSub);
      },
    } satisfies BrowserHostRegistryShape;
  }),
);
