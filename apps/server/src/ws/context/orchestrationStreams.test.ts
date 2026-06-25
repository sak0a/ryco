import { assert, describe, it } from "@effect/vitest";
import {
  EventId,
  OrchestrationGetSnapshotError,
  type OrchestrationEvent,
  ThreadId,
} from "@ryco/contracts";
import { Cause, Effect, Metric, Queue, Ref } from "effect";

import { makeWsReplayMetrics } from "../../wsReplayMetrics.ts";
import { offerOrchestrationLiveEventOrFail } from "./orchestrationStreams.ts";

const LIVE_OVERFLOWS_METRIC_ID = "t3_ws_orchestration_live_buffer_overflows_total";

const metricNumberValue = (snapshot: Metric.Metric.Snapshot): number => {
  const state = snapshot.state as { readonly value?: unknown; readonly count?: unknown };
  if (typeof state.value === "number") {
    return state.value;
  }
  if (typeof state.count === "number") {
    return state.count;
  }
  if (typeof state.count === "bigint") {
    return Number(state.count);
  }
  return 0;
};

const sumMetricValue = (snapshots: ReadonlyArray<Metric.Metric.Snapshot>, id: string): number =>
  snapshots
    .filter((snapshot) => snapshot.id === id)
    .reduce((total, snapshot) => total + metricNumberValue(snapshot), 0);

const makeThreadDeletedEvent = (sequence: number, threadId: ThreadId): OrchestrationEvent => ({
  sequence,
  eventId: EventId.make(`event-live-overflow-${sequence}`),
  aggregateKind: "thread",
  aggregateId: threadId,
  occurredAt: "2026-04-05T00:00:00.000Z",
  commandId: null,
  causationEventId: null,
  correlationId: null,
  metadata: {},
  type: "thread.deleted",
  payload: {
    threadId,
    deletedAt: "2026-04-05T00:00:00.000Z",
  },
});

describe("orchestrationStreams", () => {
  it.effect("fails live queues on overflow so subscriptions resync by reconnecting", () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("thread-live-overflow");
      const capacity = 1;
      const baselineOverflowCount = sumMetricValue(
        yield* Metric.snapshot,
        LIVE_OVERFLOWS_METRIC_ID,
      );
      const liveQueue = yield* Queue.bounded<OrchestrationEvent, OrchestrationGetSnapshotError>(
        capacity,
      );
      const overflowedRef = yield* Ref.make(false);
      const replayMetrics = yield* makeWsReplayMetrics({
        stream: "shell",
        subscriptionId: "orchestration-stream-overflow-unit",
        snapshotSequence: 0,
      });

      yield* offerOrchestrationLiveEventOrFail({
        stream: "shell",
        event: makeThreadDeletedEvent(1, threadId),
        liveQueue,
        overflowedRef,
        replayMetrics,
        capacity,
      });
      yield* offerOrchestrationLiveEventOrFail({
        stream: "shell",
        event: makeThreadDeletedEvent(2, threadId),
        liveQueue,
        overflowedRef,
        replayMetrics,
        capacity,
      });

      const firstTake = yield* Queue.take(liveQueue).pipe(Effect.exit);
      const result =
        firstTake._tag === "Failure" ? firstTake : yield* Queue.take(liveQueue).pipe(Effect.exit);
      const overflowCount = sumMetricValue(yield* Metric.snapshot, LIVE_OVERFLOWS_METRIC_ID);

      assert.equal(yield* Ref.get(overflowedRef), true);
      assert.equal(overflowCount - baselineOverflowCount, 1);
      assert.equal(result._tag, "Failure");
      if (result._tag === "Failure") {
        const error = Cause.squash(result.cause);
        assert.instanceOf(error, OrchestrationGetSnapshotError);
        assert.include(error.message, "live event queue overflowed");
      }

      yield* replayMetrics.reset;
    }),
  );
});
