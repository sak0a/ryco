import { describe, expect, it, vi } from "vite-plus/test";
import type { AppLifecycleEvent, AppLifecycleService } from "@ryco/client-runtime/platform";

import { createVisibilityAwarePoller } from "./visibilityPolling.ts";

function lifecycleHarness() {
  let foreground = true;
  const listeners = new Set<(event: AppLifecycleEvent) => void>();
  const lifecycle: AppLifecycleService = {
    isForeground: () => foreground,
    isOnline: () => true,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    lifecycle,
    emit: (event: AppLifecycleEvent) => {
      if (event === "background") foreground = false;
      if (event === "foreground" || event === "resume") foreground = true;
      for (const listener of listeners) listener(event);
    },
  };
}

describe("visibility-aware polling", () => {
  it("never overlaps work and schedules the next poll after completion", async () => {
    vi.useFakeTimers();
    const harness = lifecycleHarness();
    let resolveRun: (() => void) | undefined;
    const run = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRun = resolve;
        }),
    );
    const poller = createVisibilityAwarePoller({
      lifecycle: harness.lifecycle,
      run,
      resolveDelayMs: () => 100,
    });
    await vi.runAllTicks();
    expect(run).toHaveBeenCalledTimes(1);
    const joined = poller.refresh();
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(run).toHaveBeenCalledTimes(1);

    resolveRun?.();
    await joined;
    await vi.advanceTimersByTimeAsync(99);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
    poller.stop();
    vi.useRealTimers();
  });

  it("pauses while hidden and refreshes once on foreground resume", async () => {
    vi.useFakeTimers();
    const harness = lifecycleHarness();
    const run = vi.fn(() => Promise.resolve());
    const poller = createVisibilityAwarePoller({
      lifecycle: harness.lifecycle,
      run,
      resolveDelayMs: () => 100,
    });
    await vi.runAllTicks();
    harness.emit("background");
    await vi.advanceTimersByTimeAsync(500);
    expect(run).toHaveBeenCalledTimes(1);

    harness.emit("foreground");
    harness.emit("resume");
    await vi.runAllTicks();
    expect(run).toHaveBeenCalledTimes(2);
    poller.stop();
    vi.useRealTimers();
  });
});
