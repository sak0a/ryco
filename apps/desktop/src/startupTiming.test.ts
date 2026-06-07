import { describe, expect, it } from "vitest";

import { createStartupTiming, formatStartupTimingEntry } from "./startupTiming.ts";

describe("startupTiming", () => {
  it("records elapsed and delta timings", () => {
    const values = [100, 140, 175];
    const timing = createStartupTiming({ now: () => values.shift() ?? 175 });

    const first = timing.mark("desktop.launch");
    const second = timing.mark("desktop.ready", "source=test");

    expect(first).toEqual({
      phase: "desktop.launch",
      elapsedMs: 40,
      deltaMs: 40,
      detail: undefined,
    });
    expect(second).toEqual({
      phase: "desktop.ready",
      elapsedMs: 75,
      deltaMs: 35,
      detail: "source=test",
    });
    expect(timing.entries()).toEqual([first, second]);
  });

  it("formats timing entries for logs", () => {
    expect(
      formatStartupTimingEntry({
        phase: "desktop.backend.spawn",
        elapsedMs: 12.4,
        deltaMs: 8.6,
        detail: "port=3773",
      }),
    ).toBe("startup timing phase=desktop.backend.spawn elapsedMs=12 deltaMs=9 port=3773");
  });
});
