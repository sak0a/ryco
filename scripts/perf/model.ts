export const EXTERNAL_PERF_SCHEMA_VERSION = 2 as const;

export type PerfScenarioProfile = "shell" | "active-source-control";

export interface PerfScenarioConfig {
  readonly profile: PerfScenarioProfile;
  readonly iterations: number;
  readonly idleMs: number;
  readonly hiddenIdleMs: number;
  readonly offlineMs: number;
  readonly reconnectTimeoutMs: number;
  readonly readySelector: string;
  readonly targetPath: string | null;
  readonly fixtureHome: string | null;
  readonly sourceControlDiscoveryTimeoutMs: number;
  readonly sourceControlActiveMs: number;
  readonly sourceControlHiddenMs: number;
  readonly sourceControlSettledMs: number;
  readonly sourceControlStatusRows: number;
}

export interface PhaseNetworkMetrics {
  readonly requests: number;
  readonly fetchXhrRequests: number;
  readonly failedRequests: number;
  readonly encodedBytes: number;
  readonly webSocketFrames: number;
  readonly webSocketBytes: number;
}

export interface ProcessTreeSummary {
  readonly supported: boolean;
  readonly samples: number;
  readonly peakRssBytes: number | null;
  readonly medianCpuPercent: number | null;
  readonly peakCpuPercent: number | null;
  readonly peakProcessCount: number | null;
  readonly unavailableReason: string | null;
}

export interface BrowserVitals {
  readonly ttfbMs: number | null;
  readonly domContentLoadedMs: number | null;
  readonly fcpMs: number | null;
  readonly lcpMs: number | null;
  readonly cls: number | null;
  readonly usableMs: number | null;
  readonly longTasks: number;
  readonly maxLongTaskMs: number;
}

export interface SourceControlScenarioMetrics {
  readonly supported: boolean;
  readonly discoveryRequests: number;
  readonly discoveryCadenceMs: number | null;
  readonly duplicateObserverRequests: number;
  readonly activeRequests: number;
  readonly activeCadenceMs: number | null;
  readonly hiddenRequests: number;
  readonly settledRequests: number;
  readonly statusMotionRows: number;
  readonly statusMotionFrames: number;
  readonly statusMotionP95FrameMs: number | null;
  readonly statusMotionDroppedFrames: number;
  readonly unavailableReason: string | null;
}

export interface PerfSample {
  readonly iteration: number;
  readonly serverReadyMs: number | null;
  readonly reconnectMs: number | null;
  readonly foregroundTaskMs: number | null;
  readonly hiddenTaskMs: number | null;
  readonly heapBeforeIdleBytes: number | null;
  readonly heapAfterIdleBytes: number | null;
  readonly vitals: BrowserVitals;
  readonly bootstrapNetwork: PhaseNetworkMetrics;
  readonly foregroundIdleNetwork: PhaseNetworkMetrics;
  readonly hiddenIdleNetwork: PhaseNetworkMetrics;
  readonly reconnectNetwork: PhaseNetworkMetrics;
  readonly processTree: ProcessTreeSummary;
  readonly sourceControl: SourceControlScenarioMetrics;
  readonly errors: readonly string[];
}

export interface MetricAggregate {
  readonly count: number;
  readonly median: number;
  readonly p95: number;
  readonly maximum: number;
  readonly minimum: number;
}

export type PerfMetricKey =
  | "serverReadyMs"
  | "ttfbMs"
  | "domContentLoadedMs"
  | "fcpMs"
  | "lcpMs"
  | "cls"
  | "usableMs"
  | "longTasks"
  | "maxLongTaskMs"
  | "bootstrapRequests"
  | "bootstrapEncodedBytes"
  | "bootstrapWebSocketBytes"
  | "foregroundIdleRequests"
  | "hiddenIdleRequests"
  | "reconnectMs"
  | "foregroundTaskMs"
  | "hiddenTaskMs"
  | "heapAfterIdleBytes"
  | "peakTreeRssBytes"
  | "medianTreeCpuPercent"
  | "peakTreeCpuPercent"
  | "sourceControlDiscoveryRequests"
  | "sourceControlDiscoveryCadenceMs"
  | "sourceControlDuplicateObserverRequests"
  | "sourceControlActiveRequests"
  | "sourceControlActiveCadenceMs"
  | "sourceControlHiddenRequests"
  | "sourceControlSettledRequests"
  | "statusMotionP95FrameMs"
  | "statusMotionDroppedFrames";

