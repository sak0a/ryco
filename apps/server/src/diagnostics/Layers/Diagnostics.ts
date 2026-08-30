import { open } from "node:fs/promises";
import os from "node:os";

import {
  type DiagnosticsDurationBucket,
  type DiagnosticsFailure,
  type DiagnosticsFailureSummary,
  type DiagnosticsResourceSample,
  type DiagnosticsSpan,
  type DiagnosticsSpanEvent,
  type DiagnosticsSpanNameSummary,
  type DiagnosticsTraceSinkHealth,
  type DiagnosticsWarning,
} from "@ryco/contracts";
import { Effect, Layer } from "effect";

import type { ServerConfigShape } from "../../config.ts";
import { ServerConfig } from "../../config.ts";
import type { TraceSinkHealth } from "../../observability/TraceSink.ts";
import type { TraceRecord } from "../../observability/TraceRecord.ts";
import { summarizeOperationalMetrics } from "../OperationalMetrics.ts";
import {
  Diagnostics,
  type DiagnosticsShape,
  type DiagnosticsSnapshotInput,
} from "../Services/Diagnostics.ts";

const TRACE_RECORD_LIMIT = 2_000;
const RESOURCE_SAMPLE_LIMIT = 240;
const FILE_TAIL_BYTES = 512 * 1024;
const FILE_TAIL_REFRESH_INTERVAL_MS = 30_000;
const LIST_LIMIT = 50;
const EVENT_LIMIT = 80;
const RAW_MESSAGE_LIMIT = 1_200;

const SENSITIVE_KEY_PATTERN =
  /(?:token|secret|password|authorization|api[-_]?key|cookie|session|credential)/iu;

interface RingBuffer<A> {
  readonly push: (value: A) => void;
  readonly values: () => ReadonlyArray<A>;
  readonly size: () => number;
}

function makeRingBuffer<A>(limit: number): RingBuffer<A> {
  const values: A[] = [];
  return {
    push(value) {
      values.push(value);
      if (values.length > limit) {
        values.splice(0, values.length - limit);
      }
    },
    values: () => [...values],
    size: () => values.length,
  };
}

interface ResourceSampler {
  readonly sample: () => Promise<DiagnosticsResourceSample>;
  readonly history: () => ReadonlyArray<DiagnosticsResourceSample>;
}

function makeResourceSampler(): ResourceSampler {
  const samples = makeRingBuffer<DiagnosticsResourceSample>(RESOURCE_SAMPLE_LIMIT);
  const startedAtMs = Date.now();
  const cpuCount = Math.max(1, os.cpus().length);
  let lastCpu = process.cpuUsage();
  let lastSampledAtMs = startedAtMs;
  let inFlightSample: Promise<DiagnosticsResourceSample> | null = null;

  const sampleOnce = async () => {
    const eventLoopStartedAt = performance.now();
    await new Promise<void>((resolve) => {
      const timeoutId = setTimeout(resolve, 0);
      timeoutId.unref?.();
    });
    const eventLoopDelayMs = Math.max(0, performance.now() - eventLoopStartedAt);
    const nowMs = Date.now();
    const memory = process.memoryUsage();
    const cpu = process.cpuUsage();
    const cpuDelta = process.cpuUsage(lastCpu);
    const elapsedMicros = Math.max(1, (nowMs - lastSampledAtMs) * 1_000);
    const busyMicros = cpuDelta.user + cpuDelta.system;
    const utilizationPercent = Math.max(
      0,
      Math.min(100, (busyMicros / (elapsedMicros * cpuCount)) * 100),
    );
    lastCpu = cpu;
    lastSampledAtMs = nowMs;

    const next = {
      sampledAt: new Date(nowMs).toISOString(),
      uptimeMs: Math.max(0, Math.round(process.uptime() * 1_000)),
      memory: {
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
        heapTotalBytes: memory.heapTotal,
        externalBytes: memory.external,
        arrayBuffersBytes: memory.arrayBuffers,
      },
      cpu: {
        userMicros: cpu.user,
        systemMicros: cpu.system,
        utilizationPercent,
      },
      eventLoopDelayMs,
    } satisfies DiagnosticsResourceSample;
    samples.push(next);
    return next;
  };

  return {
    sample() {
      if (inFlightSample !== null) {
        return inFlightSample;
      }
      const pending = sampleOnce();
      inFlightSample = pending;
      const clearInFlight = () => {
        if (inFlightSample === pending) inFlightSample = null;
      };
      void pending.then(clearInFlight, clearInFlight);
      return pending;
    },
    history: samples.values,
  };
}

