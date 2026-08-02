import { assert, describe, it } from "@effect/vitest";
import { Effect, Metric } from "effect";

import {
  providerEventLogRecordsDroppedTotal,
  runtimeQueueDepth,
  runtimeQueueHighWater,
} from "../observability/Metrics.ts";
import {
  wsOrchestrationLiveBufferDepth,
  wsOrchestrationLiveBufferHighWater,
  wsOrchestrationLiveBufferOverflowsTotal,
  wsOrchestrationReplayDepth,
  wsOrchestrationReplayLag,
} from "../wsReplayMetrics.ts";
import { summarizeOperationalMetrics } from "./OperationalMetrics.ts";

describe("OperationalMetrics", () => {
  it.effect("summarizes queue pressure without exposing metric attributes", () =>
    Effect.gen(function* () {
      yield* Metric.update(
        Metric.withAttributes(runtimeQueueDepth, [["queue", "private-owner-a"]]),
        2,
      );
      yield* Metric.update(
        Metric.withAttributes(runtimeQueueDepth, [["queue", "private-owner-b"]]),
        3,
      );
      yield* Metric.update(
        Metric.withAttributes(runtimeQueueHighWater, [["queue", "private-owner-a"]]),
        5,
      );
      yield* Metric.update(wsOrchestrationReplayDepth, 4);
      yield* Metric.update(wsOrchestrationLiveBufferDepth, 2);
      yield* Metric.update(wsOrchestrationLiveBufferHighWater, 8);
      yield* Metric.update(wsOrchestrationLiveBufferOverflowsTotal, 1);
      yield* Metric.update(wsOrchestrationReplayLag, 6);
      yield* Metric.update(providerEventLogRecordsDroppedTotal, 7);

      const summary = summarizeOperationalMetrics(yield* Metric.snapshot);

      assert.equal(summary.runtimeDepthTotal >= 5, true);
      assert.equal(summary.runtimeHighWaterMax >= 5, true);
      assert.equal(summary.replayDepthMax >= 4, true);
      assert.equal(summary.liveBufferDepthTotal >= 2, true);
      assert.equal(summary.liveBufferHighWaterMax >= 8, true);
      assert.equal(summary.liveBufferOverflowCount >= 1, true);
      assert.equal(summary.replayLagMax >= 6, true);
      assert.equal(summary.providerLogDroppedRecords >= 7, true);
      assert.deepStrictEqual(Object.keys(summary).toSorted(), [
        "liveBufferDepthTotal",
        "liveBufferHighWaterMax",
        "liveBufferOverflowCount",
        "providerLogDroppedRecords",
        "replayDepthMax",
        "replayLagMax",
        "runtimeDepthTotal",
        "runtimeHighWaterMax",
      ]);
    }),
  );
});