export type ComparisonMetricKey =
  | PerfMetricKey
  | "buildDurationMs"
  | "buildPeakRssBytes"
  | "bundleRawBytes"
  | "bundleGzipBytes"
  | "bundleBrotliBytes";

export interface BuildMeasurement {
  readonly durationMs: number;
  readonly peakRssBytes: number | null;
  readonly exitCode: number;
}

export interface BundleMeasurement {
  readonly files: number;
  readonly rawBytes: number;
  readonly gzipBytes: number;
  readonly brotliBytes: number;
}

export interface BenchmarkMetadata {
  readonly generatedAt: string;
  readonly platform: NodeJS.Platform;
  readonly architecture: string;
  readonly bunVersion: string;
  readonly nodeVersion: string;
  readonly cpuModel: string;
  readonly cpuCount: number;
  readonly totalMemoryBytes: number;
}

export interface BenchmarkResult {
  readonly schemaVersion: typeof EXTERNAL_PERF_SCHEMA_VERSION;
  readonly label: string;
  readonly revision: string;
  readonly scenario: PerfScenarioConfig;
  readonly metadata: BenchmarkMetadata;
  readonly build: BuildMeasurement | null;
  readonly bundle: BundleMeasurement | null;
  readonly samples: readonly PerfSample[];
  readonly aggregates: Readonly<Partial<Record<PerfMetricKey, MetricAggregate>>>;
  readonly errors: readonly string[];
}

export interface MetricRegressionPolicy {
  readonly relativePercent: number;
  readonly absolute: number;
}

export interface ComparisonPolicy {
  readonly metrics: Readonly<Partial<Record<ComparisonMetricKey, MetricRegressionPolicy>>>;
  readonly idleRequestAllowance: number;
  readonly failOnSampleErrors: boolean;
}

export interface MetricComparison {
  readonly metric: ComparisonMetricKey;
  readonly baseline: number | null;
  readonly candidate: number | null;
  readonly delta: number | null;
  readonly relativePercent: number | null;
  readonly regressed: boolean;
  readonly reason: string | null;
}

export interface BenchmarkComparison {
  readonly schemaVersion: typeof EXTERNAL_PERF_SCHEMA_VERSION;
  readonly baselineLabel: string;
  readonly candidateLabel: string;
  readonly comparisons: readonly MetricComparison[];
  readonly failures: readonly string[];
  readonly passed: boolean;
}

export const EMPTY_NETWORK_METRICS: PhaseNetworkMetrics = {
  requests: 0,
  fetchXhrRequests: 0,
  failedRequests: 0,
  encodedBytes: 0,
  webSocketFrames: 0,
  webSocketBytes: 0,
};

export const UNSUPPORTED_SOURCE_CONTROL_METRICS: SourceControlScenarioMetrics = {
  supported: false,
  discoveryRequests: 0,
  discoveryCadenceMs: null,
  duplicateObserverRequests: 0,
  activeRequests: 0,
  activeCadenceMs: null,
  hiddenRequests: 0,
  settledRequests: 0,
  statusMotionRows: 0,
  statusMotionFrames: 0,
  statusMotionP95FrameMs: null,
  statusMotionDroppedFrames: 0,
  unavailableReason: "The shell profile does not run the active source-control scenario.",
};

export const DEFAULT_COMPARISON_POLICY: ComparisonPolicy = {
  metrics: {
    serverReadyMs: { relativePercent: 15, absolute: 50 },
    ttfbMs: { relativePercent: 15, absolute: 50 },
    domContentLoadedMs: { relativePercent: 15, absolute: 50 },
    fcpMs: { relativePercent: 15, absolute: 50 },
    lcpMs: { relativePercent: 15, absolute: 100 },
    usableMs: { relativePercent: 15, absolute: 100 },
    bootstrapEncodedBytes: { relativePercent: 10, absolute: 10 * 1024 },
    bootstrapWebSocketBytes: { relativePercent: 10, absolute: 10 * 1024 },
    heapAfterIdleBytes: { relativePercent: 10, absolute: 20 * 1024 * 1024 },
    peakTreeRssBytes: { relativePercent: 10, absolute: 20 * 1024 * 1024 },
    reconnectMs: { relativePercent: 20, absolute: 250 },
    maxLongTaskMs: { relativePercent: 20, absolute: 50 },
    buildDurationMs: { relativePercent: 15, absolute: 5_000 },
    buildPeakRssBytes: { relativePercent: 10, absolute: 100 * 1024 * 1024 },
    bundleRawBytes: { relativePercent: 5, absolute: 50 * 1024 },
    bundleGzipBytes: { relativePercent: 5, absolute: 20 * 1024 },
    bundleBrotliBytes: { relativePercent: 5, absolute: 20 * 1024 },
    sourceControlDiscoveryCadenceMs: { relativePercent: 20, absolute: 2_000 },
    sourceControlActiveCadenceMs: { relativePercent: 15, absolute: 3_000 },
    statusMotionP95FrameMs: { relativePercent: 20, absolute: 4 },
    statusMotionDroppedFrames: { relativePercent: 50, absolute: 3 },
  },
  idleRequestAllowance: 1,
  failOnSampleErrors: true,
};