export function redactDiagnosticValue(value: unknown, depth = 0, keyHint = ""): unknown {
  if (SENSITIVE_KEY_PATTERN.test(keyHint)) {
    return "[redacted]";
  }
  if (depth >= 8) {
    return "[truncated]";
  }
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "string") {
    return SENSITIVE_KEY_PATTERN.test(value) ? "[redacted]" : value.slice(0, RAW_MESSAGE_LIMIT);
  }
  if (typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => redactDiagnosticValue(item, depth + 1, keyHint));
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>).slice(0, 100)) {
    redacted[key] = redactDiagnosticValue(child, depth + 1, key);
  }
  return redacted;
}

function truncateMessage(value: string): string {
  return value.length <= RAW_MESSAGE_LIMIT ? value : `${value.slice(0, RAW_MESSAGE_LIMIT)}...`;
}

function toIsoFromUnixNano(value: string): string {
  try {
    const millis = BigInt(value) / 1_000_000n;
    return new Date(Number(millis)).toISOString();
  } catch {
    return new Date(0).toISOString();
  }
}

function normalizeOtlpSpanStatus(code: string | undefined): DiagnosticsSpan["status"] {
  if (!code) return "success";
  if (code === "2" || code === "STATUS_CODE_ERROR") return "error";
  if (code === "1" || code === "STATUS_CODE_OK") return "success";
  if (code === "0" || code === "STATUS_CODE_UNSET") return "unset";
  return "success";
}

function normalizeSpanSource(record: TraceRecord): DiagnosticsSpan["source"] {
  if (record.type === "effect-span") {
    return "server";
  }
  const resourceAttributes = record.resourceAttributes ?? {};
  const serviceRuntime = resourceAttributes["service.runtime"];
  const serviceName = resourceAttributes["service.name"];
  if (serviceRuntime === "ryco-web" || serviceName === "ryco-web") {
    return "browser";
  }
  if (serviceRuntime === "ryco-server" || serviceName === "ryco-server") {
    return "server";
  }
  return "unknown";
}

function normalizeSpanStatus(record: TraceRecord): DiagnosticsSpan["status"] {
  if (record.type === "effect-span") {
    const exit = record.exit;
    if (!exit || exit._tag === "Success") return "success";
    if (exit._tag === "Interrupted") return "interrupted";
    return "failure";
  }
  return normalizeOtlpSpanStatus(record.status?.code);
}

function spanFailureMessage(record: TraceRecord): string | undefined {
  if (record.type === "effect-span") {
    const exit = record.exit;
    if (exit?._tag === "Failure") {
      return truncateMessage(exit.cause);
    }
    return undefined;
  }
  if (record.type === "otlp-span" && record.status?.message) {
    return truncateMessage(record.status.message);
  }
  return undefined;
}

function toDiagnosticsSpan(record: TraceRecord): DiagnosticsSpan {
  const failureMessage = spanFailureMessage(record);
  return {
    id: `${record.traceId}:${record.spanId}`,
    source: normalizeSpanSource(record),
    traceId: record.traceId,
    spanId: record.spanId,
    ...(record.parentSpanId ? { parentSpanId: record.parentSpanId } : {}),
    name: record.name.trim() || "(unnamed span)",
    kind: record.kind?.trim() || "unknown",
    startTime: toIsoFromUnixNano(record.startTimeUnixNano),
    endTime: toIsoFromUnixNano(record.endTimeUnixNano),
    durationMs: Math.max(0, record.durationMs),
    status: normalizeSpanStatus(record),
    ...(failureMessage ? { failureMessage } : {}),
    attributes: redactDiagnosticValue(record.attributes ?? {}) as Record<string, unknown>,
  };
}

