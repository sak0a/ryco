import { describe, expect, it } from "vite-plus/test";

import {
  durationBucketSeries,
  formatBytes,
  formatDuration,
  formatPercent,
  relativeTimeLabel,
  resourceCpuSeries,
  resourceMemorySeries,
} from "./DiagnosticsSettings.logic";

describe("DiagnosticsSettings logic", () => {
  it("formats byte, duration, percent, and relative time labels", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatDuration(950)).toBe("950 ms");
    expect(formatDuration(1_500)).toBe("1.5 s");
    expect(formatPercent(12.345)).toBe("12.3%");
    expect(
      relativeTimeLabel("2026-06-14T12:00:00.000Z", Date.parse("2026-06-14T12:00:30.000Z")),
    ).toBe("30s ago");
  });

  it("derives chart series from resource and bucket snapshots", () => {
    const samples = [
      {
        sampledAt: "2026-06-14T12:00:00.000Z",
        uptimeMs: 1,
        memory: {
          rssBytes: 100,
          heapUsedBytes: 50,
          heapTotalBytes: 70,
          externalBytes: 0,
          arrayBuffersBytes: 0,
        },
        cpu: {
          userMicros: 1,
          systemMicros: 2,
          utilizationPercent: 3,
        },
      },
    ];

    expect(resourceMemorySeries(samples)).toEqual([
      { label: "2026-06-14T12:00:00.000Z", value: 100 },
    ]);
    expect(resourceCpuSeries(samples)).toEqual([{ label: "2026-06-14T12:00:00.000Z", value: 3 }]);
    expect(durationBucketSeries([{ label: "<10ms", minMs: 0, maxMs: 10, count: 2 }])).toEqual([
      { label: "<10ms", value: 2 },
    ]);
  });
});
