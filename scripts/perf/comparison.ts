import {
  DEFAULT_COMPARISON_POLICY,
  EXTERNAL_PERF_SCHEMA_VERSION,
  type BenchmarkComparison,
  type BenchmarkResult,
  type ComparisonMetricKey,
  type ComparisonPolicy,
  type MetricComparison,
} from "./model.ts";

function resultMedian(result: BenchmarkResult, metric: ComparisonMetricKey): number | null {
  switch (metric) {
    case "buildDurationMs":
      return result.build?.durationMs ?? null;
    case "buildPeakRssBytes":
      return result.build?.peakRssBytes ?? null;
    case "bundleRawBytes":
      return result.bundle?.rawBytes ?? null;
    case "bundleGzipBytes":
      return result.bundle?.gzipBytes ?? null;
    case "bundleBrotliBytes":
      return result.bundle?.brotliBytes ?? null;
    default:
      return result.aggregates[metric]?.median ?? null;
  }
}

function compareMetric(input: {
  readonly metric: ComparisonMetricKey;
  readonly baseline: number | null;
  readonly candidate: number | null;
  readonly relativePercent: number;
  readonly absolute: number;
}): MetricComparison {
  if (input.baseline === null && input.candidate === null) {
    return {
      metric: input.metric,
      baseline: null,
      candidate: null,
      delta: null,
      relativePercent: null,
      regressed: false,
      reason: null,
    };
  }
  if (input.candidate === null) {
    return {
      metric: input.metric,
      baseline: input.baseline,
      candidate: null,
      delta: null,
      relativePercent: null,
      regressed: input.baseline !== null,
      reason: input.baseline === null ? null : "candidate measurement is missing",
    };
  }
  if (input.baseline === null) {
    return {
      metric: input.metric,
      baseline: null,
      candidate: input.candidate,
      delta: null,
      relativePercent: null,
      regressed: false,
      reason: null,
    };
  }

  const delta = input.candidate - input.baseline;
  const relativePercent = input.baseline === 0 ? null : (delta / Math.abs(input.baseline)) * 100;
  const exceedsAbsolute = delta > input.absolute;
  const exceedsRelative =
    input.baseline === 0
      ? input.candidate > input.absolute
      : (relativePercent ?? 0) > input.relativePercent;
  const regressed = exceedsAbsolute && exceedsRelative;
  return {
    metric: input.metric,
    baseline: input.baseline,
    candidate: input.candidate,
    delta,
    relativePercent,
    regressed,
    reason: regressed
      ? `increased by ${delta.toFixed(2)} (${relativePercent === null ? "baseline zero" : `${relativePercent.toFixed(1)}%`})`
      : null,
  };
}

function errorFailures(label: string, result: BenchmarkResult): string[] {
  return [
    ...result.errors.map((error) => `${label}: ${error}`),
    ...result.samples.flatMap((sample) =>
      sample.errors.map((error) => `${label} iteration ${sample.iteration}: ${error}`),
    ),
    ...(result.samples.length < result.scenario.iterations
      ? [`${label}: produced ${result.samples.length}/${result.scenario.iterations} samples`]
      : []),
    ...(result.build && result.build.exitCode !== 0
      ? [`${label}: build exited with code ${result.build.exitCode}`]
      : []),
  ];
}

export function compareBenchmarks(
  baseline: BenchmarkResult,
  candidate: BenchmarkResult,
  policy: ComparisonPolicy = DEFAULT_COMPARISON_POLICY,
): BenchmarkComparison {
  const comparisons: MetricComparison[] = Object.entries(policy.metrics).map(
    ([metric, threshold]) =>
      compareMetric({
        metric: metric as ComparisonMetricKey,
        baseline: resultMedian(baseline, metric as ComparisonMetricKey),
        candidate: resultMedian(candidate, metric as ComparisonMetricKey),
        relativePercent: threshold.relativePercent,
        absolute: threshold.absolute,
      }),
  );

  for (const metric of ["foregroundIdleRequests", "hiddenIdleRequests"] as const) {
    const existing = comparisons.find((comparison) => comparison.metric === metric);
    const baselineValue = resultMedian(baseline, metric);
    const candidateValue = resultMedian(candidate, metric);
    const regressed =
      baselineValue !== null &&
      candidateValue !== null &&
      candidateValue > baselineValue + policy.idleRequestAllowance;
    const idleComparison: MetricComparison = {
      metric,
      baseline: baselineValue,
      candidate: candidateValue,
      delta:
        baselineValue === null || candidateValue === null ? null : candidateValue - baselineValue,
      relativePercent:
        baselineValue && candidateValue !== null
          ? ((candidateValue - baselineValue) / Math.abs(baselineValue)) * 100
          : null,
      regressed,
      reason: regressed
        ? `exceeded baseline by more than ${policy.idleRequestAllowance} request(s)`
        : null,
    };
    if (existing) comparisons.splice(comparisons.indexOf(existing), 1, idleComparison);
    else comparisons.push(idleComparison);
  }

  const failures = [
    ...comparisons.flatMap((comparison) =>
      comparison.regressed ? [`${comparison.metric}: ${comparison.reason ?? "regressed"}`] : [],
    ),
    ...(policy.failOnSampleErrors
      ? [...errorFailures("baseline", baseline), ...errorFailures("candidate", candidate)]
      : []),
  ];
  return {
    schemaVersion: EXTERNAL_PERF_SCHEMA_VERSION,
    baselineLabel: baseline.label,
    candidateLabel: candidate.label,
    comparisons,
    failures,
    passed: failures.length === 0,
  };
}