function safeToDiagnosticsSpan(record: TraceRecord): DiagnosticsSpan | null {
  try {
    return toDiagnosticsSpan(record);
  } catch {
    return null;
  }
}

function toDiagnosticsSpanEvents(
  records: ReadonlyArray<TraceRecord>,
): ReadonlyArray<DiagnosticsSpanEvent> {
  return records
    .flatMap((record) => {
      const events = record.events ?? [];
      return events.map((event) => ({
        traceId: record.traceId,
        spanId: record.spanId,
        spanName: record.name.trim() || "(unnamed span)",
        name: event.name.trim() || "(unnamed event)",
        time: toIsoFromUnixNano(event.timeUnixNano),
        attributes: redactDiagnosticValue(event.attributes ?? {}) as Record<string, unknown>,
      }));
    })
    .toSorted((left, right) => right.time.localeCompare(left.time))
    .slice(0, EVENT_LIMIT);
}

function buildTopSpanNames(
  spans: ReadonlyArray<DiagnosticsSpan>,
): ReadonlyArray<DiagnosticsSpanNameSummary> {
  const byName = new Map<
    string,
    {
      count: number;
      failureCount: number;
      totalDurationMs: number;
      maxDurationMs: number;
    }
  >();

  for (const span of spans) {
    const current =
      byName.get(span.name) ??
      ({
        count: 0,
        failureCount: 0,
        totalDurationMs: 0,
        maxDurationMs: 0,
      } satisfies {
        count: number;
        failureCount: number;
        totalDurationMs: number;
        maxDurationMs: number;
      });
    current.count += 1;
    current.totalDurationMs += span.durationMs;
    current.maxDurationMs = Math.max(current.maxDurationMs, span.durationMs);
    if (span.status === "failure" || span.status === "error") {
      current.failureCount += 1;
    }
    byName.set(span.name, current);
  }

  return [...byName.entries()]
    .map(([name, value]) => ({
      name,
      count: value.count,
      failureCount: value.failureCount,
      totalDurationMs: value.totalDurationMs,
      averageDurationMs: value.count === 0 ? 0 : value.totalDurationMs / value.count,
      maxDurationMs: value.maxDurationMs,
    }))
    .toSorted((left, right) => right.count - left.count || right.maxDurationMs - left.maxDurationMs)
    .slice(0, LIST_LIMIT);
}

function buildDurationBuckets(
  spans: ReadonlyArray<DiagnosticsSpan>,
): ReadonlyArray<DiagnosticsDurationBucket> {
  const buckets: Array<{
    label: string;
    minMs: number;
    maxMs?: number;
    count: number;
    maxExclusive?: number;
  }> = [
    { label: "<10ms", minMs: 0, maxMs: 10, count: 0, maxExclusive: 10 },
    { label: "10-100ms", minMs: 10, maxMs: 100, count: 0, maxExclusive: 100 },
    { label: "100ms-1s", minMs: 100, maxMs: 1_000, count: 0, maxExclusive: 1_000 },
    { label: "1s-10s", minMs: 1_000, maxMs: 10_000, count: 0, maxExclusive: 10_000 },
    { label: ">=10s", minMs: 10_000, count: 0 },
  ];

  for (const span of spans) {
    const bucket = buckets.find((candidate) =>
      candidate.maxExclusive === undefined
        ? span.durationMs >= candidate.minMs
        : span.durationMs >= candidate.minMs && span.durationMs < candidate.maxExclusive,
    );
    if (bucket) {
      bucket.count += 1;
    }
  }

  return buckets.map(({ maxExclusive: _maxExclusive, ...bucket }) => bucket);
}

