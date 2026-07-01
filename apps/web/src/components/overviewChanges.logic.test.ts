import { assert, describe, it } from "vite-plus/test";

import type { TurnId } from "@ryco/contracts";

import type { TurnDiffSummary } from "../types";
import {
  buildOverviewChangedFiles,
  buildOverviewChangesItem,
  mapTurnDiffKindToStatus,
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

describe("buildOverviewChangesItem", () => {
  it("keeps the existing local-only empty state", () => {
    assert.deepEqual(
      buildOverviewChangesItem({
        local: {
          fileCount: 0,
          insertions: 0,
          deletions: 0,
        },
        pullRequest: null,
      }),
      {
        label: "Changes",
        value: "No local changes",
        additions: 0,
        deletions: 0,
      },
    );
  });

  it("splits committed PR changes from uncommitted local changes", () => {
    assert.deepEqual(
      buildOverviewChangesItem({
        local: {
          fileCount: 3,
          insertions: 10,
          deletions: 4,
        },
        pullRequest: {
          changedFiles: 12,
          additions: 40,
          deletions: 8,
          isLoading: false,
        },
      }),
      {
        label: "Changes",
        value: "PR + local",
        additions: 50,
        deletions: 12,
        breakdown: [
          {
            label: "Committed",
            value: "12 files",
            detail: "PR",
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

  it("still shows the uncommitted bucket while PR details load", () => {
    assert.deepEqual(
      buildOverviewChangesItem({
        local: {
          fileCount: 1,
          insertions: 5,
          deletions: 0,
        },
        pullRequest: {
          isLoading: true,
        },
      }),
      {
        label: "Changes",
        value: "PR + local",
        additions: 5,
        deletions: 0,
        breakdown: [
          {
            label: "Committed",
            value: "Loading",
            detail: "PR",
            muted: true,
          },
          {
            label: "Uncommitted",
            value: "1 file",
            detail: "local",
            additions: 5,
            deletions: 0,
            muted: false,
          },
        ],
      },
    );
  });

  it("uses the clean local wording when PR changes exist but local changes are empty", () => {
    assert.deepEqual(
      buildOverviewChangesItem({
        local: {
          fileCount: 0,
          insertions: 0,
          deletions: 0,
        },
        pullRequest: {
          changedFiles: 8,
          additions: 24,
          deletions: 6,
          isLoading: false,
        },
      }),
      {
        label: "Changes",
        value: "PR + local",
        additions: 24,
        deletions: 6,
        breakdown: [
          {
            label: "Committed",
            value: "8 files",
            detail: "PR",
            additions: 24,
            deletions: 6,
            muted: false,
          },
          {
            label: "Uncommitted",
            value: "No local changes",
            muted: true,
          },
        ],
      },
    );
  });
});
