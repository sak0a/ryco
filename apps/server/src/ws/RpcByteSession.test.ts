import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";
import {
  prepareRelayMessage,
  RELAY_CHUNK_CAPABILITY_PRELUDE,
} from "@ryco/shared/relayMessageChunks";

import { makeRpcByteSession, RpcOutputRefusedError } from "./RpcByteSession.ts";

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

const echoHandlers = TestGroup.toLayer(
  Effect.succeed(
    TestGroup.of({
      echo: ({ value }) => Effect.succeed({ value }),
    }),
  ),
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

  it.effect("keeps a claimed payload away from the RPC parser", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const output = yield* Deferred.make<Uint8Array>();
        const seen: Uint8Array[] = [];
        const session = yield* makeRpcByteSession(
          TestGroup,
          echoHandlers,
          (bytes) => Deferred.succeed(output, Uint8Array.from(bytes)).pipe(Effect.asVoid),
          {
            interceptor: (message) =>
              Effect.sync(() => {
                seen.push(Uint8Array.from(message));
                return message[0] === 0x2a ? { kind: "claimed" } : { kind: "rpc", message };
              }),
          },
        );

        // The interceptor sees the payload the RPC decoder would have seen:
        // reassembled and with the chunk-capability prelude already stripped.
        const claimed = new Uint8Array(RELAY_CHUNK_CAPABILITY_PRELUDE.byteLength + 3);
        claimed.set(RELAY_CHUNK_CAPABILITY_PRELUDE);
        claimed.set(Uint8Array.of(0x2a, 0x01, 0x02), RELAY_CHUNK_CAPABILITY_PRELUDE.byteLength);
        expect(yield* session.receive(claimed)).toBe(true);
        expect(yield* session.receive(request("1", "relay"))).toBe(true);

        // Only the payload the interceptor passed through produced a response,
        // so the claimed bytes never reached the parser.
        const response = new TextDecoder().decode(yield* Deferred.await(output));
        expect(response).toContain('"requestId":"1"');
        expect(seen).toEqual([Uint8Array.of(0x2a, 0x01, 0x02), request("1", "relay")]);
      }),
    ),
  );

  it.effect("drops a refused response instead of failing the session", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const delivered = yield* Deferred.make<Uint8Array>();
        let refusals = 0;
        const session = yield* makeRpcByteSession(TestGroup, echoHandlers, (bytes) =>
          Effect.suspend(() => {
            if (refusals === 0) {
              refusals += 1;
              return Effect.fail(new RpcOutputRefusedError());
            }
            return Deferred.succeed(delivered, Uint8Array.from(bytes)).pipe(Effect.asVoid);
          }),
        );

        expect(yield* session.receive(request("1", "first"))).toBe(true);
        expect(yield* session.receive(request("2", "second"))).toBe(true);
        // A refusal used to be a defect, which took the RPC server fiber and
        // every other request on the channel with it.
        const response = new TextDecoder().decode(yield* Deferred.await(delivered));
        expect(response).toContain('"requestId":"2"');
        expect(refusals).toBe(1);
      }),
    ),
  );

  it.effect("reports an incomplete reassembly while a chunked message is in flight", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const output = yield* Deferred.make<Uint8Array>();
        const session = yield* makeRpcByteSession(TestGroup, echoHandlers, (bytes) =>
          Deferred.succeed(output, Uint8Array.from(bytes)).pipe(Effect.asVoid),
        );
        expect(session.incompleteReassembly()).toBe(false);

        const prepared = prepareRelayMessage(request("1", "relay".repeat(400)), {
          maxChunkBytes: 512,
          maxMessageBytes: 512 * 1_024,
          peerSupportsChunking: true,
        });
        if (prepared.kind !== "ready") throw new Error(prepared.reason);
        expect(prepared.payloads.length).toBeGreaterThan(1);

        expect(yield* session.receive(prepared.payloads[0]!)).toBe(true);
        for (let turn = 0; turn < 8; turn += 1) yield* Effect.yieldNow;
        // The channel-owning layer reads exactly this at teardown: a message the
        // assembler holds and can no longer complete is truncation (§10.4), and
        // it is knowable nowhere else.
        expect(session.incompleteReassembly()).toBe(true);

        for (const payload of prepared.payloads.slice(1)) {
          expect(yield* session.receive(payload)).toBe(true);
        }
        yield* Deferred.await(output);
        expect(session.incompleteReassembly()).toBe(false);
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
