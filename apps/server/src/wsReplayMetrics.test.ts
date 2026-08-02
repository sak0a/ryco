import { assert, describe, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Metric } from "effect";

import { makeWsReplayMetrics } from "./wsReplayMetrics.ts";

const findGaugeValue = (
  snapshots: ReadonlyArray<Metric.Metric.Snapshot>,
  id: string,
  attributes: Readonly<Record<string, string>>,
): number | undefined => {
  const snapshot = snapshots.find(
    (item) =>
      item.id === id &&
      Object.entries(attributes).every(([key, value]) => item.attributes?.[key] === value),
  );
  const state = snapshot?.state as
    | { readonly value?: unknown; readonly count?: unknown }
    | undefined;
  if (typeof state?.value === "number") {
    return state.value;
  }
  if (typeof state?.count === "number") {
    return state.count;
  }
  if (typeof state?.count === "bigint") {
    return Number(state.count);
  }
  return undefined;
};

describe("wsReplayMetrics", () => {
  it.effect("records replay depth, live buffer depth, high-water, and lag", () =>
    Effect.gen(function* () {
      const attributes = {
        stream: "shell",
      };
      const metrics = yield* makeWsReplayMetrics({
        stream: "shell",
        subscriptionId: "ws-replay-metrics-unit",
        snapshotSequence: 10,
      });

      yield* metrics.recordLiveEnqueued(12);
      yield* metrics.recordReplayEvent(11);
      yield* metrics.recordLiveDequeued(12);
      yield* metrics.recordLiveOverflow(13, 4);

      const snapshots = yield* Metric.snapshot;
      assert.equal(findGaugeValue(snapshots, "t3_ws_orchestration_replay_depth", attributes), 1);
      assert.equal(
        findGaugeValue(snapshots, "t3_ws_orchestration_live_buffer_depth", attributes),
        4,
      );
      assert.equal(
        findGaugeValue(snapshots, "t3_ws_orchestration_live_buffer_high_water", attributes),
        4,
      );
      assert.equal(
        findGaugeValue(snapshots, "t3_ws_orchestration_live_buffer_overflows_total", attributes),
        1,
      );
      assert.equal(findGaugeValue(snapshots, "t3_ws_orchestration_replay_lag", attributes), 1);

      yield* metrics.reset;
      const resetSnapshots = yield* Metric.snapshot;
      assert.equal(
        findGaugeValue(resetSnapshots, "t3_ws_orchestration_replay_depth", attributes),
        0,
      );
      assert.equal(
        findGaugeValue(resetSnapshots, "t3_ws_orchestration_live_buffer_high_water", attributes),
        0,
      );
    }),
  );

  it.effect("publishes bounded per-stream aggregates across active subscriptions", () =>
    Effect.gen(function* () {
      const first = yield* makeWsReplayMetrics({
        stream: "thread",
        subscriptionId: "ws-replay-aggregate-first",
        snapshotSequence: 10,
      });
      const second = yield* makeWsReplayMetrics({
        stream: "thread",
        subscriptionId: "ws-replay-aggregate-second",
        snapshotSequence: 20,
      });

      yield* first.recordLiveEnqueued(11);
      yield* first.recordLiveEnqueued(12);
      yield* second.recordLiveEnqueued(21);

      const activeSnapshots = yield* Metric.snapshot;
      assert.equal(
        findGaugeValue(activeSnapshots, "t3_ws_orchestration_live_buffer_depth", {
          stream: "thread",
        }),
        3,
      );
      assert.equal(
        activeSnapshots.filter(
          (snapshot) =>
            snapshot.id === "t3_ws_orchestration_live_buffer_depth" &&
            snapshot.attributes?.stream === "thread",
        ).length,
        1,
      );

      yield* first.reset;
      assert.equal(
        findGaugeValue(yield* Metric.snapshot, "t3_ws_orchestration_live_buffer_depth", {
          stream: "thread",
        }),
        1,
      );

      yield* second.reset;
      assert.equal(
        findGaugeValue(yield* Metric.snapshot, "t3_ws_orchestration_live_buffer_depth", {
          stream: "thread",
        }),
        0,
      );
    }),
  );

  it.effect("removes active state when the registration scope is interrupted", () =>
    Effect.gen(function* () {
      const ready = yield* Deferred.make<void>();
      const attributes = { stream: "shell" };
      const fiber = yield* Effect.scoped(
        Effect.gen(function* () {
          const metrics = yield* makeWsReplayMetrics({
            stream: "shell",
            subscriptionId: "ws-replay-interrupted-registration",
            snapshotSequence: 0,
          });
          yield* metrics.recordLiveEnqueued(1);
          yield* Deferred.succeed(ready, undefined);
          return yield* Effect.never;
        }),
      ).pipe(Effect.forkChild);

      yield* Deferred.await(ready);
      assert.equal(
        findGaugeValue(yield* Metric.snapshot, "t3_ws_orchestration_live_buffer_depth", attributes),
        1,
      );

      yield* Fiber.interrupt(fiber);
      assert.equal(
        findGaugeValue(yield* Metric.snapshot, "t3_ws_orchestration_live_buffer_depth", attributes),
        0,
      );
    }),
  );
});
