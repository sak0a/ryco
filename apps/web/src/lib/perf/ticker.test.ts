import { describe, expect, it, vi } from "vite-plus/test";

import { createVisibleTicker } from "./ticker";

function createFakeTargets() {
  let visibilityState: DocumentVisibilityState = "visible";
  const visibilityListeners = new Set<() => void>();
  const intervals = new Map<number, () => void>();
  let nextIntervalId = 1;

  return {
    documentTarget: {
      get visibilityState() {
        return visibilityState;
      },
      addEventListener: vi.fn((_type: "visibilitychange", listener: () => void) => {
        visibilityListeners.add(listener);
      }),
      removeEventListener: vi.fn((_type: "visibilitychange", listener: () => void) => {
        visibilityListeners.delete(listener);
      }),
    },
    windowTarget: {
      setInterval: vi.fn((callback: () => void) => {
        const id = nextIntervalId;
        nextIntervalId += 1;
        intervals.set(id, callback);
        return id;
      }),
      clearInterval: vi.fn((id: unknown) => {
        intervals.delete(Number(id));
      }),
    },
    setVisibilityState(next: DocumentVisibilityState) {
      visibilityState = next;
      for (const listener of visibilityListeners) {
        listener();
      }
    },
    fireIntervals() {
      for (const callback of intervals.values()) {
        callback();
      }
    },
  };
}

describe("createVisibleTicker", () => {
  it("shares one interval across subscribers and stops it after unsubscribe", () => {
    const targets = createFakeTargets();
    let nowMs = 1000;
    const ticker = createVisibleTicker({
      intervalMs: 1000,
      windowTarget: targets.windowTarget,
      documentTarget: targets.documentTarget,
      now: () => nowMs,
    });
    const first = vi.fn();
    const second = vi.fn();

    const unsubscribeFirst = ticker.subscribe(first);
    const unsubscribeSecond = ticker.subscribe(second);
    expect(targets.windowTarget.setInterval).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledWith(1000);
    expect(second).toHaveBeenCalledWith(1000);

    nowMs = 2000;
    targets.fireIntervals();
    expect(first).toHaveBeenLastCalledWith(2000);
    expect(second).toHaveBeenLastCalledWith(2000);

    unsubscribeFirst();
    expect(targets.windowTarget.clearInterval).not.toHaveBeenCalled();

    unsubscribeSecond();
    expect(targets.windowTarget.clearInterval).toHaveBeenCalledTimes(1);
    expect(targets.documentTarget.removeEventListener).toHaveBeenCalledTimes(1);
  });

  it("pauses while hidden and emits immediately when visible again", () => {
    const targets = createFakeTargets();
    let nowMs = 1000;
    const ticker = createVisibleTicker({
      intervalMs: 1000,
      windowTarget: targets.windowTarget,
      documentTarget: targets.documentTarget,
      now: () => nowMs,
    });
    const listener = vi.fn();

    ticker.subscribe(listener);
    targets.setVisibilityState("hidden");
    expect(targets.windowTarget.clearInterval).toHaveBeenCalledTimes(1);

    nowMs = 2000;
    targets.fireIntervals();
    expect(listener).toHaveBeenCalledTimes(1);

    nowMs = 3000;
    targets.setVisibilityState("visible");
    expect(listener).toHaveBeenLastCalledWith(3000);
    expect(targets.windowTarget.setInterval).toHaveBeenCalledTimes(2);
  });

  it("does not start an interval while initially hidden", () => {
    const targets = createFakeTargets();
    targets.setVisibilityState("hidden");
    const ticker = createVisibleTicker({
      intervalMs: 1000,
      windowTarget: targets.windowTarget,
      documentTarget: targets.documentTarget,
      now: () => 1000,
    });

    ticker.subscribe(vi.fn());

    expect(targets.windowTarget.setInterval).not.toHaveBeenCalled();
  });
});
