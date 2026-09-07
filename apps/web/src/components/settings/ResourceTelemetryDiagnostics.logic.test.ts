import type { ResourceTelemetryProcess } from "@ryco/contracts";
import { describe, expect, it } from "vite-plus/test";
import { visibleTelemetryProcesses } from "./ResourceTelemetryDiagnostics.logic";
const entry = (pid: number, ppid: number, startTimeMs = 1) =>
  ({ identity: { pid, startTimeMs }, ppid }) as ResourceTelemetryProcess;
describe("resource process tree visibility", () => {
  it("collapses an entire subtree independent of input order", () => {
    const processes = [entry(3, 2), entry(2, 1), entry(1, 0), entry(4, 0)];
    expect(
      visibleTelemetryProcesses(processes, new Set(["1:1"])).map((p) => p.identity.pid),
    ).toEqual([1, 4]);
  });
  it("does not inherit collapsed state after PID reuse", () => {
    const processes = [entry(1, 0, 2), entry(2, 1)];
    expect(visibleTelemetryProcesses(processes, new Set(["1:1"]))).toEqual(processes);
  });
  it("terminates safely for malformed cycles and missing parents", () => {
    const processes = [entry(1, 2), entry(2, 1), entry(3, 999)];
    expect(visibleTelemetryProcesses(processes, new Set())).toEqual(processes);
  });
});
