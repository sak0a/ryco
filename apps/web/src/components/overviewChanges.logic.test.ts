import { assert, describe, it } from "vite-plus/test";

import type { TurnId } from "@ryco/contracts";

import type { TurnDiffSummary } from "../types";
import type { OverviewChangedFile } from "./overview/overviewTypes";
import {
  buildOverviewChangedFiles,
  buildOverviewChangesItem,
  mapTurnDiffKindToStatus,
  partitionOverviewChangedFiles,
} from "./overviewChanges.logic";

function turnSummary(turnId: string, files: TurnDiffSummary["files"]): TurnDiffSummary {
  return { turnId: turnId as TurnId, completedAt: "2026-07-01T00:00:00.000Z", files };
}

describe("buildOverviewChangedFiles", () => {
  it("uses session turn diffs so committed changes stay visible when the working tree is clean", () => {
    const files = buildOverviewChangedFiles(
      [
        turnSummary("t1", [
          { path: "src/a.ts", kind: "modified", additions: 10, deletions: 2 },
          { path: "src/new.ts", kind: "added", additions: 6, deletions: 0 },
        ]),
      ],
      [], // working tree clean (already committed)
    );
    assert.deepEqual(files, [
      { path: "src/a.ts", insertions: 10, deletions: 2, category: "committed", status: "M" },
      { path: "src/new.ts", insertions: 6, deletions: 0, category: "committed", status: "A" },
    ]);
  });

  it("aggregates a file touched across multiple turns by path", () => {
    const files = buildOverviewChangedFiles(
      [
        turnSummary("t1", [{ path: "src/a.ts", kind: "added", additions: 5, deletions: 0 }]),
        turnSummary("t2", [{ path: "src/a.ts", kind: "modified", additions: 3, deletions: 1 }]),
      ],
      [],
    );
    assert.deepEqual(files, [
      { path: "src/a.ts", insertions: 8, deletions: 1, category: "committed", status: "M" },
    ]);
  });

  it("marks files with pending working-tree edits as local and appends manual edits", () => {
    const files = buildOverviewChangedFiles(
      [turnSummary("t1", [{ path: "src/a.ts", kind: "modified", additions: 4, deletions: 0 }])],
      [
        { path: "src/a.ts", insertions: 4, deletions: 0 },
        { path: "src/manual.ts", insertions: 2, deletions: 1 },
      ],
    );
    assert.deepEqual(files, [
      { path: "src/a.ts", insertions: 4, deletions: 0, category: "local", status: "M" },
      { path: "src/manual.ts", insertions: 2, deletions: 1, category: "local" },
    ]);
  });

  it("falls back to the working tree when there are no turn summaries", () => {
    const files = buildOverviewChangedFiles(
      [],
      [{ path: "src/x.ts", insertions: 1, deletions: 1 }],
    );
    assert.deepEqual(files, [{ path: "src/x.ts", insertions: 1, deletions: 1, category: "local" }]);
  });

  it("folds in committed-vs-base files that the session's turn summaries miss", () => {
    const files = buildOverviewChangedFiles(
      [], // no turn summaries (e.g. fresh session on an existing branch/PR)
      [{ path: "src/local.ts", insertions: 2, deletions: 0 }], // uncommitted
      [
        { path: "src/pushed.ts", insertions: 20, deletions: 5 }, // committed on the branch
        { path: "src/local.ts", insertions: 9, deletions: 9 }, // also has pending edits → stays local
      ],
    );
    assert.deepEqual(files, [
      { path: "src/local.ts", insertions: 2, deletions: 0, category: "local" },
      { path: "src/pushed.ts", insertions: 20, deletions: 5, category: "committed" },
    ]);
  });

  it("does not duplicate a committed file already surfaced by a turn summary", () => {
    const files = buildOverviewChangedFiles(
      [turnSummary("t1", [{ path: "src/a.ts", kind: "modified", additions: 10, deletions: 2 }])],
      [],
      [{ path: "src/a.ts", insertions: 99, deletions: 99 }],
    );
    assert.deepEqual(files, [
      { path: "src/a.ts", insertions: 10, deletions: 2, category: "committed", status: "M" },
    ]);
  });
});

