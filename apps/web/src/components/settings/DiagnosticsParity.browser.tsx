import "../../index.css";
import {
  EnvironmentId,
  type DiagnosticsSnapshot,
  type ResourceTelemetryHistory,
} from "@ryco/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";
import { SettingsTargetProvider } from "../../settingsTarget";
import { ProcessDiagnosticsSection } from "./ProcessDiagnosticsSection";
import { ResourceTelemetryDiagnostics } from "./ResourceTelemetryDiagnostics";

const harness = vi.hoisted(() => ({
  allowed: true,
  confirm: vi.fn(),
  signal: vi.fn(),
  history: vi.fn(),
  retry: vi.fn(),
}));
vi.mock("./useDiagnosticsCapability", () => ({
  useDiagnosticsCapability: () => ({
    hosted: true,
    allowed: harness.allowed,
    reason: harness.allowed ? null : "Authorization is stale.",
  }),
}));
vi.mock("../../localApi", () => ({
  ensureLocalApi: () => ({
    dialogs: { confirm: harness.confirm },
    server: {
      signalDiagnosticProcess: harness.signal,
      getResourceTelemetryHistory: harness.history,
      retryResourceTelemetry: harness.retry,
    },
  }),
}));
vi.mock("../../environmentApi", () => ({
  ensureEnvironmentApi: () => ({}),
  readEnvironmentApi: () => ({
    server: {
      signalDiagnosticProcess: harness.signal,
      getResourceTelemetryHistory: harness.history,
      retryResourceTelemetry: harness.retry,
    },
  }),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
const processSnapshot = {
  processTree: {
    readAt: new Date().toISOString(),
    serverPid: 1,
    totalCpuPercent: 225,
    totalRssBytes: 1024,
    processes: [
      {
        pid: 20,
        ppid: 1,
        startTimeMs: 123,
        command: "agent",
        status: "running",
        cpuPercent: 225,
        rssBytes: 1024,
        elapsed: "1:00",
        depth: 0,
        childPids: [],
      },
    ],
  },
} as unknown as DiagnosticsSnapshot;
function historySnapshot(count: number): ResourceTelemetryHistory {
  return {
    readAt: new Date().toISOString(),
    windowMs: 300_000,
    bucketMs: 15_000,
    sampleIntervalMs: 1000,
    retainedSampleCount: count,
    buckets: [],
    topProcesses: [],
  } as unknown as ResourceTelemetryHistory;
}

beforeEach(() => {
  harness.allowed = true;
  harness.confirm.mockReset().mockResolvedValue(true);
  harness.signal.mockReset().mockResolvedValue({ signaled: true, pid: 20, signal: "SIGINT" });
  harness.history.mockReset().mockResolvedValue(historySnapshot(1));
  harness.retry.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("Diagnostics parity interactions", () => {
  it("confirms a process action and includes the sampled process identity", async () => {
    await render(<ProcessDiagnosticsSection snapshot={processSnapshot} refresh={async () => {}} />);
    await expect.element(page.getByText("225.0%", { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "Interrupt", exact: true }).click();
    await expect
      .poll(() => harness.signal.mock.calls)
      .toEqual([[{ pid: 20, startTimeMs: 123, signal: "SIGINT" }]]);
    expect(harness.confirm).toHaveBeenCalledOnce();
  });

  it("does not signal after the selected environment changes during confirmation", async () => {
    const confirmation = deferred<boolean>();
    harness.confirm.mockReturnValue(confirmation.promise);
    const target = (id: string) => ({
      environmentId: id as EnvironmentId,
      nodeLabel: id,
      serverConfig: null,
      primary: true,
      connected: true,
    });
    const screen = await render(
      <SettingsTargetProvider value={target("first")}>
        <ProcessDiagnosticsSection snapshot={processSnapshot} refresh={async () => {}} />
      </SettingsTargetProvider>,
    );
    await page.getByRole("button", { name: "Force kill", exact: true }).click();
    await screen.rerender(
      <SettingsTargetProvider value={target("second")}>
        <ProcessDiagnosticsSection snapshot={processSnapshot} refresh={async () => {}} />
      </SettingsTargetProvider>,
    );
    confirmation.resolve(true);
    await expect
      .element(page.getByRole("button", { name: "Force kill", exact: true }))
      .toBeEnabled();
    expect(harness.signal).not.toHaveBeenCalled();
  });

  it("keeps the latest history window when an older request completes late", async () => {
    const old = deferred<ResourceTelemetryHistory>();
    harness.history.mockReturnValueOnce(old.promise).mockResolvedValue(historySnapshot(15));
    await render(
      <ResourceTelemetryDiagnostics
        telemetry={undefined}
        paused={false}
        refresh={async () => {}}
      />,
    );
    await expect.poll(() => harness.history.mock.calls.length).toBe(1);
    await page.getByRole("button", { name: "15m", exact: true }).click();
    await expect.element(page.getByText(/15 retained samples/)).toBeVisible();
    old.resolve(historySnapshot(999));
    await expect.element(page.getByText(/15 retained samples/)).toBeVisible();
    expect(harness.history.mock.calls[1]).toEqual([{ windowMs: 900_000, bucketMs: 30_000 }]);
  });

  it("pauses automatic history requests while allowing manual refresh", async () => {
    await render(
      <ResourceTelemetryDiagnostics telemetry={undefined} paused={true} refresh={async () => {}} />,
    );
    expect(harness.history).not.toHaveBeenCalled();
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect.poll(() => harness.history.mock.calls.length).toBe(1);
  });

  it("does not fetch or retry without current authorization", async () => {
    harness.allowed = false;
    await render(
      <ResourceTelemetryDiagnostics
        telemetry={undefined}
        paused={false}
        refresh={async () => {}}
      />,
    );
    await expect
      .element(page.getByRole("button", { name: "Retry monitor", exact: true }))
      .toBeDisabled();
    expect(harness.history).not.toHaveBeenCalled();
    expect(harness.retry).not.toHaveBeenCalled();
  });
});
