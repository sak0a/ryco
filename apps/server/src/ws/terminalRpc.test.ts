import { assert, it } from "@effect/vitest";
import { Cause, Effect, Exit, Queue } from "effect";
import { type TerminalEvent, TerminalSubscriptionResyncError } from "@ryco/contracts";

import { makeTerminalSubscriberOffer } from "./terminalRpc.ts";

const event = (data: string): TerminalEvent => ({
  type: "output",
  threadId: "thread-1",
  terminalId: "default",
  createdAt: "2026-08-12T00:00:00.000Z",
  data,
});

it.effect("fails only a terminal subscriber that exhausts its bounded buffer", () =>
  Effect.gen(function* () {
    const queue = yield* Queue.dropping<
      TerminalEvent,
      TerminalSubscriptionResyncError | Cause.Done<void>
    >(1);
    const offer = makeTerminalSubscriberOffer(queue, 1);

    yield* offer(event("first"));
    yield* offer(event("overflow"));

    const first = yield* Queue.take(queue);
    assert.equal(first.type === "output" ? first.data : null, "first");
    const exit = yield* Queue.take(queue).pipe(Effect.exit);
    assert.isTrue(Exit.isFailure(exit));
    if (Exit.isFailure(exit)) {
      assert.match(exit.cause.toString(), /reconnect to resynchronize/);
    }
  }),
);
