import { describe, expect, it } from "vitest";

import { RollingDurationWindow } from "./RollingDurationWindow.ts";

describe("RollingDurationWindow", () => {
  it("returns null averages and percentiles when empty", () => {
    const window = new RollingDurationWindow({ now: () => 1_000 });

    expect(window.count()).toBe(0);
    expect(window.average()).toBeNull();
    expect(window.percentile(95)).toBeNull();
  });

  it("computes average and p95 over recorded samples", () => {
    const window = new RollingDurationWindow({ now: () => 10_000 });

    for (const durationMs of [10, 20, 30, 40, 100]) {
      window.record(durationMs);
    }

    expect(window.count()).toBe(5);
    expect(window.average()).toBe(40);
    expect(window.percentile(95)).toBe(100);
  });

  it("evicts samples outside the rolling time window", () => {
    let now = 10_000;
    const window = new RollingDurationWindow({
      maxWindowMs: 1_000,
      now: () => now,
    });

    window.record(100, 9_000);
    window.record(200, 9_500);
    now = 10_500;
    window.record(300);

    expect(window.count()).toBe(2);
    expect(window.average()).toBe(250);
  });

  it("caps retained samples at maxSamples", () => {
    const window = new RollingDurationWindow({
      maxSamples: 3,
      now: () => 10_000,
    });

    window.record(10);
    window.record(20);
    window.record(30);
    window.record(40);

    expect(window.count()).toBe(3);
    expect(window.average()).toBe(30);
    expect(window.percentile(95)).toBe(40);
  });
});
