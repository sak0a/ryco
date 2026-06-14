import { Schema } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { DiagnosticsSnapshot } from "./diagnostics.ts";

const decodeDiagnosticsSnapshot = Schema.decodeUnknownSync(DiagnosticsSnapshot);

describe("DiagnosticsSnapshot", () => {
  it("decodes a bounded diagnostics payload", () => {
    const parsed = decodeDiagnosticsSnapshot({
      generatedAt: "2026-06-14T12:00:00.000Z",
      serverStartedAt: "2026-06-14T11:00:00.000Z",
      uptimeMs: 3_600_000,
      limits: {
        traceRecordLimit: 2_000,
        resourceSampleLimit: 240,
        fileTailBytes: 524_288,
      },
      observability: {
        logsDirectoryPath: "/tmp/ryco/logs",
        serverLogPath: "/tmp/ryco/logs/server.log",
        serverTracePath: "/tmp/ryco/logs/server.trace.ndjson",
        providerEventLogPath: "/tmp/ryco/logs/provider/events.log",
        localTracingEnabled: true,
        otlpTracesEnabled: false,
        otlpMetricsEnabled: false,
      },
      resources: {
        current: {
          sampledAt: "2026-06-14T12:00:00.000Z",
          uptimeMs: 3_600_000,
          memory: {
            rssBytes: 1024,
            heapUsedBytes: 512,
            heapTotalBytes: 1024,
            externalBytes: 0,
            arrayBuffersBytes: 0,
          },
          cpu: {
            userMicros: 100,
            systemMicros: 50,
            utilizationPercent: 2.5,
          },
          eventLoopDelayMs: 1.2,
        },
        history: [],
      },
      liveProcesses: {
        server: {
          pid: 123,
          platform: "darwin",
          runtime: "bun",
          version: "1.3.11",
          cwd: "/repo",
        },
        terminals: [],
        providers: [
          {
            instanceId: "codex",
            driver: "codex",
            enabled: true,
            installed: true,
            status: "ready",
            checkedAt: "2026-06-14T12:00:00.000Z",
          },
        ],
      },
      tracing: {
        retainedSpanCount: 1,
        recentSpans: [],
        slowestSpans: [],
        topSpanNames: [],
        durationBuckets: [],
        recentEvents: [],
      },
      failures: {
        latest: [],
        common: [],
      },
      client: {
        slowRpcAcks: [],
      },
      warnings: [],
    });

    expect(parsed.liveProcesses.providers[0]?.instanceId).toBe("codex");
    expect(parsed.resources.current.cpu.utilizationPercent).toBe(2.5);
  });
});
