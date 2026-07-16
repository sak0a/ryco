import { Effect, Queue, Scope } from "effect";
import type { Layer } from "effect";
import type { Rpc } from "effect/unstable/rpc";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";
import type { RpcGroup } from "effect/unstable/rpc";

export interface RpcByteSession {
  readonly receive: (bytes: Uint8Array) => Effect.Effect<boolean>;
  readonly close: Effect.Effect<void>;
  readonly queuedMessages: Effect.Effect<number>;
  readonly queuedBytes: Effect.Effect<number>;
}

const encoder = new TextEncoder();

export function makeRpcByteSession<Rpcs extends Rpc.Any, E, R>(
  group: RpcGroup.RpcGroup<Rpcs>,
  handlers: Layer.Layer<Rpc.ToHandler<Rpcs> | Rpc.Middleware<Rpcs>, E, R>,
  sink: (bytes: Uint8Array) => Effect.Effect<void>,
  options: { readonly queueCapacity?: number } = {},
): Effect.Effect<RpcByteSession, E, Scope.Scope | R> {
  return Effect.gen(function* () {
    const capacity = options.queueCapacity ?? 16;
    if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 1_024) {
      return yield* Effect.die(new Error("RPC byte session capacity is invalid."));
    }
    const incoming = yield* Queue.dropping<Uint8Array>(capacity);
    const disconnects = yield* Queue.unbounded<number>();
    const parser = RpcSerialization.json.makeUnsafe();
    const clients = new Set<number>([0]);
    let queuedBytes = 0;

    const protocol = yield* RpcServer.Protocol.make((writeRequest) =>
      Effect.gen(function* () {
        yield* Effect.forkScoped(
          Effect.forever(
            Queue.take(incoming).pipe(
              Effect.flatMap((bytes) =>
                Effect.sync(() => {
                  queuedBytes = Math.max(0, queuedBytes - bytes.byteLength);
                  return parser.decode(bytes);
                }).pipe(
                  Effect.flatMap((messages) =>
                    Effect.forEach(messages, (message) => writeRequest(0, message as never), {
                      discard: true,
                    }),
                  ),
                ),
              ),
            ),
          ),
        );
        return {
          disconnects,
          send: (_clientId, response) =>
            Effect.sync(() => parser.encode(response)).pipe(
              Effect.flatMap((encoded) => {
                if (encoded === undefined) return Effect.void;
                const bytes =
                  typeof encoded === "string" ? encoder.encode(encoded) : Uint8Array.from(encoded);
                return Effect.orDie(sink(bytes));
              }),
            ),
          end: () => Effect.void,
          clientIds: Effect.sync(() => clients as ReadonlySet<number>),
          initialMessage: Effect.succeedNone,
          supportsAck: true,
          supportsTransferables: false,
          supportsSpanPropagation: true,
        };
      }),
    );

    yield* RpcServer.make(group, {
      spanPrefix: "ws.rpc",
      spanAttributes: {
        "rpc.transport": "byte-session",
        "rpc.system": "effect-rpc",
      },
    }).pipe(
      Effect.provideService(RpcServer.Protocol, protocol),
      Effect.provide(handlers),
      Effect.forkScoped,
    );

    yield* Scope.addFinalizer(
      yield* Effect.scope,
      Effect.gen(function* () {
        clients.clear();
        queuedBytes = 0;
        yield* Queue.offer(disconnects, 0);
        yield* Queue.shutdown(incoming);
        yield* Queue.shutdown(disconnects);
      }),
    );

    return {
      receive: (bytes) => {
        const copy = Uint8Array.from(bytes);
        queuedBytes += copy.byteLength;
        return Queue.offer(incoming, copy).pipe(
          Effect.tap((accepted) =>
            accepted
              ? Effect.void
              : Effect.sync(() => {
                  queuedBytes = Math.max(0, queuedBytes - copy.byteLength);
                  copy.fill(0);
                }),
          ),
        );
      },
      close: Effect.sync(() => {
        queuedBytes = 0;
      }).pipe(Effect.andThen(Queue.shutdown(incoming)), Effect.asVoid),
      queuedMessages: Queue.size(incoming),
      queuedBytes: Effect.sync(() => queuedBytes),
    } satisfies RpcByteSession;
  }) as Effect.Effect<RpcByteSession, E, Scope.Scope | R>;
}
