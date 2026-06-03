import { describe, expect, it } from "vitest";

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
});
