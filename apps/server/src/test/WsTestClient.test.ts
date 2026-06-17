import { assert, it } from "@effect/vitest";
import { Effect, Stream } from "effect";

import { makeConnectedWsTestClient } from "./WsTestClient.ts";

/**
 * These tests exercise the {@link makeConnectedWsTestClient} combinators
 * (`rpc`, `awaitPush`, `trackPushSequence`) against a lightweight in-memory
 * client that mimics the shape of an Effect RPC client: request/response methods
 * return `Effect`s and subscription channels return `Stream`s.
 *
 * End-to-end coverage of {@link connect}/`awaitWelcome` over a real websocket is
 * provided by the migrated integration tests in `server.test.ts`.
 */

interface LifecycleEvent {
  readonly type: "welcome" | "ready";
  readonly id: number;
}

const makeFakeClient = () => ({
  echo: (input: { readonly message: string }) =>
    Effect.succeed({ message: `echo:${input.message}` }),
  subscribeCounter: (input: { readonly count: number }) =>
    Stream.fromIterable(Array.from({ length: input.count }, (_, index) => ({ value: index + 1 }))),
  subscribeLifecycle: (_input: Record<never, never>) =>
    Stream.fromIterable<LifecycleEvent>([
      { type: "welcome", id: 1 },
      { type: "ready", id: 2 },
    ]),
});

it.effect("rpc() forwards request/response calls to the underlying client", () =>
  Effect.gen(function* () {
    const ws = makeConnectedWsTestClient(makeFakeClient());
    const response = yield* ws.rpc("echo", { message: "ping" });
    assert.deepEqual(response, { message: "echo:ping" });
  }),
);

it.effect("awaitPush() resolves with the first push matching the predicate", () =>
  Effect.gen(function* () {
    const ws = makeConnectedWsTestClient(makeFakeClient());
    const event = yield* ws.awaitPush("subscribeCounter", (push) => push.value === 3, {
      count: 5,
    });
    assert.deepEqual(event, { value: 3 });
  }),
);

it.effect("awaitPush() resolves discriminated union events", () =>
  Effect.gen(function* () {
    const ws = makeConnectedWsTestClient(makeFakeClient());
    const welcome = yield* ws.awaitPush(
      "subscribeLifecycle",
      (event) => event.type === "welcome",
      {},
    );
    assert.deepEqual(welcome, { type: "welcome", id: 1 });
  }),
);

it.effect("trackPushSequence() records pushes in arrival order", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const ws = makeConnectedWsTestClient(makeFakeClient());
      const sequence = yield* ws.trackPushSequence("subscribeCounter", { count: 4 });

      const collected = yield* sequence.waitForCount(4);
      assert.deepEqual(
        collected.map((event) => event.value),
        [1, 2, 3, 4],
      );

      const snapshot = yield* sequence.snapshot;
      assert.equal(snapshot.length, 4);

      const matched = yield* sequence.waitFor((event) => event.value === 2);
      assert.deepEqual(matched, { value: 2 });
    }),
  ),
);
