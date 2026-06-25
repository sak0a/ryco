import { assert, describe, it } from "@effect/vitest";
import { Effect, Metric } from "effect";

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
        subscriptionId: "ws-replay-metrics-unit",
      };
      const metrics = yield* makeWsReplayMetrics({
        stream: "shell",
        subscriptionId: attributes.subscriptionId,
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
});