describe("mapTurnDiffKindToStatus", () => {
  it("maps kinds to M/A/D letters and ignores unknowns", () => {
    assert.equal(mapTurnDiffKindToStatus("modified"), "M");
    assert.equal(mapTurnDiffKindToStatus("added"), "A");
    assert.equal(mapTurnDiffKindToStatus("deleted"), "D");
    assert.equal(mapTurnDiffKindToStatus("renamed"), "R");
    assert.equal(mapTurnDiffKindToStatus(undefined), undefined);
    assert.equal(mapTurnDiffKindToStatus("something-else"), undefined);
  });
});

function changedFile(
  path: string,
  category: OverviewChangedFile["category"],
  insertions: number,
  deletions: number,
): OverviewChangedFile {
  return { path, category, insertions, deletions };
}

describe("partitionOverviewChangedFiles", () => {
  it("splits by category and treats unknown category as local", () => {
    const { committed, local } = partitionOverviewChangedFiles([
      changedFile("src/a.ts", "committed", 10, 2),
      changedFile("src/b.ts", "committed", 4, 0),
      changedFile("src/c.ts", "local", 3, 1),
      changedFile("src/d.ts", undefined, 5, 5),
    ]);
    assert.deepEqual(committed, { fileCount: 2, insertions: 14, deletions: 2 });
    assert.deepEqual(local, { fileCount: 2, insertions: 8, deletions: 6 });
  });
});

describe("buildOverviewChangesItem", () => {
  const empty = { fileCount: 0, insertions: 0, deletions: 0 } as const;

  it("shows a no-changes empty state when both buckets are empty", () => {
    assert.deepEqual(buildOverviewChangesItem({ committed: empty, local: empty }), {
      label: "Changes",
      value: "No changes",
      additions: 0,
      deletions: 0,
    });
  });

  it("renders a flat summary when only local changes exist", () => {
    assert.deepEqual(
      buildOverviewChangesItem({
        committed: empty,
        local: { fileCount: 1, insertions: 5, deletions: 0 },
      }),
      {
        label: "Changes",
        value: "1 file",
        additions: 5,
        deletions: 0,
      },
    );
  });

  it("renders a flat summary when only committed changes exist (committed-but-unpushed)", () => {
    assert.deepEqual(
      buildOverviewChangesItem({
        committed: { fileCount: 3, insertions: 40, deletions: 8 },
        local: empty,
      }),
      {
        label: "Changes",
        value: "3 files",
        additions: 40,
        deletions: 8,
      },
    );
  });

  it("splits committed from uncommitted and sums both into the totals", () => {
    assert.deepEqual(
      buildOverviewChangesItem({
        committed: { fileCount: 12, insertions: 40, deletions: 8 },
        local: { fileCount: 3, insertions: 10, deletions: 4 },
        pullRequestNumber: 42,
      }),
      {
        label: "Changes",
        value: "Committed + local",
        additions: 50,
        deletions: 12,
        breakdown: [
          {
            label: "Committed",
            value: "12 files",
            detail: "PR #42",
            additions: 40,
            deletions: 8,
            muted: false,
          },
          {
            label: "Uncommitted",
            value: "3 files",
            detail: "local",
            additions: 10,
            deletions: 4,
            muted: false,
          },
        ],
      },
    );
  });

  it("omits the PR label on the committed bucket when there is no pull request", () => {
    const item = buildOverviewChangesItem({
      committed: { fileCount: 2, insertions: 6, deletions: 1 },
      local: { fileCount: 1, insertions: 2, deletions: 0 },
    });
    assert.equal(item.breakdown?.[0]?.detail, undefined);
  });
});
