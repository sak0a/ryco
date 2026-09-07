import { describe, expect, it, vi } from "vite-plus/test";

import {
  makeProcessDiagnostics,
  parseProcessTable,
  selectProcessDescendants,
} from "./ProcessDiagnostics.ts";

const table = parseProcessTable(
  [
    "100 1 Mon Sep 7 10:00:00 2026 0.1 100 S 01:00 /bin/server",
    "101 100 Mon Sep 7 10:00:01 2026 2.5 200 S 00:59 /bin/agent",
    "102 101 Mon Sep 7 10:00:02 2026 5.0 300 R 00:58 /bin/tool",
    "200 1 Mon Sep 7 10:00:03 2026 1.0 400 S 00:57 /bin/unrelated",
  ].join("\n"),
);

describe("process diagnostics", () => {
  it("parses fixed fields and rejects malformed numeric records", () => {
    expect(table).toHaveLength(4);
    expect(table[1]).toMatchObject({
      pid: 101,
      ppid: 100,
      command: "/bin/agent",
      cpuPercent: 2.5,
      rssBytes: 204800,
    });
    expect(parseProcessTable("bad\n101 100 Mon Sep 7 10:00:01 2026 NaN 200 S 00:59 x")).toEqual([]);
  });

  it("limits scope to descendants and preserves tree structure", () => {
    const selected = selectProcessDescendants(table, 100);
    expect(selected.map((entry) => entry.pid)).toEqual([101, 102]);
    expect(selected[0]).toMatchObject({ depth: 0, childPids: [102] });
    expect(selected[1]).toMatchObject({ depth: 1, childPids: [] });
  });

  it("terminates cyclic process ancestry", () => {
    const root = table[0]!;
    expect(
      selectProcessDescendants(
        [
          { ...root, pid: 101, ppid: 100 },
          { ...root, pid: 100, ppid: 101 },
        ],
        100,
      ).map((entry) => entry.pid),
    ).toEqual([101]);
  });

  it("never signals the server, non-descendants, invalid IDs, or reused PIDs", async () => {
    const kill = vi.fn();
    const diagnostics = makeProcessDiagnostics({ query: async () => table, kill, serverPid: 100 });
    const identity = table[1]!.startTimeMs;
    for (const pid of [0, -1, 1, 100, 200, 999, 1.5]) {
      expect(
        (await diagnostics.signal({ pid, startTimeMs: identity, signal: "SIGKILL" })).signaled,
      ).toBe(false);
    }
    expect(
      (await diagnostics.signal({ pid: 101, startTimeMs: identity - 1000, signal: "SIGINT" }))
        .signaled,
    ).toBe(false);
    expect(kill).not.toHaveBeenCalled();
  });

  it("omits the protected resource monitor from actionable descendants and totals", async () => {
    const kill = vi.fn();
    const diagnostics = makeProcessDiagnostics({
      query: async () => table,
      kill,
      serverPid: 100,
      sidecarPid: () => 102,
    });
    const snapshot = await diagnostics.read();
    expect(snapshot.processes.map((entry) => entry.pid)).toEqual([101]);
    expect(snapshot.processes[0]?.childPids).toEqual([]);
    expect(snapshot.totalRssBytes).toBe(table[1]!.rssBytes);
    expect(
      (
        await diagnostics.signal({
          pid: 102,
          startTimeMs: table[2]!.startTimeMs,
          signal: "SIGKILL",
        })
      ).signaled,
    ).toBe(false);
    expect(kill).not.toHaveBeenCalled();
  });

  it("signals only a freshly verified descendant identity", async () => {
    const kill = vi.fn();
    const query = vi.fn(async () => table);
    const diagnostics = makeProcessDiagnostics({ query, kill, serverPid: 100 });
    await diagnostics.read();
    const result = await diagnostics.signal({
      pid: 101,
      startTimeMs: table[1]!.startTimeMs,
      signal: "SIGINT",
    });
    expect(result.signaled).toBe(true);
    expect(query).toHaveBeenCalledTimes(2);
    expect(kill).toHaveBeenCalledWith(101, "SIGINT");
  });

  it("fails closed on collection failure and does not expose command errors", async () => {
    const kill = vi.fn();
    const diagnostics = makeProcessDiagnostics({
      query: async () => {
        throw new Error("secret argv");
      },
      kill,
      serverPid: 100,
    });
    const snapshot = await diagnostics.read();
    expect(snapshot.processes).toEqual([]);
    expect(snapshot.error).not.toContain("secret");
    expect(
      (await diagnostics.signal({ pid: 101, startTimeMs: table[1]!.startTimeMs, signal: "SIGINT" }))
        .signaled,
    ).toBe(false);
    expect(kill).not.toHaveBeenCalled();
  });
});
