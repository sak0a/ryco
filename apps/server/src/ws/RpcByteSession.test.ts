import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";
import { RELAY_CHUNK_CAPABILITY_PRELUDE } from "@ryco/shared/relayMessageChunks";

import { makeRpcByteSession } from "./RpcByteSession.ts";

const EchoRpc = Rpc.make("echo", {
  payload: Schema.Struct({ value: Schema.String }),
  success: Schema.Struct({ value: Schema.String }),
});
const TestGroup = RpcGroup.make(EchoRpc);

const request = (id: string, value: string) =>
  new TextEncoder().encode(
    JSON.stringify({
      _tag: "Request",
      id,
      tag: "echo",
      payload: { value },
      headers: [],
    }),
  );

describe("RpcByteSession", () => {
  it.effect("records a legacy-compatible chunk capability advertisement", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const output = yield* Deferred.make<Uint8Array>();
        const handlers = TestGroup.toLayer(
          Effect.succeed(
            TestGroup.of({
              echo: ({ value }) => Effect.succeed({ value }),
            }),
          ),
        );
        const session = yield* makeRpcByteSession(TestGroup, handlers, (bytes) =>
          Deferred.succeed(output, Uint8Array.from(bytes)).pipe(Effect.asVoid),
        );
        expect(session.supportsChunkedMessages()).toBe(false);
        const legacyCompatibleRequest = new Uint8Array(
          RELAY_CHUNK_CAPABILITY_PRELUDE.byteLength + request("1", "relay").byteLength,
        );
        legacyCompatibleRequest.set(RELAY_CHUNK_CAPABILITY_PRELUDE);
        legacyCompatibleRequest.set(
          request("1", "relay"),
          RELAY_CHUNK_CAPABILITY_PRELUDE.byteLength,
        );
        expect(yield* session.receive(legacyCompatibleRequest)).toBe(true);
        yield* Deferred.await(output);
        expect(session.supportsChunkedMessages()).toBe(true);
      }),
    ),
  );

  it.effect("runs a real Effect RPC request through ordered bytes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const output = yield* Deferred.make<Uint8Array>();
        const handlers = TestGroup.toLayer(
          Effect.succeed(
            TestGroup.of({
              echo: ({ value }) => Effect.succeed({ value: value.toUpperCase() }),
            }),
          ),
        );
        const session = yield* makeRpcByteSession(
          TestGroup,
          handlers,
          (bytes) => Deferred.succeed(output, Uint8Array.from(bytes)).pipe(Effect.asVoid),
          { queueCapacity: 2 },
        );
        expect(yield* session.receive(request("1", "relay"))).toBe(true);
        const response = JSON.parse(new TextDecoder().decode(yield* Deferred.await(output))) as {
          _tag: string;
          requestId: string;
          exit: { _tag: string; value: { value: string } };
        };
        expect(response).toMatchObject({
          _tag: "Exit",
          requestId: "1",
          exit: { _tag: "Success", value: { value: "RELAY" } },
        });
        yield* session.close;
        expect(yield* session.receive(request("2", "closed"))).toBe(false);
      }),
    ),
  );

  it.effect("bounds queued input and releases it on scope close", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const handlers = TestGroup.toLayer(
          Effect.succeed(
            TestGroup.of({
              echo: ({ value }) => Effect.succeed({ value }),
            }),
          ),
        );
        const session = yield* makeRpcByteSession(TestGroup, handlers, () => Effect.void, {
          queueCapacity: 1,
        });
        expect(yield* session.receive(request("1", "one"))).toBe(true);
        yield* Effect.yieldNow;
        expect(yield* session.queuedMessages).toBeLessThanOrEqual(1);
      }),
    ),
  );
});
