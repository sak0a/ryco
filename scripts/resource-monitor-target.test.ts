import { describe, expect, it } from "vite-plus/test";

import { resourceMonitorBuildTargets } from "./resource-monitor-target.ts";

describe("resource monitor packaging targets", () => {
  it("builds both architectures for universal macOS instead of silently bundling the host binary", () => {
    expect(resourceMonitorBuildTargets("darwin", "universal")).toEqual([
      "aarch64-apple-darwin",
      "x86_64-apple-darwin",
    ]);
    expect(resourceMonitorBuildTargets("win32", "arm64")).toEqual(["aarch64-pc-windows-msvc"]);
    expect(resourceMonitorBuildTargets("linux", "x64")).toEqual(["x86_64-unknown-linux-gnu"]);
  });

  it("rejects unsupported and inherited object keys before running builds", () => {
    for (const [platform, architecture] of [
      ["linux", "universal"],
      ["darwin", "ia32"],
      ["toString", "x64"],
      ["darwin", "constructor"],
    ]) {
      expect(() => resourceMonitorBuildTargets(platform!, architecture!)).toThrow(
        "Unsupported resource monitor target",
      );
    }
  });
});
