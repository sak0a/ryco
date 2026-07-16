import { describe, expect, it } from "vite-plus/test";

import { reconnectDelay } from "./ReconnectPolicy.ts";

const config = { baseDelayMs: 1_000, maxDelayMs: 60_000, jitterRatio: 0.2 } as const;

describe("reconnectDelay", () => {
  it("applies bounded exponential windows and deterministic jitter", () => {
    expect(reconnectDelay(config, 0, 0).delayMs).toBe(800);
    expect(reconnectDelay(config, 0, 0.5).delayMs).toBe(1_000);
    expect(reconnectDelay(config, 0, 1).delayMs).toBe(1_200);
    expect(reconnectDelay(config, 3, 0.5).delayMs).toBe(8_000);
    expect(reconnectDelay(config, 100_000, 1).delayMs).toBe(60_000);
  });

  it("honors retry-after as a lower bound with the protocol absolute cap", () => {
    expect(reconnectDelay(config, 0, 0.5, 45_000).delayMs).toBe(45_000);
    expect(reconnectDelay(config, 0, 0.5, 999_999).delayMs).toBe(300_000);
    expect(reconnectDelay(config, 20, 0.5, 10_000).delayMs).toBe(60_000);
  });

  it("never drops below 250 ms and rejects nondeterministic inputs", () => {
    expect(
      reconnectDelay({ baseDelayMs: 250, maxDelayMs: 250, jitterRatio: 0.5 }, 0, 0).delayMs,
    ).toBe(250);
    expect(() => reconnectDelay(config, -1, 0.5)).toThrow("Reconnect policy input is invalid.");
    expect(() => reconnectDelay(config, 0, Number.NaN)).toThrow(
      "Reconnect policy input is invalid.",
    );
  });
});