function normalizeSignature(value: string): string {
  const compact = value
    .toLowerCase()
    .replace(/[0-9a-f]{8,}/giu, "<hex>")
    .replace(/\b\d+\b/gu, "<n>")
    .replace(/\s+/gu, " ")
    .trim();
  return compact.slice(0, 180) || "unknown failure";
}

function failureFromSpan(span: DiagnosticsSpan): DiagnosticsFailure | null {
  if (span.status !== "failure" && span.status !== "error") {
    return null;
  }
  const message = span.failureMessage ?? `${span.name} failed`;
  return {
    id: `span:${span.id}`,
    occurredAt: span.endTime,
    source: span.source,
    category: "span",
    signature: normalizeSignature(`${span.name}:${message}`),
    message,
    raw: redactDiagnosticValue(span),
  };
}

function failureFromLogLine(input: {
  readonly line: string;
  readonly source: string;
  readonly fallbackTime: string;
}): DiagnosticsFailure | null {
  const line = input.line.trim();
  if (!/(?:\berror\b|\bfailed\b|\bfailure\b|\bexception\b)/iu.test(line)) {
    return null;
  }
  const timestamp = line.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/u)?.[0];
  const message = truncateMessage(line);
  return {
    id: `log:${input.source}:${normalizeSignature(line).slice(0, 80)}`,
    occurredAt: timestamp ?? input.fallbackTime,
    source: input.source,
    category: "log",
    signature: normalizeSignature(line),
    message,
    raw: redactDiagnosticValue({ line: message, source: input.source }),
  };
}

function buildFailureSummary(
  failures: ReadonlyArray<DiagnosticsFailure>,
): ReadonlyArray<DiagnosticsFailureSummary> {
  const bySignature = new Map<
    string,
    {
      source: string;
      category: string;
      count: number;
      latestAt: string;
      sampleMessage: string;
    }
  >();

  for (const failure of failures) {
    const current =
      bySignature.get(failure.signature) ??
      ({
        source: failure.source,
        category: failure.category,
        count: 0,
        latestAt: failure.occurredAt,
        sampleMessage: failure.message,
      } satisfies {
        source: string;
        category: string;
        count: number;
        latestAt: string;
        sampleMessage: string;
      });
    current.count += 1;
    if (failure.occurredAt.localeCompare(current.latestAt) > 0) {
      current.latestAt = failure.occurredAt;
      current.sampleMessage = failure.message;
      current.source = failure.source;
      current.category = failure.category;
    }
    bySignature.set(failure.signature, current);
  }

  return [...bySignature.entries()]
    .map(([signature, value]) => ({
      signature,
      source: value.source,
      category: value.category,
      count: value.count,
      latestAt: value.latestAt,
      sampleMessage: value.sampleMessage,
    }))
    .toSorted(
      (left, right) => right.count - left.count || right.latestAt.localeCompare(left.latestAt),
    )
    .slice(0, LIST_LIMIT);
}

async function readFileTail(filePath: string, maxBytes: number): Promise<string> {
  const handle = await open(filePath, "r");
  try {
    const stat = await handle.stat();
    const length = Math.min(stat.size, maxBytes);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, Math.max(0, stat.size - length));
    return buffer.toString("utf8");
  } finally {
    await handle.close();
  }
}

function parseTraceRecordLine(line: string): TraceRecord | null {
  try {
    const parsed = JSON.parse(line) as Partial<TraceRecord>;
    if (
      (parsed.type === "effect-span" || parsed.type === "otlp-span") &&
      typeof parsed.name === "string" &&
      typeof parsed.traceId === "string" &&
      typeof parsed.spanId === "string" &&
      typeof parsed.startTimeUnixNano === "string" &&
      typeof parsed.endTimeUnixNano === "string" &&
      typeof parsed.durationMs === "number"
    ) {
      return parsed as TraceRecord;
    }
  } catch {
    return null;
  }
  return null;
}

