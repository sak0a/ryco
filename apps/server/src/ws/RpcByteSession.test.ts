import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

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
