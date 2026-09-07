import { assert, describe, it } from "@effect/vitest";
import { Cause, Effect, Exit, Queue } from "effect";
import { type TerminalEvent, TerminalSubscriptionResyncError } from "@ryco/contracts";

import { makeTerminalSubscriberOffer, releaseTerminalSubscriberEvent } from "./terminalRpc.ts";

const event = (data: string): Extract<TerminalEvent, { type: "output" }> => ({
  type: "output",
  threadId: "thread-1",
  terminalId: "default",
  createdAt: "2026-08-12T00:00:00.000Z",
  data,
});

describe("makeTerminalSubscriberOffer", () => {
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

  it.effect("fails with the same resync signal when the queued byte budget trips", () =>
    Effect.gen(function* () {
      const queue = yield* Queue.dropping<
        TerminalEvent,
        TerminalSubscriptionResyncError | Cause.Done<void>
      >(16);
      const ledger = { bytes: 0 };
      // Each event serializes well past 150 bytes (fixed fields plus data);
      // two fit the 400-byte budget, a third queued frame does not.
      const chunk = event("x".repeat(40));
      const offer = makeTerminalSubscriberOffer(queue, 16, ledger, 400);

      yield* offer(chunk);
      yield* offer(chunk);
      assert.isAbove(ledger.bytes, 0);

      // The release tap models the transport draining: ledger returns to 0.
      for (let index = 0; index < 2; index += 1) {
        const drained = yield* Queue.take(queue);
        yield* releaseTerminalSubscriberEvent(ledger, drained);
      }
      assert.equal(ledger.bytes, 0);

      // A fully drained subscriber is live again.
      yield* offer(chunk);
      assert.isAbove(ledger.bytes, 0);

      // Two more queued frames trip the byte budget while the count bound is
      // nowhere near exhausted; the same slowConsumer resync signal fires.
      yield* offer(chunk);
      yield* offer(chunk);
      // The two queued frames are delivered before the queued failure.
      for (let index = 0; index < 2; index += 1) {
        const drained = yield* Queue.take(queue);
        assert.equal(drained.type === "output" ? drained.data : null, chunk.data);
      }
      const exit = yield* Queue.take(queue).pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit)) {
        const error = Cause.squash(exit.cause);
        assert.instanceOf(error, TerminalSubscriptionResyncError);
        assert.equal(error.reason, "slowConsumer");
      }
    }),
  );
});
