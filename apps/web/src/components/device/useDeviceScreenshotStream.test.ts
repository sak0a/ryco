import { describe, expect, it } from "vite-plus/test";

import { hostedScreenshotDelayMs } from "./useDeviceScreenshotStream";

describe("hosted screenshot fallback backpressure", () => {
  it("keeps tiny responses at the 750ms floor", () => {
    expect(hostedScreenshotDelayMs(1)).toBe(750);
  });

  it("paces the capacity assessment's measured full-PNG payloads", () => {
    expect(hostedScreenshotDelayMs(3_053_100)).toBe(5_824);
    expect(hostedScreenshotDelayMs(5_569_884)).toBe(10_624);
  });

  it("caps a pathological response interval without removing backpressure", () => {
    expect(hostedScreenshotDelayMs(100 * 1024 * 1024)).toBe(15_000);
  });
});
