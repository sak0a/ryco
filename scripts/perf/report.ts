import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import type {
  BenchmarkComparison,
  BenchmarkResult,
  ComparisonMetricKey,
  MetricComparison,
} from "./model.ts";

const BYTE_METRICS = new Set<ComparisonMetricKey>([
  "bootstrapEncodedBytes",
  "bootstrapWebSocketBytes",
  "heapAfterIdleBytes",
  "peakTreeRssBytes",
  "buildPeakRssBytes",
  "bundleRawBytes",
  "bundleGzipBytes",
  "bundleBrotliBytes",
]);

function formatNumber(value: number | null, metric: ComparisonMetricKey): string {
  if (value === null) return "n/a";
  if (BYTE_METRICS.has(metric)) {
    if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(2)} MiB`;
    if (value >= 1024) return `${(value / 1024).toFixed(1)} KiB`;
    return `${value.toFixed(0)} B`;
  }
  if (metric.endsWith("Ms")) return `${value.toFixed(1)} ms`;
  if (metric.toLowerCase().includes("percent")) return `${value.toFixed(1)}%`;
  return value.toFixed(2);
}

function resultSummary(result: BenchmarkResult): string[] {
  return [
    `- Revision: \`${result.revision}\``,
    `- Samples: ${result.samples.length}/${result.scenario.iterations}`,
    `- Platform: ${result.metadata.platform}/${result.metadata.architecture}`,
    `- Bun: ${result.metadata.bunVersion}; Node: ${result.metadata.nodeVersion}`,
    `- CPU: ${result.metadata.cpuModel} (${result.metadata.cpuCount} logical cores)`,
  ];
}

function comparisonRow(comparison: MetricComparison): string {
  const relative =
    comparison.relativePercent === null ? "n/a" : `${comparison.relativePercent.toFixed(1)}%`;
  return `| ${comparison.metric} | ${formatNumber(comparison.baseline, comparison.metric)} | ${formatNumber(comparison.candidate, comparison.metric)} | ${relative} | ${comparison.regressed ? "FAIL" : "PASS"} |`;
}

export function renderComparisonMarkdown(input: {
  readonly baseline: BenchmarkResult;
  readonly candidate: BenchmarkResult;
  readonly comparison: BenchmarkComparison;
}): string {
  const lines = [
    "# Ryco External Performance Comparison",
    "",
    `Result: **${input.comparison.passed ? "PASS" : "FAIL"}**`,
    "",
    `## Baseline — ${input.baseline.label}`,
    "",
    ...resultSummary(input.baseline),
    "",
    `## Candidate — ${input.candidate.label}`,
    "",
    ...resultSummary(input.candidate),
    "",
    "## Metrics",
    "",
    "| Metric | Baseline median | Candidate median | Change | Result |",
    "| --- | ---: | ---: | ---: | --- |",
    ...input.comparison.comparisons.map(comparisonRow),
    "",
    "## Failures",
    "",
    ...(input.comparison.failures.length > 0
      ? input.comparison.failures.map((failure) => `- ${failure}`)
      : ["- None."]),
    "",
    "## Scenario",
    "",
    "```json",
    JSON.stringify(input.candidate.scenario, null, 2),
    "```",
    "",
  ];
  return lines.join("\n");
}

export function writeBenchmarkArtifacts(input: {
  readonly outputDir: string;
  readonly baseline?: BenchmarkResult;
  readonly candidate: BenchmarkResult;
  readonly comparison?: BenchmarkComparison;
}): void {
  mkdirSync(input.outputDir, { recursive: true });
  if (input.baseline) {
    writeFileSync(
      path.join(input.outputDir, "baseline.json"),
      `${JSON.stringify(input.baseline, null, 2)}\n`,
    );
  }
  writeFileSync(
    path.join(input.outputDir, input.baseline ? "candidate.json" : "result.json"),
    `${JSON.stringify(input.candidate, null, 2)}\n`,
  );
  if (input.baseline && input.comparison) {
    writeFileSync(
      path.join(input.outputDir, "comparison.json"),
      `${JSON.stringify(input.comparison, null, 2)}\n`,
    );
    writeFileSync(
      path.join(input.outputDir, "comparison.md"),
      renderComparisonMarkdown({
        baseline: input.baseline,
        candidate: input.candidate,
        comparison: input.comparison,
      }),
    );
  }
}
