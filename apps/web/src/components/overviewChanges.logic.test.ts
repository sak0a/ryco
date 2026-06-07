import { assert, describe, it } from "vite-plus/test";
import { buildOverviewChangesItem } from "./overviewChanges.logic";

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
