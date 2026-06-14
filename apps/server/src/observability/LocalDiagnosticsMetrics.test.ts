import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import {
  LocalDiagnosticsMetrics,
  LocalDiagnosticsMetricsLive,
} from "./Services/LocalDiagnosticsMetrics.ts";

describe("LocalDiagnosticsMetrics", () => {
  it.effect("tracks rolling averages, p95, and reconnect counts", () =>
    Effect.gen(function* () {
      const metrics = yield* LocalDiagnosticsMetrics;

      yield* metrics.recordTurnQuiescenceMs(100);
      yield* metrics.recordTurnQuiescenceMs(300);
      yield* metrics.recordCheckpointDurationMs(50);
      yield* metrics.recordCheckpointDurationMs(150);
      yield* metrics.recordCheckpointDurationMs(250);
      yield* metrics.recordWsReconnect();
      yield* metrics.recordWsReconnect();

      const snapshot = yield* metrics.snapshot;
      assert.equal(snapshot.turnQuiescenceAvgMs, 200);
      assert.equal(snapshot.checkpointDurationP95Ms, 250);
      assert.equal(snapshot.wsReconnectCount, 2);
      assert.equal(snapshot.windowSampleCounts.turnQuiescence, 2);
      assert.equal(snapshot.windowSampleCounts.checkpointDuration, 3);
      assert.match(snapshot.capturedAt, /^\d{4}-\d{2}-\d{2}T/);
    }).pipe(Effect.provide(LocalDiagnosticsMetricsLive)),
  );
});
