import { describe, expect, it } from "vite-plus/test";

import type { EnvironmentId, ServerProvider } from "@ryco/contracts";

import {
  buildDiagnosticsBundle,
  formatDiagnosticsCount,
  formatDiagnosticsDurationMs,
  redactSecrets,
  redactUrl,
  REDACTED_PLACEHOLDER,
  serializeDiagnosticsBundle,
  summarizeLocalDiagnosticsMetrics,
  type DiagnosticsBundleInput,
} from "./DiagnosticsPanel.logic";

describe("redactSecrets", () => {
  it("redacts secret-bearing keys at any depth", () => {
    const result = redactSecrets({
      label: "Devbox",
      bearerToken: "secret-bearer-123",
      nested: {
        apiKey: "sk-live-xyz",
        password: "hunter2",
        safe: "keep-me",
      },
      list: [{ authorization: "Bearer abc", value: "ok" }],
    });

    expect(result).toEqual({
      label: "Devbox",
      bearerToken: REDACTED_PLACEHOLDER,
      nested: {
        apiKey: REDACTED_PLACEHOLDER,
        password: REDACTED_PLACEHOLDER,
        safe: "keep-me",
      },
      list: [{ authorization: REDACTED_PLACEHOLDER, value: "ok" }],
    });
  });

  it("strips credentials and sensitive query params from URLs", () => {
    expect(redactUrl("https://user:p4ss@backend.example.com/api")).toBe(
      "https://backend.example.com/api",
    );
    expect(redactUrl("https://backend.example.com/pair?token=abc123&keep=1")).toBe(
      `https://backend.example.com/pair?token=${encodeURIComponent(REDACTED_PLACEHOLDER)}&keep=1`,
    );
  });
});

describe("buildDiagnosticsBundle", () => {
  const provider: ServerProvider = {
    instanceId: "codex-1" as ServerProvider["instanceId"],
    driver: "codex" as ServerProvider["driver"],
    enabled: true,
    installed: true,
    version: "1.2.3",
    status: "ready",
    auth: { status: "authenticated", type: "api-key", email: "user@example.com" },
    checkedAt: "2026-06-14T00:00:00.000Z" as ServerProvider["checkedAt"],
    models: [],
    slashCommands: [],
    skills: [],
  };

  const input: DiagnosticsBundleInput = {
    generatedAt: "2026-06-14T00:00:00.000Z",
    app: { version: "0.1.5", stage: "Beta", isElectron: true, userAgent: "test-agent" },
    environments: [
      {
        environmentId: "env-1" as EnvironmentId,
        record: {
          environmentId: "env-1" as EnvironmentId,
          label: "Remote",
          // Credentials embedded in a URL must not survive export.
          httpBaseUrl: "https://owner:topsecretpw@backend.example.com",
          wsBaseUrl: "wss://backend.example.com/ws?token=leaked-token-value",
          createdAt: "2026-06-13T00:00:00.000Z",
          lastConnectedAt: null,
        },
        runtime: {
          connectionState: "error",
          authState: "requires-auth",
          lastError: "handshake failed",
          lastErrorAt: "2026-06-14T00:00:00.000Z",
          role: "client",
          descriptor: null,
          serverConfig: null,
          connectedAt: null,
          disconnectedAt: "2026-06-14T00:00:00.000Z",
        },
        pushSequence: {
          lastSnapshotSequence: 10,
          lastEventSequence: 14,
          highestSequence: 14,
          eventCount: 4,
          snapshotCount: 1,
          gapCount: 1,
          lastGap: {
            expectedSequence: 12,
            receivedSequence: 14,
            detectedAt: "2026-06-14T00:00:00.000Z",
          },
          updatedAt: "2026-06-14T00:00:00.000Z",
        },
      },
    ],
    providers: [provider],
    observability: {
      logsDirectoryPath: "/home/user/.ryco/logs",
      localTracingEnabled: true,
      otlpTracesUrl: "https://otlp.example.com",
      otlpTracesEnabled: false,
      otlpMetricsEnabled: false,
      localMetrics: {
        turnQuiescenceAvgMs: 120,
        checkpointDurationP95Ms: 250,
        wsReconnectCount: 2,
        windowSampleCounts: {
          turnQuiescence: 3,
          checkpointDuration: 3,
        },
        capturedAt: "2026-06-14T00:00:00.000Z",
      },
    },
    performance: {
      local: {
        turnQuiescenceAvgMs: 120,
        checkpointDurationP95Ms: 250,
        latestThreadSnapshotDurationMs: 42,
        threadSnapshotDurationP95Ms: 80,
        wsReconnectCount: 2,
        windowSampleCounts: {
          turnQuiescence: 3,
          checkpointDuration: 3,
          threadSnapshotDuration: 2,
        },
        capturedAt: "2026-06-14T00:00:00.000Z",
      },
      queues: {
        runtimeDepthTotal: 1,
        runtimeHighWaterMax: 3,
        replayDepthMax: 2,
        liveBufferDepthTotal: 1,
        liveBufferHighWaterMax: 4,
        liveBufferOverflowCount: 0,
        replayLagMax: 1,
        providerLogDroppedRecords: 0,
      },
      traceSink: {
        bufferedBytes: 128,
        bufferedRecords: 1,
        maxBufferedBytes: 1024,
        maxBufferedRecords: 50,
        droppedRecords: 0,
        writeFailures: 0,
        retryDelayMs: 0,
        lastWriteFailureAt: null,
      },
      snapshotCollectionDurationMs: 12,
    },
  };

  it("formats local diagnostics metrics for display", () => {
    expect(formatDiagnosticsDurationMs(120.4)).toBe("120 ms");
    expect(formatDiagnosticsDurationMs(null)).toBe("—");
    expect(formatDiagnosticsCount(2)).toBe("2");
    expect(summarizeLocalDiagnosticsMetrics(input.observability?.localMetrics ?? null)).toContain(
      "WS reconnects 2",
    );
  });

  it("never includes secrets in the serialized export", () => {
    const serialized = serializeDiagnosticsBundle(buildDiagnosticsBundle(input));

    expect(serialized).not.toContain("topsecretpw");
    expect(serialized).not.toContain("leaked-token-value");
    expect(serialized).not.toContain("user@example.com");
    expect(serialized).not.toContain("backend.example.com");
    expect(serialized).not.toContain("/home/user/.ryco/logs");
    // Safe diagnostic data is still present.
    expect(serialized).toContain("handshake failed");
    expect(serialized).toContain('"logsDirectoryConfigured": true');
    expect(serialized).toContain("codex-1");
    expect(serialized).toContain('"turnQuiescenceAvgMs": 120');
    expect(serialized).toContain('"latestThreadSnapshotDurationMs": 42');
    expect(serialized).toContain('"runtimeHighWaterMax": 3');
  });

  it("keeps the provider auth status but drops PII", () => {
    const bundle = buildDiagnosticsBundle(input);
    expect(bundle.providers[0]?.authStatus).toBe("authenticated");
    expect(JSON.stringify(bundle)).not.toContain("user@example.com");
  });
});
