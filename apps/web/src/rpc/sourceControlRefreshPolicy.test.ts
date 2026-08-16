import { describe, expect, it } from "vite-plus/test";

import {
  AUTOMATIC_ACTIVE_REFRESH_MS,
  AUTOMATIC_DISCOVERY_REFRESH_MS,
  POST_PUSH_DISCOVERY_WINDOW_MS,
  REDUCED_ACTIVE_REFRESH_MS,
  REDUCED_DISCOVERY_REFRESH_MS,
  SOURCE_CONTROL_MAX_BACKOFF_MS,
  resolveSourceControlFailureDelay,
  resolveSourceControlRefreshDelay,
  shouldRefreshSourceControlOnLifecycle,
} from "./sourceControlRefreshPolicy";

describe("source-control refresh policy", () => {
  it("uses adaptive automatic and reduced cadence", () => {
    expect(resolveSourceControlRefreshDelay({ mode: "automatic", phase: "discovery" })).toBe(
      AUTOMATIC_DISCOVERY_REFRESH_MS,
    );
    expect(resolveSourceControlRefreshDelay({ mode: "reduced", phase: "discovery" })).toBe(
      REDUCED_DISCOVERY_REFRESH_MS,
    );
    expect(resolveSourceControlRefreshDelay({ mode: "automatic", phase: "active" })).toBe(
      AUTOMATIC_ACTIVE_REFRESH_MS,
    );
    expect(resolveSourceControlRefreshDelay({ mode: "reduced", phase: "active" })).toBe(
      REDUCED_ACTIVE_REFRESH_MS,
    );
  });

  it("starts no timer for manual or settled state", () => {
    expect(resolveSourceControlRefreshDelay({ mode: "manual", phase: "active" })).toBe(false);
    expect(resolveSourceControlRefreshDelay({ mode: "automatic", phase: "settled" })).toBe(false);
  });

  it("stops post-push discovery at the fixed deadline", () => {
    const startedAtMs = 1_000;
    const discoveryExpiresAtMs = startedAtMs + POST_PUSH_DISCOVERY_WINDOW_MS;
    expect(
      resolveSourceControlRefreshDelay({
        mode: "automatic",
        phase: "discovery",
        nowMs: discoveryExpiresAtMs - 1,
        discoveryExpiresAtMs,
      }),
    ).toBe(AUTOMATIC_DISCOVERY_REFRESH_MS);
    expect(
      resolveSourceControlRefreshDelay({
        mode: "automatic",
        phase: "discovery",
        nowMs: discoveryExpiresAtMs,
        discoveryExpiresAtMs,
      }),
    ).toBe(false);
  });

  it("refreshes stale or invalidated automatic state on lifecycle recovery", () => {
    expect(
      shouldRefreshSourceControlOnLifecycle({
        mode: "automatic",
        hasData: true,
        invalidated: false,
        lastFetchedAtMs: 1_000,
        staleTimeMs: 60_000,
        nowMs: 61_000,
      }),
    ).toBe(true);
    expect(
      shouldRefreshSourceControlOnLifecycle({
        mode: "automatic",
        hasData: true,
        invalidated: true,
        lastFetchedAtMs: 60_000,
        staleTimeMs: 60_000,
        nowMs: 61_000,
      }),
    ).toBe(true);
    expect(
      shouldRefreshSourceControlOnLifecycle({
        mode: "manual",
        hasData: false,
        invalidated: true,
        lastFetchedAtMs: 0,
        staleTimeMs: 60_000,
        nowMs: 61_000,
      }),
    ).toBe(false);
  });

  it("backs off exponentially, caps delay, and honors retry hints", () => {
    expect(resolveSourceControlFailureDelay({ baseDelayMs: 10_000, consecutiveFailures: 1 })).toBe(
      10_000,
    );
    expect(resolveSourceControlFailureDelay({ baseDelayMs: 10_000, consecutiveFailures: 3 })).toBe(
      40_000,
    );
    expect(resolveSourceControlFailureDelay({ baseDelayMs: 60_000, consecutiveFailures: 9 })).toBe(
      SOURCE_CONTROL_MAX_BACKOFF_MS,
    );
    expect(
      resolveSourceControlFailureDelay({
        baseDelayMs: 10_000,
        consecutiveFailures: 4,
        retryAfterMs: 45_000,
      }),
    ).toBe(45_000);
  });
});
