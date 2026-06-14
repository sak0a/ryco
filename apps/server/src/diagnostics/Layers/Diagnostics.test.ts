import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import type { ServerConfigShape } from "../../config.ts";
import type { EffectTraceRecord } from "../../observability/TraceRecord.ts";
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

  it.effect("aggregates retained traces into diagnostics snapshots", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ryco-diag-"));
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
          secretsDir: path.join(tempDir, "secrets"),
        } satisfies ServerConfigShape;
        fs.writeFileSync(config.serverTracePath, "");
        fs.writeFileSync(config.serverLogPath, "2026-06-14T12:00:00.000Z error log failure\n");
        fs.writeFileSync(config.providerEventLogPath, "");

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
});
