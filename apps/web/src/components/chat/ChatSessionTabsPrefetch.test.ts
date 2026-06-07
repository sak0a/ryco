import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTabPrefetchController } from "./ChatSessionTabsPrefetch";

describe("createTabPrefetchController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("retains exactly once per key while pointer is over", () => {
    const release = vi.fn();
    const retain = vi.fn(() => release);
    const controller = createTabPrefetchController({ retain, releaseDelayMs: 250 });

    controller.enter("k1");
    controller.enter("k1");
    expect(retain).toHaveBeenCalledTimes(1);

    controller.dispose();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("releases after delay on leave, but cancels release if re-entered", () => {
    const release = vi.fn();
    const retain = vi.fn(() => release);
    const controller = createTabPrefetchController({ retain, releaseDelayMs: 250 });

    controller.enter("k1");
    controller.leave("k1");
    expect(release).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);

    controller.enter("k1");
    vi.advanceTimersByTime(500);
    expect(release).not.toHaveBeenCalled();

    controller.leave("k1");
    vi.advanceTimersByTime(250);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("retains independently per key", () => {
    const releases: Record<string, ReturnType<typeof vi.fn>> = {};
    const retain = vi.fn((key: string) => {
      const fn = vi.fn();
      releases[key] = fn;
      return fn;
    });
    const controller = createTabPrefetchController({ retain, releaseDelayMs: 250 });

    controller.enter("a");
    controller.enter("b");
    expect(retain).toHaveBeenCalledTimes(2);

    controller.leave("a");
    vi.advanceTimersByTime(250);
    expect(releases.a).toHaveBeenCalledTimes(1);
    expect(releases.b).not.toHaveBeenCalled();

    controller.dispose();
    expect(releases.b).toHaveBeenCalledTimes(1);
  });

  it("noops on leave for unknown keys", () => {
    const retain = vi.fn(() => vi.fn());
    const controller = createTabPrefetchController({ retain, releaseDelayMs: 250 });
    expect(() => controller.leave("never-entered")).not.toThrow();
    expect(retain).not.toHaveBeenCalled();
  });
});
