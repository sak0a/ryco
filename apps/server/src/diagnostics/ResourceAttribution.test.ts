import { describe, expect, it } from "vite-plus/test";

import { makeResourceAttribution } from "./ResourceAttribution.ts";

describe("resource attribution", () => {
  it("aggregates numeric work without retaining payloads or paths", () => {
    const attribution = makeResourceAttribution();
    attribution.record("server-trace", "append", 0, 100, 3, 2);
    attribution.record("server-trace", "append", 0, 50, 2, 1);
    attribution.record("/private/token", "append", 0, 100, 3);
    expect(attribution.snapshot()).toEqual([
      {
        component: "server-trace",
        operation: "append",
        logicalReadBytes: 0,
        logicalWriteBytes: 150,
        count: 3,
        durationMs: 5,
      },
    ]);
  });

  it("bounds label cardinality and clamps invalid or overflowing counters", () => {
    const attribution = makeResourceAttribution();
    for (let index = 0; index < 200; index += 1)
      attribution.record(`component-${index}`, "append", -1, Infinity, NaN);
    expect(attribution.snapshot()).toHaveLength(100);
    attribution.record("component-0", "append", Number.MAX_SAFE_INTEGER, 1, 0);
    attribution.record("component-0", "append", 1, 1, 0);
    expect(attribution.snapshot()[0]).toMatchObject({
      logicalReadBytes: Number.MAX_SAFE_INTEGER,
      logicalWriteBytes: 2,
      durationMs: 0,
    });
  });
});
