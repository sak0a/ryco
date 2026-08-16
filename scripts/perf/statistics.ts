import {
  PERF_METRIC_KEYS,
  sampleMetric,
  type MetricAggregate,
  type PerfMetricKey,
  type PerfSample,
} from "./model.ts";

export function finiteValues(values: readonly (number | null | undefined)[]): number[] {
  return values.filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value),
  );
}

export function percentile(values: readonly number[], fraction: number): number | null {
  const sorted = finiteValues(values).toSorted((left, right) => left - right);
  if (sorted.length === 0) return null;
  const boundedFraction = Math.min(1, Math.max(0, fraction));
  const rank = Math.max(0, Math.ceil(boundedFraction * sorted.length) - 1);
  return sorted[rank] ?? null;
}

export function median(values: readonly number[]): number | null {
  const sorted = finiteValues(values).toSorted((left, right) => left - right);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? null;
  const left = sorted[middle - 1];
  const right = sorted[middle];
  return left === undefined || right === undefined ? null : (left + right) / 2;
}

export function aggregate(values: readonly (number | null | undefined)[]): MetricAggregate | null {
  const finite = finiteValues(values);
  if (finite.length === 0) return null;
  const medianValue = median(finite);
  const p95 = percentile(finite, 0.95);
  if (medianValue === null || p95 === null) return null;
  return {
    count: finite.length,
    median: medianValue,
    p95,
    maximum: Math.max(...finite),
    minimum: Math.min(...finite),
  };
}

export function aggregateSamples(
  samples: readonly PerfSample[],
): Partial<Record<PerfMetricKey, MetricAggregate>> {
  return Object.fromEntries(
    PERF_METRIC_KEYS.flatMap((metric) => {
      const metricAggregate = aggregate(samples.map((sample) => sampleMetric(sample, metric)));
      return metricAggregate ? [[metric, metricAggregate] as const] : [];
    }),
  );
}
