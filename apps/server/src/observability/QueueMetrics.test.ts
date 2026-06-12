import { assert, describe, it } from "@effect/vitest";
import { Effect, Metric } from "effect";

import { metricNames } from "./Metrics.ts";
import { makeServerQueueMetrics } from "./QueueMetrics.ts";

const findMetricValue = (
  snapshots: ReadonlyArray<Metric.Metric.Snapshot>,
  id: string,
  attributes: Readonly<Record<string, string>>,
): number | undefined => {
  const snapshot = snapshots.find(
    (item) =>
      item.id === id &&
      Object.entries(attributes).every(([key, value]) => item.attributes?.[key] === value),
  );
  const state = snapshot?.state as { readonly count?: unknown; readonly value?: unknown };
  if (typeof state?.value === "number") return state.value;
  return typeof state?.count === "number" ? state.count : undefined;
};

describe("QueueMetrics", () => {
  it.effect("tracks enqueue, dequeue, depth, high-water, and reset gauges", () =>
    Effect.gen(function* () {
      const attributes = {
        queue: "unit.queue",
        owner: "queue-metrics-test",
      };
      const metrics = yield* makeServerQueueMetrics(attributes);

      yield* metrics.recordEnqueued(3);
      yield* metrics.recordDequeued();

      const snapshots = yield* Metric.snapshot;
      assert.equal(
        findMetricValue(snapshots, metricNames.runtimeQueueEnqueuesTotal, attributes),
        3,
      );
      assert.equal(
        findMetricValue(snapshots, metricNames.runtimeQueueDequeuesTotal, attributes),
        1,
      );
      assert.equal(findMetricValue(snapshots, metricNames.runtimeQueueDepth, attributes), 2);
      assert.equal(findMetricValue(snapshots, metricNames.runtimeQueueHighWater, attributes), 3);

      yield* metrics.reset;
      const resetSnapshots = yield* Metric.snapshot;
      assert.equal(findMetricValue(resetSnapshots, metricNames.runtimeQueueDepth, attributes), 0);
      assert.equal(
        findMetricValue(resetSnapshots, metricNames.runtimeQueueHighWater, attributes),
        0,
      );
    }),
  );
});