export const PERF_METRIC_KEYS: readonly PerfMetricKey[] = [
  "serverReadyMs",
  "ttfbMs",
  "domContentLoadedMs",
  "fcpMs",
  "lcpMs",
  "cls",
  "usableMs",
  "longTasks",
  "maxLongTaskMs",
  "bootstrapRequests",
  "bootstrapEncodedBytes",
  "bootstrapWebSocketBytes",
  "foregroundIdleRequests",
  "hiddenIdleRequests",
  "reconnectMs",
  "foregroundTaskMs",
  "hiddenTaskMs",
  "heapAfterIdleBytes",
  "peakTreeRssBytes",
  "medianTreeCpuPercent",
  "peakTreeCpuPercent",
  "sourceControlDiscoveryRequests",
  "sourceControlDiscoveryCadenceMs",
  "sourceControlDuplicateObserverRequests",
  "sourceControlActiveRequests",
  "sourceControlActiveCadenceMs",
  "sourceControlHiddenRequests",
  "sourceControlSettledRequests",
  "statusMotionP95FrameMs",
  "statusMotionDroppedFrames",
];

export function sampleMetric(sample: PerfSample, metric: PerfMetricKey): number | null {
  switch (metric) {
    case "serverReadyMs":
      return sample.serverReadyMs;
    case "ttfbMs":
    case "domContentLoadedMs":
    case "fcpMs":
    case "lcpMs":
    case "cls":
    case "usableMs":
    case "longTasks":
    case "maxLongTaskMs":
      return sample.vitals[metric];
    case "bootstrapRequests":
      return sample.bootstrapNetwork.requests;
    case "bootstrapEncodedBytes":
      return sample.bootstrapNetwork.encodedBytes;
    case "bootstrapWebSocketBytes":
      return sample.bootstrapNetwork.webSocketBytes;
    case "foregroundIdleRequests":
      return sample.foregroundIdleNetwork.fetchXhrRequests;
    case "hiddenIdleRequests":
      return sample.hiddenIdleNetwork.fetchXhrRequests;
    case "reconnectMs":
      return sample.reconnectMs;
    case "foregroundTaskMs":
      return sample.foregroundTaskMs;
    case "hiddenTaskMs":
      return sample.hiddenTaskMs;
    case "heapAfterIdleBytes":
      return sample.heapAfterIdleBytes;
    case "peakTreeRssBytes":
      return sample.processTree.peakRssBytes;
    case "medianTreeCpuPercent":
      return sample.processTree.medianCpuPercent;
    case "peakTreeCpuPercent":
      return sample.processTree.peakCpuPercent;
    case "sourceControlDiscoveryRequests":
      return sample.sourceControl.supported ? sample.sourceControl.discoveryRequests : null;
    case "sourceControlDiscoveryCadenceMs":
      return sample.sourceControl.discoveryCadenceMs;
    case "sourceControlDuplicateObserverRequests":
      return sample.sourceControl.supported ? sample.sourceControl.duplicateObserverRequests : null;
    case "sourceControlActiveRequests":
      return sample.sourceControl.supported ? sample.sourceControl.activeRequests : null;
    case "sourceControlActiveCadenceMs":
      return sample.sourceControl.activeCadenceMs;
    case "sourceControlHiddenRequests":
      return sample.sourceControl.supported ? sample.sourceControl.hiddenRequests : null;
    case "sourceControlSettledRequests":
      return sample.sourceControl.supported ? sample.sourceControl.settledRequests : null;
    case "statusMotionP95FrameMs":
      return sample.sourceControl.statusMotionP95FrameMs;
    case "statusMotionDroppedFrames":
      return sample.sourceControl.supported ? sample.sourceControl.statusMotionDroppedFrames : null;
  }
}