async function readTraceTail(input: {
  readonly filePath: string;
  readonly warnings: DiagnosticsWarning[];
}): Promise<ReadonlyArray<TraceRecord>> {
  let tail = "";
  try {
    tail = await readFileTail(input.filePath, FILE_TAIL_BYTES);
  } catch (error) {
    input.warnings.push({
      code: "diagnostics.trace-tail-unavailable",
      source: "trace-file",
      message: error instanceof Error ? error.message : "Unable to read trace tail.",
    });
    return [];
  }

  const records: TraceRecord[] = [];
  let malformed = 0;
  for (const line of tail.split(/\r?\n/gu)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const record = parseTraceRecordLine(trimmed);
    if (record) {
      records.push(record);
    } else {
      malformed += 1;
    }
  }
  if (malformed > 0) {
    input.warnings.push({
      code: "diagnostics.trace-tail-malformed-lines",
      source: "trace-file",
      message: "Some trace records in the retained tail could not be parsed.",
      count: malformed,
    });
  }
  return records;
}

async function readFailureLogTail(input: {
  readonly filePath: string;
  readonly source: string;
  readonly fallbackTime: string;
  readonly warnings: DiagnosticsWarning[];
}): Promise<ReadonlyArray<DiagnosticsFailure>> {
  let tail = "";
  try {
    tail = await readFileTail(input.filePath, FILE_TAIL_BYTES);
  } catch (error) {
    input.warnings.push({
      code: "diagnostics.log-tail-unavailable",
      source: input.source,
      message: error instanceof Error ? error.message : "Unable to read log tail.",
    });
    return [];
  }

  return tail
    .split(/\r?\n/gu)
    .flatMap(
      (line) =>
        failureFromLogLine({
          line,
          source: input.source,
          fallbackTime: input.fallbackTime,
        }) ?? [],
    )
    .slice(-LIST_LIMIT);
}

function dedupeTraceRecords(records: ReadonlyArray<TraceRecord>): ReadonlyArray<TraceRecord> {
  const byId = new Map<string, TraceRecord>();
  for (const record of records) {
    byId.set(`${record.traceId}:${record.spanId}`, record);
  }
  return [...byId.values()];
}

function readTraceSinkHealth(
  reader: (() => TraceSinkHealth) | undefined,
): DiagnosticsTraceSinkHealth | null {
  if (reader === undefined) return null;
  try {
    return reader();
  } catch {
    return null;
  }
}

function buildOperationalPerformance(input: {
  readonly snapshotInput: DiagnosticsSnapshotInput;
  readonly generatedAt: string;
  readonly snapshotStartedAt: number;
  readonly traceSinkHealth: (() => TraceSinkHealth) | undefined;
}) {
  return {
    local: input.snapshotInput.localMetrics ?? {
      turnQuiescenceAvgMs: null,
      checkpointDurationP95Ms: null,
      latestThreadSnapshotDurationMs: null,
      threadSnapshotDurationP95Ms: null,
      wsReconnectCount: 0,
      windowSampleCounts: {
        turnQuiescence: 0,
        checkpointDuration: 0,
        threadSnapshotDuration: 0,
      },
      capturedAt: input.generatedAt,
    },
    queues: summarizeOperationalMetrics(input.snapshotInput.metricSnapshots ?? []),
    traceSink: readTraceSinkHealth(input.traceSinkHealth),
    snapshotCollectionDurationMs: Math.max(0, performance.now() - input.snapshotStartedAt),
  };
}

