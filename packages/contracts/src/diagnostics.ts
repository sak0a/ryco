import { Schema } from "effect";

import { IsoDateTime, NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ProviderDriverKind, ProviderInstanceId } from "./providerInstance.ts";
import { ServerProviderState } from "./server.ts";
import { TerminalSessionStatus } from "./terminal.ts";

export const DiagnosticsWarning = Schema.Struct({
  code: TrimmedNonEmptyString,
  message: TrimmedNonEmptyString,
  source: Schema.optional(TrimmedNonEmptyString),
  count: Schema.optional(NonNegativeInt),
});
export type DiagnosticsWarning = typeof DiagnosticsWarning.Type;

export const DiagnosticsObservability = Schema.Struct({
  logsDirectoryPath: TrimmedNonEmptyString,
  serverLogPath: TrimmedNonEmptyString,
  serverTracePath: TrimmedNonEmptyString,
  providerEventLogPath: TrimmedNonEmptyString,
  localTracingEnabled: Schema.Boolean,
  otlpTracesUrl: Schema.optional(TrimmedNonEmptyString),
  otlpTracesEnabled: Schema.Boolean,
  otlpMetricsUrl: Schema.optional(TrimmedNonEmptyString),
  otlpMetricsEnabled: Schema.Boolean,
});
export type DiagnosticsObservability = typeof DiagnosticsObservability.Type;

export const DiagnosticsResourceMemory = Schema.Struct({
  rssBytes: NonNegativeInt,
  heapUsedBytes: NonNegativeInt,
  heapTotalBytes: NonNegativeInt,
  externalBytes: NonNegativeInt,
  arrayBuffersBytes: NonNegativeInt,
});
export type DiagnosticsResourceMemory = typeof DiagnosticsResourceMemory.Type;

export const DiagnosticsResourceCpu = Schema.Struct({
  userMicros: NonNegativeInt,
  systemMicros: NonNegativeInt,
  utilizationPercent: Schema.optional(Schema.Number),
});
export type DiagnosticsResourceCpu = typeof DiagnosticsResourceCpu.Type;

export const DiagnosticsResourceSample = Schema.Struct({
  sampledAt: IsoDateTime,
  uptimeMs: NonNegativeInt,
  memory: DiagnosticsResourceMemory,
  cpu: DiagnosticsResourceCpu,
  eventLoopDelayMs: Schema.optional(Schema.Number),
});
export type DiagnosticsResourceSample = typeof DiagnosticsResourceSample.Type;

export const DiagnosticsResources = Schema.Struct({
  current: DiagnosticsResourceSample,
  history: Schema.Array(DiagnosticsResourceSample),
});
export type DiagnosticsResources = typeof DiagnosticsResources.Type;

export const DiagnosticsServerProcess = Schema.Struct({
  pid: NonNegativeInt,
  platform: TrimmedNonEmptyString,
  runtime: TrimmedNonEmptyString,
  version: TrimmedNonEmptyString,
  cwd: TrimmedNonEmptyString,
});
export type DiagnosticsServerProcess = typeof DiagnosticsServerProcess.Type;

export const DiagnosticsTerminalProcess = Schema.Struct({
  threadId: TrimmedNonEmptyString,
  terminalId: TrimmedNonEmptyString,
  cwd: TrimmedNonEmptyString,
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  status: TerminalSessionStatus,
  pid: Schema.NullOr(NonNegativeInt),
  hasRunningSubprocess: Schema.Boolean,
  exitCode: Schema.NullOr(Schema.Int),
  exitSignal: Schema.NullOr(Schema.Int),
  updatedAt: IsoDateTime,
});
export type DiagnosticsTerminalProcess = typeof DiagnosticsTerminalProcess.Type;

export const DiagnosticsProviderProcess = Schema.Struct({
  instanceId: ProviderInstanceId,
  driver: ProviderDriverKind,
  displayName: Schema.optional(TrimmedNonEmptyString),
  enabled: Schema.Boolean,
  installed: Schema.Boolean,
  status: ServerProviderState,
  checkedAt: IsoDateTime,
  message: Schema.optional(TrimmedNonEmptyString),
});
export type DiagnosticsProviderProcess = typeof DiagnosticsProviderProcess.Type;

export const DiagnosticsLiveProcesses = Schema.Struct({
  server: DiagnosticsServerProcess,
  terminals: Schema.Array(DiagnosticsTerminalProcess),
  providers: Schema.Array(DiagnosticsProviderProcess),
});
export type DiagnosticsLiveProcesses = typeof DiagnosticsLiveProcesses.Type;

export const DiagnosticsSpanStatus = Schema.Literals([
  "success",
  "failure",
  "interrupted",
  "error",
  "unset",
]);
export type DiagnosticsSpanStatus = typeof DiagnosticsSpanStatus.Type;

export const DiagnosticsSpanSource = Schema.Literals(["server", "browser", "unknown"]);
export type DiagnosticsSpanSource = typeof DiagnosticsSpanSource.Type;

