import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { vi } from "vite-plus/test";

import type { ServerConfigShape } from "../../config.ts";
import type { EffectTraceRecord, TraceRecord } from "../../observability/TraceRecord.ts";
import { makeDiagnosticsService, redactDiagnosticValue } from "./Diagnostics.ts";

const makeTraceRecord = (): EffectTraceRecord => ({
  type: "effect-span",
  name: "server.rpc.failure",
  traceId: "trace-diagnostics",
  spanId: "span-diagnostics",
  sampled: true,
  kind: "internal",
  startTimeUnixNano: "1700000000000000000",
  endTimeUnixNano: "1700000001000000000",
  durationMs: 1_000,
  attributes: {
    apiToken: "secret-token-value",
    route: "server.getDiagnosticsSnapshot",
  },
  events: [
    {
      name: "log",
      timeUnixNano: "1700000000500000000",
      attributes: {
        authorization: "Bearer secret-token-value",
      },
    },
  ],
  links: [],
  exit: {
    _tag: "Failure",
    cause: "Error: simulated diagnostic failure",
  },
});

const makeOtlpErrorRecord = (): TraceRecord => ({
  type: "otlp-span",
  name: "browser.fetch.failure",
  traceId: "trace-browser",
  spanId: "span-browser",
  sampled: true,
  kind: "internal",
  startTimeUnixNano: "1700000000000000000",
  endTimeUnixNano: "1700000001000000000",
  durationMs: 1_000,
  attributes: {},
  events: [],
  links: [],
  resourceAttributes: {
    "service.name": "ryco-web",
  },
  scope: {
    attributes: {},
  },
  status: {
    code: "STATUS_CODE_ERROR",
    message: "Network error",
  },
});

const makeMalformedEffectSpanRecord = (): TraceRecord =>
  ({
    type: "effect-span",
    traceId: "trace-partial",
    spanId: "span-partial",
    sampled: true,
    kind: "internal",
    startTimeUnixNano: "1700000000000000000",
    endTimeUnixNano: "1700000001000000000",
    durationMs: 1_000,
    links: [],
  }) as unknown as TraceRecord;

const makeDiagnosticsConfig = (tempDir: string): ServerConfigShape => {
  const logsDir = path.join(tempDir, "logs");
  const providerLogsDir = path.join(logsDir, "provider");
  fs.mkdirSync(providerLogsDir, { recursive: true });
  const config = {
    logLevel: "Error",
    traceMinLevel: "Info",
    traceTimingEnabled: true,
    traceBatchWindowMs: 200,
    traceMaxBytes: 1024,
    traceMaxFiles: 2,
    otlpTracesUrl: undefined,
    otlpMetricsUrl: undefined,
    otlpExportIntervalMs: 10_000,
    otlpServiceName: "ryco-server",
    mode: "web",
    port: 0,
    host: undefined,
    cwd: process.cwd(),
    baseDir: tempDir,
    staticDir: undefined,
    devUrl: undefined,
    noBrowser: true,
    startupPresentation: "headless",
    desktopBootstrapToken: undefined,
    autoBootstrapProjectFromCwd: false,
    logWebSocketEvents: false,
    tailscaleServeEnabled: false,
    tailscaleServePort: 443,
    stateDir: tempDir,
    dbPath: path.join(tempDir, "state.sqlite"),
    keybindingsConfigPath: path.join(tempDir, "keybindings.json"),
    settingsPath: path.join(tempDir, "settings.json"),
    providerStatusCacheDir: path.join(tempDir, "caches"),
    worktreesDir: path.join(tempDir, "worktrees"),
    attachmentsDir: path.join(tempDir, "attachments"),
    logsDir,
    serverLogPath: path.join(logsDir, "server.log"),
    serverTracePath: path.join(logsDir, "server.trace.ndjson"),
    providerLogsDir,
    providerEventLogPath: path.join(providerLogsDir, "events.log"),
    terminalLogsDir: path.join(logsDir, "terminals"),
    anonymousIdPath: path.join(tempDir, "anonymous-id"),
    environmentIdPath: path.join(tempDir, "environment-id"),
    serverRuntimeStatePath: path.join(tempDir, "server-runtime.json"),
    hubIdentityStatePath: path.join(tempDir, "hub-identity.json"),
    secretsDir: path.join(tempDir, "secrets"),
  } satisfies ServerConfigShape;
  fs.writeFileSync(config.serverTracePath, "");
  fs.writeFileSync(config.serverLogPath, "2026-06-14T12:00:00.000Z error log failure\n");
  fs.writeFileSync(config.providerEventLogPath, "");
  return config;
};

