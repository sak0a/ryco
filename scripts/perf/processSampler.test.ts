import { assert, describe, it } from "@effect/vitest";

import { parsePsTable, selectProcessTree } from "./processSampler.ts";

describe("external process-tree sampling", () => {
  it("parses portable ps rows and ignores malformed output", () => {
    assert.deepStrictEqual(
      parsePsTable("  10  1  2048  3.5 node\n  11 10 1024 0.5 helper process\ninvalid\n"),
      [
        { pid: 10, parentPid: 1, rssBytes: 2 * 1024 * 1024, cpuPercent: 3.5, command: "node" },
        {
          pid: 11,
          parentPid: 10,
          rssBytes: 1024 * 1024,
          cpuPercent: 0.5,
          command: "helper process",
        },
      ],
    );
  });

  it("selects all descendants without including unrelated processes", () => {
    const rows = parsePsTable(
      "10 1 1 0 root\n11 10 1 0 child\n12 11 1 0 grandchild\n20 1 1 0 unrelated\n",
    );
    assert.deepStrictEqual(
      selectProcessTree(rows, 10).map((row) => row.pid),
      [10, 11, 12],
    );
  });
});