export const DiagnosticsSpan = Schema.Struct({
  id: TrimmedNonEmptyString,
  source: DiagnosticsSpanSource,
  traceId: TrimmedNonEmptyString,
  spanId: TrimmedNonEmptyString,
  parentSpanId: Schema.optional(TrimmedNonEmptyString),
  name: TrimmedNonEmptyString,
  kind: TrimmedNonEmptyString,
  startTime: IsoDateTime,
  endTime: IsoDateTime,
  durationMs: Schema.Number,
  status: DiagnosticsSpanStatus,
  failureMessage: Schema.optional(Schema.String),
  attributes: Schema.Record(Schema.String, Schema.Unknown),
});
export type DiagnosticsSpan = typeof DiagnosticsSpan.Type;

export const DiagnosticsSpanEvent = Schema.Struct({
  traceId: TrimmedNonEmptyString,
  spanId: TrimmedNonEmptyString,
  spanName: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  time: IsoDateTime,
  attributes: Schema.Record(Schema.String, Schema.Unknown),
});
export type DiagnosticsSpanEvent = typeof DiagnosticsSpanEvent.Type;

export const DiagnosticsSpanNameSummary = Schema.Struct({
  name: TrimmedNonEmptyString,
  count: NonNegativeInt,
  failureCount: NonNegativeInt,
  totalDurationMs: Schema.Number,
  averageDurationMs: Schema.Number,
  maxDurationMs: Schema.Number,
});
export type DiagnosticsSpanNameSummary = typeof DiagnosticsSpanNameSummary.Type;

export const DiagnosticsDurationBucket = Schema.Struct({
  label: TrimmedNonEmptyString,
  minMs: NonNegativeInt,
  maxMs: Schema.optional(NonNegativeInt),
  count: NonNegativeInt,
});
export type DiagnosticsDurationBucket = typeof DiagnosticsDurationBucket.Type;

export const DiagnosticsTracing = Schema.Struct({
  retainedSpanCount: NonNegativeInt,
  recentSpans: Schema.Array(DiagnosticsSpan),
  slowestSpans: Schema.Array(DiagnosticsSpan),
  topSpanNames: Schema.Array(DiagnosticsSpanNameSummary),
  durationBuckets: Schema.Array(DiagnosticsDurationBucket),
  recentEvents: Schema.Array(DiagnosticsSpanEvent),
});
export type DiagnosticsTracing = typeof DiagnosticsTracing.Type;

export const DiagnosticsFailure = Schema.Struct({
  id: TrimmedNonEmptyString,
  occurredAt: IsoDateTime,
  source: TrimmedNonEmptyString,
  category: TrimmedNonEmptyString,
  signature: TrimmedNonEmptyString,
  message: Schema.String,
  raw: Schema.optional(Schema.Unknown),
});
export type DiagnosticsFailure = typeof DiagnosticsFailure.Type;

export const DiagnosticsFailureSummary = Schema.Struct({
  signature: TrimmedNonEmptyString,
  source: TrimmedNonEmptyString,
  category: TrimmedNonEmptyString,
  count: NonNegativeInt,
  latestAt: IsoDateTime,
  sampleMessage: Schema.String,
});
export type DiagnosticsFailureSummary = typeof DiagnosticsFailureSummary.Type;

export const DiagnosticsFailures = Schema.Struct({
  latest: Schema.Array(DiagnosticsFailure),
  common: Schema.Array(DiagnosticsFailureSummary),
});
export type DiagnosticsFailures = typeof DiagnosticsFailures.Type;

export const DiagnosticsClientSlowRpcAck = Schema.Struct({
  requestId: TrimmedNonEmptyString,
  tag: TrimmedNonEmptyString,
  startedAt: IsoDateTime,
  thresholdMs: NonNegativeInt,
});
export type DiagnosticsClientSlowRpcAck = typeof DiagnosticsClientSlowRpcAck.Type;

export const DiagnosticsClient = Schema.Struct({
  slowRpcAcks: Schema.Array(DiagnosticsClientSlowRpcAck),
});
export type DiagnosticsClient = typeof DiagnosticsClient.Type;

export const DiagnosticsLimits = Schema.Struct({
  traceRecordLimit: NonNegativeInt,
  resourceSampleLimit: NonNegativeInt,
  fileTailBytes: NonNegativeInt,
});
export type DiagnosticsLimits = typeof DiagnosticsLimits.Type;

export const DiagnosticsSnapshot = Schema.Struct({
  generatedAt: IsoDateTime,
  serverStartedAt: IsoDateTime,
  uptimeMs: NonNegativeInt,
  limits: DiagnosticsLimits,
  observability: DiagnosticsObservability,
  resources: DiagnosticsResources,
  liveProcesses: DiagnosticsLiveProcesses,
  tracing: DiagnosticsTracing,
  failures: DiagnosticsFailures,
  client: DiagnosticsClient,
  warnings: Schema.Array(DiagnosticsWarning),
});
export type DiagnosticsSnapshot = typeof DiagnosticsSnapshot.Type;

export class DiagnosticsError extends Schema.TaggedErrorClass<DiagnosticsError>()(
  "DiagnosticsError",
  {
    operation: TrimmedNonEmptyString,
    detail: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message() {
    return `Diagnostics ${this.operation} failed: ${this.detail}`;
  }
}
