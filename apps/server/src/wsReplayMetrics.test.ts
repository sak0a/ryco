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
  const state = snapshot?.state as { readonly value?: unknown } | undefined;
  return typeof state?.value === "number" ? state.value : undefined;
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

      const snapshots = yield* Metric.snapshot;
      assert.equal(findGaugeValue(snapshots, "t3_ws_orchestration_replay_depth", attributes), 1);
      assert.equal(
        findGaugeValue(snapshots, "t3_ws_orchestration_live_buffer_depth", attributes),
        0,
      );
      assert.equal(
        findGaugeValue(snapshots, "t3_ws_orchestration_live_buffer_high_water", attributes),
        1,
      );
      assert.equal(findGaugeValue(snapshots, "t3_ws_orchestration_replay_lag", attributes), 0);

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
