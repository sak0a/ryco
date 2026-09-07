import { describe, expect, it } from "vite-plus/test";
import {
  createTelemetryLineReader,
  DESKTOP_TELEMETRY_MAX_BYTES,
  parseDesktopResourceTelemetry,
} from "./desktopResourceTelemetry.ts";

describe("private desktop telemetry protocol", () => {
  it("accepts finite host metrics and rejects malformed or oversized process sets", () => {
    const value = {
      sampledAt: "2026-09-07T12:00:00.000Z",
      electronPid: 12,
      processSample: true,
      power: {
        idleState: "active",
        idleSeconds: 0,
        onBattery: false,
        thermalState: "nominal",
        speedLimitPercent: null,
        suspended: false,
        locked: null,
        lowPowerMode: null,
        updatedAt: "2026-09-07T12:00:00.000Z",
        stale: false,
      },
      processes: [
        {
          pid: 12,
          startTimeMs: 100,
          type: "Browser",
          cpuPercent: 150,
          cpuTimeMs: 30,
          residentBytes: 100,
          privateBytes: 90,
          idleWakeupsPerSecond: 5,
        },
      ],
    };
    expect(parseDesktopResourceTelemetry(value)).toEqual(value);
    expect(
      parseDesktopResourceTelemetry({
        ...value,
        processes: [{ ...value.processes[0], cpuPercent: Infinity }],
      }),
    ).toBeNull();
    expect(
      parseDesktopResourceTelemetry({
        ...value,
        processes: Array.from({ length: 513 }, () => value.processes[0]),
      }),
    ).toBeNull();
    expect(parseDesktopResourceTelemetry({ ...value, sampledAt: "invalid" })).toBeNull();
  });

  it("handles split frames and stops after oversized input", () => {
    const values: unknown[] = [];
    let invalid = 0;
    const read = createTelemetryLineReader(
      (value) => values.push(value),
      () => {
        invalid++;
      },
    );
    read('{"type":');
    read('"sample"}\n');
    expect(values).toEqual([{ type: "sample" }]);
    read("x".repeat(DESKTOP_TELEMETRY_MAX_BYTES + 1));
    read('{"type":"sample"}\n');
    expect(invalid).toBe(1);
    expect(values).toHaveLength(1);
  });
});
