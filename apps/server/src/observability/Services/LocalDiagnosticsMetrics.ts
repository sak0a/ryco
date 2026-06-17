import { Context, DateTime, Effect, Layer } from "effect";

import {
  DEFAULT_ROLLING_WINDOW_MAX_SAMPLES,
  DEFAULT_ROLLING_WINDOW_MS,
  RollingDurationWindow,
} from "../RollingDurationWindow.ts";

export interface ServerLocalDiagnosticsMetricsSnapshot {
  readonly turnQuiescenceAvgMs: number | null;
  readonly checkpointDurationP95Ms: number | null;
  readonly wsReconnectCount: number;
  readonly windowSampleCounts: {
    readonly turnQuiescence: number;
    readonly checkpointDuration: number;
  };
  readonly capturedAt: string;
}

export interface LocalDiagnosticsMetricsShape {
  readonly recordTurnQuiescenceMs: (durationMs: number) => Effect.Effect<void>;
  readonly recordCheckpointDurationMs: (durationMs: number) => Effect.Effect<void>;
  readonly recordWsReconnect: () => Effect.Effect<void>;
  readonly snapshot: Effect.Effect<ServerLocalDiagnosticsMetricsSnapshot>;
}

export class LocalDiagnosticsMetrics extends Context.Service<
  LocalDiagnosticsMetrics,
  LocalDiagnosticsMetricsShape
>()("ryco/observability/Services/LocalDiagnosticsMetrics") {}

export const makeLocalDiagnosticsMetrics = Effect.sync(() => {
  const turnQuiescenceWindow = new RollingDurationWindow({
    maxSamples: DEFAULT_ROLLING_WINDOW_MAX_SAMPLES,
    maxWindowMs: DEFAULT_ROLLING_WINDOW_MS,
  });
  const checkpointDurationWindow = new RollingDurationWindow({
    maxSamples: DEFAULT_ROLLING_WINDOW_MAX_SAMPLES,
    maxWindowMs: DEFAULT_ROLLING_WINDOW_MS,
  });
  let wsReconnectCount = 0;

  const snapshot = Effect.gen(function* () {
    const capturedAt = yield* DateTime.now;
    return {
      turnQuiescenceAvgMs: turnQuiescenceWindow.average(),
      checkpointDurationP95Ms: checkpointDurationWindow.percentile(95),
      wsReconnectCount,
      windowSampleCounts: {
        turnQuiescence: turnQuiescenceWindow.count(),
        checkpointDuration: checkpointDurationWindow.count(),
      },
      capturedAt: DateTime.formatIso(capturedAt),
    } satisfies ServerLocalDiagnosticsMetricsSnapshot;
  });

  return {
    recordTurnQuiescenceMs: (durationMs) =>
      Effect.sync(() => {
        turnQuiescenceWindow.record(durationMs);
      }),
    recordCheckpointDurationMs: (durationMs) =>
      Effect.sync(() => {
        checkpointDurationWindow.record(durationMs);
      }),
    recordWsReconnect: () =>
      Effect.sync(() => {
        wsReconnectCount += 1;
      }),
    snapshot,
  } satisfies LocalDiagnosticsMetricsShape;
});

export const LocalDiagnosticsMetricsLive = Layer.effect(
  LocalDiagnosticsMetrics,
  makeLocalDiagnosticsMetrics,
);