describe("Diagnostics", () => {
  it("redacts nested sensitive values", () => {
    assert.deepStrictEqual(
      redactDiagnosticValue({
        nested: {
          password: "hunter2",
          visible: "ok",
        },
        authorization: "Bearer token",
      }),
      {
        nested: {
          password: "[redacted]",
          visible: "ok",
        },
        authorization: "[redacted]",
      },
    );
  });

  it.effect("samples resources only while a diagnostics snapshot is requested", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ryco-diag-"));
        const config = makeDiagnosticsConfig(tempDir);
        const setIntervalSpy = vi.spyOn(globalThis, "setInterval");

        try {
          const diagnostics = yield* makeDiagnosticsService(config);
          assert.equal(setIntervalSpy.mock.calls.length, 0);

          const first = yield* diagnostics.getSnapshot({ providers: [], terminals: [] });
          assert.equal(first.resources.history.length, 1);
          assert.equal(first.resources.current, first.resources.history[0]);
          assert.equal(setIntervalSpy.mock.calls.length, 0);

          fs.appendFileSync(
            config.serverLogPath,
            "2026-08-02T00:00:00.000Z error cached-second-failure\n",
          );
          const second = yield* diagnostics.getSnapshot({ providers: [], terminals: [] });
          assert.equal(second.resources.history.length, 2);
          assert.equal(second.resources.current, second.resources.history[1]);
          assert.equal(setIntervalSpy.mock.calls.length, 0);
          assert.equal(
            second.failures.latest.some((failure) =>
              failure.message.includes("cached-second-failure"),
            ),
            false,
          );
        } finally {
          setIntervalSpy.mockRestore();
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
      }),
    ),
  );

  it.effect("includes bounded local timing and trace persistence health", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ryco-diag-"));
        const config = makeDiagnosticsConfig(tempDir);

        try {
          const diagnostics = yield* makeDiagnosticsService(config, {
            traceSinkHealth: () => ({
              bufferedBytes: 128,
              bufferedRecords: 1,
              maxBufferedBytes: 1_024,
              maxBufferedRecords: 50,
              droppedRecords: 2,
              writeFailures: 3,
              retryDelayMs: 500,
              lastWriteFailureAt: "2026-08-02T00:00:00.000Z",
            }),
          });
          const snapshot = yield* diagnostics.getSnapshot({
            providers: [],
            terminals: [],
            localMetrics: {
              turnQuiescenceAvgMs: 120,
              checkpointDurationP95Ms: 250,
              latestThreadSnapshotDurationMs: 40,
              threadSnapshotDurationP95Ms: 80,
              wsReconnectCount: 2,
              windowSampleCounts: {
                turnQuiescence: 3,
                checkpointDuration: 4,
                threadSnapshotDuration: 5,
              },
              capturedAt: "2026-08-02T00:00:00.000Z",
            },
          });

          if (snapshot.performance === undefined) {
            return assert.fail("Expected operational performance diagnostics");
          }
          assert.equal(snapshot.performance.local.latestThreadSnapshotDurationMs, 40);
          assert.equal(snapshot.performance.local.wsReconnectCount, 2);
          assert.equal(snapshot.performance.traceSink?.bufferedBytes, 128);
          assert.equal(snapshot.performance.traceSink?.droppedRecords, 2);
          assert.equal(snapshot.performance.snapshotCollectionDurationMs >= 0, true);
        } finally {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
      }),
    ),
  );

  it.effect("aggregates retained traces into diagnostics snapshots", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ryco-diag-"));
        const config = makeDiagnosticsConfig(tempDir);

        const diagnostics = yield* makeDiagnosticsService(config);
        diagnostics.recordTraceRecords([makeTraceRecord()]);
        const snapshot = yield* diagnostics.getSnapshot({
          providers: [],
          terminals: [],
        });

        assert.equal(snapshot.tracing.retainedSpanCount, 1);
        assert.equal(snapshot.tracing.slowestSpans[0]?.name, "server.rpc.failure");
        assert.equal(snapshot.tracing.slowestSpans[0]?.attributes.apiToken, "[redacted]");
        assert.equal(snapshot.tracing.recentEvents[0]?.attributes.authorization, "[redacted]");
        assert.equal(snapshot.failures.latest.length >= 1, true);
        assert.equal(snapshot.failures.common.length >= 1, true);
        fs.rmSync(tempDir, { recursive: true, force: true });
      }),
    ),
  );

  it.effect("maps OTLP STATUS_CODE_ERROR spans to failures", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ryco-diag-"));
        const config = makeDiagnosticsConfig(tempDir);

        const diagnostics = yield* makeDiagnosticsService(config);
        diagnostics.recordTraceRecords([makeOtlpErrorRecord()]);
        const snapshot = yield* diagnostics.getSnapshot({
          providers: [],
          terminals: [],
        });

        assert.equal(snapshot.tracing.recentSpans[0]?.status, "error");
        assert.equal(snapshot.tracing.recentSpans[0]?.source, "browser");
        assert.equal(
          snapshot.failures.latest.some((failure) => failure.message.includes("Network error")),
          true,
        );
        fs.rmSync(tempDir, { recursive: true, force: true });
      }),
    ),
  );

  it.effect("skips malformed trace records without emptying tracing", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ryco-diag-"));
        const config = makeDiagnosticsConfig(tempDir);

        const diagnostics = yield* makeDiagnosticsService(config);
        diagnostics.recordTraceRecords([makeTraceRecord(), makeMalformedEffectSpanRecord()]);
        const snapshot = yield* diagnostics.getSnapshot({
          providers: [],
          terminals: [],
        });

        assert.equal(snapshot.tracing.retainedSpanCount, 2);
        assert.equal(snapshot.tracing.recentSpans.length, 1);
        assert.equal(snapshot.tracing.recentSpans[0]?.name, "server.rpc.failure");
        assert.equal(
          snapshot.warnings.some((warning) => warning.code === "diagnostics.trace-records-skipped"),
          true,
        );
        fs.rmSync(tempDir, { recursive: true, force: true });
      }),
    ),
  );
});
