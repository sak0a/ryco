import { describe, expect, it } from "vite-plus/test";

import { HostedReconnectPolicy } from "./reconnectPolicy";

describe("HostedReconnectPolicy", () => {
  it("uses bounded deterministic exponential jitter and honors retry-after", () => {
    let now = 0;
    const policy = new HostedReconnectPolicy({ random: () => 0.5, now: () => now });
    expect(policy.nextDelay()).toBe(1_000);
    expect(policy.nextDelay()).toBe(2_000);
    expect(policy.nextDelay(30_000)).toBe(30_000);
    for (let index = 0; index < 20; index += 1) policy.nextDelay();
    expect(policy.nextDelay()).toBe(60_000);

    policy.opened();
    now = 59_999;
    policy.closed();
    expect(policy.nextDelay()).toBe(60_000);

    policy.opened();
    now += 60_000;
    policy.closed();
    expect(policy.nextDelay()).toBe(1_000);
  });

  it("injects randomness without exceeding the configured window", () => {
    const low = new HostedReconnectPolicy({ random: () => 0 });
    const high = new HostedReconnectPolicy({ random: () => 1 });
    expect(low.nextDelay()).toBe(800);
    expect(high.nextDelay()).toBe(1_200);
  });
});
