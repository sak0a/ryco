import { describe, expect, it } from "vite-plus/test";

import { createBackendRestartBackoff } from "./backendRestartBackoff.ts";

describe("createBackendRestartBackoff", () => {
  it("keeps increasing retry delays until readiness resets the attempt counter", () => {
    const backoff = createBackendRestartBackoff({
      initialDelayMs: 500,
      maxDelayMs: 10_000,
    });

    expect(backoff.nextDelayMs()).toBe(500);
    expect(backoff.nextDelayMs()).toBe(1_000);
    expect(backoff.nextDelayMs()).toBe(2_000);

    backoff.reset();

    expect(backoff.nextDelayMs()).toBe(500);
  });

  it("caps retry delays at the configured maximum", () => {
    const backoff = createBackendRestartBackoff({
      initialDelayMs: 500,
      maxDelayMs: 10_000,
    });

    const delays = Array.from({ length: 8 }, () => backoff.nextDelayMs());

    expect(delays).toEqual([500, 1_000, 2_000, 4_000, 8_000, 10_000, 10_000, 10_000]);
  });

  it.each([
    { initialDelayMs: 0, maxDelayMs: 10_000 },
    { initialDelayMs: -1, maxDelayMs: 10_000 },
    { initialDelayMs: Number.POSITIVE_INFINITY, maxDelayMs: 10_000 },
    { initialDelayMs: 1_000, maxDelayMs: 0 },
    { initialDelayMs: 1_000, maxDelayMs: Number.NaN },
    { initialDelayMs: 10_000, maxDelayMs: 1_000 },
  ])("rejects invalid backoff options %#", (options) => {
    expect(() => createBackendRestartBackoff(options)).toThrow(RangeError);
    expect(() => createBackendRestartBackoff(options)).toThrow(
      `initialDelayMs=${options.initialDelayMs}, maxDelayMs=${options.maxDelayMs}`,
    );
  });
});