export const makeDiagnosticsService = Effect.fn("makeDiagnosticsService")(
  (
    config: ServerConfigShape,
    dependencies?: {
      readonly traceSinkHealth?: () => TraceSinkHealth;
    },
  ) =>
    Effect.sync(() => {
      const serverStartedAtMs = Date.now();
      const serverStartedAt = new Date(serverStartedAtMs).toISOString();
      const traceRecords = makeRingBuffer<TraceRecord>(TRACE_RECORD_LIMIT);
      const resourceSampler = makeResourceSampler();
      let persistedDiagnosticsCache:
        | {
            readonly expiresAt: number;
            readonly traceRecords: ReadonlyArray<TraceRecord>;
            readonly failures: ReadonlyArray<DiagnosticsFailure>;
            readonly warnings: ReadonlyArray<DiagnosticsWarning>;
          }
        | undefined;

      const readPersistedDiagnostics = async (fallbackTime: string) => {
        const now = Date.now();
        if (persistedDiagnosticsCache !== undefined && persistedDiagnosticsCache.expiresAt > now) {
          return persistedDiagnosticsCache;
        }

        const warnings: DiagnosticsWarning[] = [];
        const traceTail = await readTraceTail({
          filePath: config.serverTracePath,
          warnings,
        });
        const failures = [
          ...(await readFailureLogTail({
            filePath: config.serverLogPath,
            source: "server.log",
            fallbackTime,
            warnings,
          })),
          ...(await readFailureLogTail({
            filePath: config.providerEventLogPath,
            source: "provider-events.log",
            fallbackTime,
            warnings,
          })),
        ];
        persistedDiagnosticsCache = {
          expiresAt: now + FILE_TAIL_REFRESH_INTERVAL_MS,
          traceRecords: traceTail,
          failures,
          warnings,
        };
        return persistedDiagnosticsCache;
      };

      return {
        recordTraceRecords(records) {
          for (const record of records) {
            traceRecords.push(record);
          }
        },
        getSnapshot(input) {
          const snapshotStartedAt = performance.now();
          return Effect.tryPromise(async () => {
            const generatedAt = new Date().toISOString();
            const currentResource = await resourceSampler.sample();
            const persistedDiagnostics = await readPersistedDiagnostics(generatedAt);
            const warnings = [...persistedDiagnostics.warnings];
            const allTraceRecords = dedupeTraceRecords([
              ...persistedDiagnostics.traceRecords,
              ...traceRecords.values(),
            ]);
            let skippedSpanRecords = 0;
            const spans = allTraceRecords
              .flatMap((record) => {
                const span = safeToDiagnosticsSpan(record);
                if (span === null) {
                  skippedSpanRecords += 1;
                  return [];
                }
                return [span];
              })
              .toSorted((left, right) => right.endTime.localeCompare(left.endTime));
            if (skippedSpanRecords > 0) {
              warnings.push({
                code: "diagnostics.trace-records-skipped",
                message: `Skipped ${skippedSpanRecords} malformed trace record(s).`,
              });
            }
            const failuresFromSpans = spans.flatMap((span) => failureFromSpan(span) ?? []);
            const failuresFromLogs = persistedDiagnostics.failures;
            const latestFailures = [...failuresFromSpans, ...failuresFromLogs]
              .toSorted((left, right) => right.occurredAt.localeCompare(left.occurredAt))
              .slice(0, LIST_LIMIT);
            const resourceHistory = resourceSampler.history();

            return {
              generatedAt,
              serverStartedAt,
              uptimeMs: Math.max(0, Date.now() - serverStartedAtMs),
              limits: {
                traceRecordLimit: TRACE_RECORD_LIMIT,
                resourceSampleLimit: RESOURCE_SAMPLE_LIMIT,
                fileTailBytes: FILE_TAIL_BYTES,
              },
              observability: {
                logsDirectoryPath: config.logsDir,
                serverLogPath: config.serverLogPath,
                serverTracePath: config.serverTracePath,
                providerEventLogPath: config.providerEventLogPath,
                localTracingEnabled: true,
                ...(config.otlpTracesUrl !== undefined
                  ? { otlpTracesUrl: config.otlpTracesUrl }
                  : {}),
                otlpTracesEnabled: config.otlpTracesUrl !== undefined,
                ...(config.otlpMetricsUrl !== undefined
                  ? { otlpMetricsUrl: config.otlpMetricsUrl }
                  : {}),
                otlpMetricsEnabled: config.otlpMetricsUrl !== undefined,
              },
              resources: {
                current: currentResource,
                history: resourceHistory,
              },
              liveProcesses: {
                server: {
                  pid: process.pid,
                  platform: process.platform,
                  runtime: typeof Bun !== "undefined" ? "bun" : "node",
                  version: typeof Bun !== "undefined" ? Bun.version : process.versions.node,
                  cwd: config.cwd,
                },
                terminals: [...input.terminals],
                providers: [...input.providers],
              },
              tracing: {
                retainedSpanCount: allTraceRecords.length,
                recentSpans: spans.slice(0, LIST_LIMIT),
                slowestSpans: [...spans]
                  .toSorted((left, right) => right.durationMs - left.durationMs)
                  .slice(0, LIST_LIMIT),
                topSpanNames: buildTopSpanNames(spans),
                durationBuckets: buildDurationBuckets(spans),
                recentEvents: toDiagnosticsSpanEvents(allTraceRecords),
              },
              failures: {
                latest: latestFailures,
                common: buildFailureSummary([...failuresFromSpans, ...failuresFromLogs]),
              },
              client: {
                slowRpcAcks: [],
              },
              performance: buildOperationalPerformance({
                snapshotInput: input,
                generatedAt,
                snapshotStartedAt,
                traceSinkHealth: dependencies?.traceSinkHealth,
              }),
              warnings,
            };
          }).pipe(
            Effect.catch((error) =>
              Effect.promise(async () => {
                const generatedAt = new Date().toISOString();
                const currentResource = await resourceSampler.sample();
                return {
                  generatedAt,
                  serverStartedAt,
                  uptimeMs: Math.max(0, Date.now() - serverStartedAtMs),
                  limits: {
                    traceRecordLimit: TRACE_RECORD_LIMIT,
                    resourceSampleLimit: RESOURCE_SAMPLE_LIMIT,
                    fileTailBytes: FILE_TAIL_BYTES,
                  },
                  observability: {
                    logsDirectoryPath: config.logsDir,
                    serverLogPath: config.serverLogPath,
                    serverTracePath: config.serverTracePath,
                    providerEventLogPath: config.providerEventLogPath,
                    localTracingEnabled: true,
                    ...(config.otlpTracesUrl !== undefined
                      ? { otlpTracesUrl: config.otlpTracesUrl }
                      : {}),
                    otlpTracesEnabled: config.otlpTracesUrl !== undefined,
                    ...(config.otlpMetricsUrl !== undefined
                      ? { otlpMetricsUrl: config.otlpMetricsUrl }
                      : {}),
                    otlpMetricsEnabled: config.otlpMetricsUrl !== undefined,
                  },
                  resources: {
                    current: currentResource,
                    history: resourceSampler.history(),
                  },
                  liveProcesses: {
                    server: {
                      pid: process.pid,
                      platform: process.platform,
                      runtime: typeof Bun !== "undefined" ? "bun" : "node",
                      version: typeof Bun !== "undefined" ? Bun.version : process.versions.node,
                      cwd: config.cwd,
                    },
                    terminals: [...input.terminals],
                    providers: [...input.providers],
                  },
                  tracing: {
                    retainedSpanCount: traceRecords.size(),
                    recentSpans: [],
                    slowestSpans: [],
                    topSpanNames: [],
                    durationBuckets: buildDurationBuckets([]),
                    recentEvents: [],
                  },
                  failures: {
                    latest: [],
                    common: [],
                  },
                  client: {
                    slowRpcAcks: [],
                  },
                  performance: buildOperationalPerformance({
                    snapshotInput: input,
                    generatedAt,
                    snapshotStartedAt,
                    traceSinkHealth: dependencies?.traceSinkHealth,
                  }),
                  warnings: [
                    {
                      code: "diagnostics.snapshot-partial",
                      message:
                        error instanceof Error
                          ? error.message
                          : "Diagnostics snapshot was partially collected.",
                    },
                  ],
                };
              }),
            ),
          );
        },
      } satisfies DiagnosticsShape;
    }),
);

export const DiagnosticsLive = Layer.effect(
  Diagnostics,
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    return yield* makeDiagnosticsService(config);
  }),
);
