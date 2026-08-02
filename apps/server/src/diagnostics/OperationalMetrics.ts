import type { DiagnosticsQueuePressure } from "@ryco/contracts";
import { Metric } from "effect";

import { metricNames } from "../observability/Metrics.ts";
import { wsReplayMetricNames } from "../wsReplayMetrics.ts";

function metricValue(snapshot: Metric.Metric.Snapshot): number | null {
  const state = snapshot.state as { readonly value?: unknown; readonly count?: unknown };
  if (typeof state.value === "number") return state.value;
  if (typeof state.count === "number") return state.count;
  if (typeof state.count === "bigint") return Number(state.count);
  return null;
}

function valuesFor(
  snapshots: ReadonlyArray<Metric.Metric.Snapshot>,
  metricId: string,
): ReadonlyArray<number> {
  return snapshots.flatMap((snapshot) => {
    if (snapshot.id !== metricId) return [];
    const value = metricValue(snapshot);
    return value === null || !Number.isFinite(value) ? [] : [Math.max(0, value)];
  });
}

function sum(values: ReadonlyArray<number>): number {
  return Math.round(values.reduce((total, value) => total + value, 0));
}

function max(values: ReadonlyArray<number>): number {
  return Math.round(values.reduce((largest, value) => Math.max(largest, value), 0));
}

export function summarizeOperationalMetrics(
  snapshots: ReadonlyArray<Metric.Metric.Snapshot>,
): DiagnosticsQueuePressure {
  return {
    runtimeDepthTotal: sum(valuesFor(snapshots, metricNames.runtimeQueueDepth)),
    runtimeHighWaterMax: max(valuesFor(snapshots, metricNames.runtimeQueueHighWater)),
    replayDepthMax: max(valuesFor(snapshots, wsReplayMetricNames.replayDepth)),
    liveBufferDepthTotal: sum(valuesFor(snapshots, wsReplayMetricNames.liveBufferDepth)),
    liveBufferHighWaterMax: max(valuesFor(snapshots, wsReplayMetricNames.liveBufferHighWater)),
    liveBufferOverflowCount: sum(
      valuesFor(snapshots, wsReplayMetricNames.liveBufferOverflowsTotal),
    ),
    replayLagMax: max(valuesFor(snapshots, wsReplayMetricNames.replayLag)),
    providerLogDroppedRecords: sum(
      valuesFor(snapshots, metricNames.providerEventLogRecordsDroppedTotal),
    ),
  };
}
