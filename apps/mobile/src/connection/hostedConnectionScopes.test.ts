import { describe, expect, it, vi } from "vite-plus/test";
import type { EnvironmentId, ThreadId } from "@ryco/contracts";

import {
  createMobileHostedScopeLeaseStore,
  measureHostedLeaseReconnectTraffic,
  MOBILE_SCOPE_LEASE_TTL_MS,
  MOBILE_SCOPE_REPORT_INTERVAL_MS,
  readMobileHostedScopeLeaseDiagnostics,
  recordMobileHostedScopeLeaseReport,
} from "./hostedConnectionScopes";

describe("mobile hosted connection scope leases", () => {
  const ENV_A = "env-a" as EnvironmentId;
  const THREAD_A = "thread-a" as ThreadId;

  it("refcounts identical mounted scopes and releases only the final owner", () => {
    const store = createMobileHostedScopeLeaseStore();
    const first = store.retain(ENV_A, { type: "thread-detail", threadId: THREAD_A });
    const second = store.retain(ENV_A, { type: "thread-detail", threadId: THREAD_A });

    expect(store.list(ENV_A)).toEqual([
      {
        environmentId: "env-a",
        scope: { type: "thread-detail", threadId: "thread-a" },
        refCount: 2,
      },
    ]);
    first();
    expect(store.isEnvironmentRetained(ENV_A)).toBe(true);
    second();
    second();
    expect(store.isEnvironmentRetained(ENV_A)).toBe(false);
  });

  it("reports immediately, on scope changes, and before the lease TTL expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const store = createMobileHostedScopeLeaseStore();
    const reports: Array<{ readonly observedAt: number; readonly count: number }> = [];
    const stop = store.startReporter({
      now: () => Date.now(),
      report: (report) => {
        recordMobileHostedScopeLeaseReport(report);
        reports.push({ observedAt: report.observedAt, count: report.scopes.length });
      },
    });
    expect(MOBILE_SCOPE_REPORT_INTERVAL_MS).toBeLessThan(MOBILE_SCOPE_LEASE_TTL_MS);
    expect(reports).toEqual([{ observedAt: 0, count: 0 }]);

    const release = store.retain(ENV_A, { type: "provider-status" });
    await Promise.resolve();
    expect(reports.at(-1)?.count).toBe(1);
    expect(readMobileHostedScopeLeaseDiagnostics()).toEqual({
      observedAt: 0,
      ttlMs: MOBILE_SCOPE_LEASE_TTL_MS,
      activeScopeCount: 1,
      retainedEnvironmentCount: 1,
    });
    await vi.advanceTimersByTimeAsync(MOBILE_SCOPE_REPORT_INTERVAL_MS);
    expect(reports.at(-1)?.observedAt).toBe(MOBILE_SCOPE_REPORT_INTERVAL_MS);

    release();
    await Promise.resolve();
    expect(reports.at(-1)?.count).toBe(0);
    stop();
    vi.useRealTimers();
  });

  it("quantifies the assessed eight-client reconnect reduction", () => {
    const measured = measureHostedLeaseReconnectTraffic({
      clients: 8,
      bound: 3,
      retainedEnvironmentsPerClient: 1,
    });
    expect(measured).toEqual({
      unleasedReconnects: 24,
      leasedReconnects: 8,
      unleasedShellStreams: 24,
      leasedShellStreams: 8,
      reduction: 2 / 3,
    });
  });
});
