import { describe, expect, it } from "vite-plus/test";

import { hostedScreenshotDelayMs, hostedScreenshotLoad } from "./useDeviceScreenshotStream";

describe("hosted screenshot fallback backpressure", () => {
  it("keeps tiny responses at the 750ms floor", () => {
    expect(hostedScreenshotDelayMs(1)).toBe(750);
  });

  it("paces the capacity assessment's measured full-PNG payloads", () => {
    expect(hostedScreenshotDelayMs(3_053_100)).toBe(5_824);
    expect(hostedScreenshotDelayMs(5_569_884)).toBe(10_624);
  });

  it("makes the one-, two-, and three-stream aggregate explicit", () => {
    expect(hostedScreenshotLoad(3_053_100, 1)).toEqual({
      intervalMs: 5_824,
      bytesPerSecondPerStream: 524_228,
      aggregateBytesPerSecond: 524_228,
    });
    expect(hostedScreenshotLoad(3_053_100, 2).aggregateBytesPerSecond).toBe(1_048_456);
    expect(hostedScreenshotLoad(3_053_100, 3).aggregateBytesPerSecond).toBe(1_572_684);
  });

  it("caps a pathological response interval without removing backpressure", () => {
    expect(hostedScreenshotDelayMs(100 * 1024 * 1024)).toBe(15_000);
  });
});
