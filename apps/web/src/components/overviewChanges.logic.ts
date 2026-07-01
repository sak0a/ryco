import type { TurnDiffSummary } from "../types";

import type { OverviewChangedFile, OverviewFileStatus } from "./overview/overviewTypes";

const TURN_DIFF_KIND_STATUS: Record<string, OverviewFileStatus> = {
  added: "A",
  add: "A",
  a: "A",
  new: "A",
  modified: "M",
  modify: "M",
  changed: "M",
  m: "M",
  deleted: "D",
  delete: "D",
  removed: "D",
  d: "D",
  renamed: "R",
  rename: "R",
  r: "R",
  copied: "C",
  c: "C",
  typechange: "T",
  type: "T",
  t: "T",
};

export function mapTurnDiffKindToStatus(kind: string | undefined): OverviewFileStatus | undefined {
  if (!kind) return undefined;
  return TURN_DIFF_KIND_STATUS[kind.toLowerCase()];
}

export interface OverviewWorkingTreeFile {
  path: string;
  insertions: number;
  deletions: number;
}

/**
 * Build the overview "Changes" file list from the session's turn diff summaries
 * (the same source the Review panel renders) unioned with any uncommitted
 * working-tree files. Turn summaries capture committed *and* uncommitted agent
 * changes, so the list stays populated after the working tree has been
 * committed (which the working-tree-only view could not show). Working-tree
 * files not touched by the agent (e.g. manual edits) are appended so nothing is
 * dropped. Each file is categorized: a file with pending working-tree changes is
 * "local" (needs committing), otherwise "committed".
 */
export function buildOverviewChangedFiles(
  turnDiffSummaries: ReadonlyArray<TurnDiffSummary>,
  workingTreeFiles: ReadonlyArray<OverviewWorkingTreeFile>,
): OverviewChangedFile[] {
  const localPaths = new Set(workingTreeFiles.map((file) => file.path));
  const byPath = new Map<string, OverviewChangedFile>();
  for (const summary of turnDiffSummaries) {
    for (const file of summary.files) {
      const existing = byPath.get(file.path);
      const status = mapTurnDiffKindToStatus(file.kind) ?? existing?.status;
      byPath.set(file.path, {
        path: file.path,
        insertions: (existing?.insertions ?? 0) + (file.additions ?? 0),
        deletions: (existing?.deletions ?? 0) + (file.deletions ?? 0),
        category: localPaths.has(file.path) ? "local" : "committed",
        ...(status ? { status } : {}),
      });
    }
  }
  for (const file of workingTreeFiles) {
    if (byPath.has(file.path)) continue;
    byPath.set(file.path, {
      path: file.path,
      insertions: file.insertions,
      deletions: file.deletions,
      category: "local",
    });
  }
  return [...byPath.values()];
}

export interface OverviewChangeBucket {
  label: string;
  value: string;
  detail?: string;
  additions?: number;
  deletions?: number;
  muted?: boolean;
}

export interface OverviewChangesItemView {
  label: "Changes";
  value: string;
  additions: number;
  deletions: number;
  breakdown?: ReadonlyArray<OverviewChangeBucket>;
}

export interface OverviewLocalChangesInput {
  fileCount: number;
  insertions: number;
  deletions: number;
}

export interface OverviewPullRequestChangesInput {
  changedFiles?: number | null | undefined;
  additions?: number | null | undefined;
  deletions?: number | null | undefined;
  isLoading: boolean;
}

export function formatOverviewFileCount(count: number): string {
  return `${count} ${count === 1 ? "file" : "files"}`;
}

function optionalCount(value: number | null | undefined): number | null {
  return typeof value === "number" ? value : null;
}

export function buildOverviewChangesItem(input: {
  local: OverviewLocalChangesInput;
  pullRequest?: OverviewPullRequestChangesInput | null;
}): OverviewChangesItemView {
  const localFileCount = input.local.fileCount;

  if (!input.pullRequest) {
    return {
      label: "Changes",
      value: localFileCount === 0 ? "No local changes" : formatOverviewFileCount(localFileCount),
      additions: input.local.insertions,
      deletions: input.local.deletions,
    };
  }

  const prChangedFileCount = optionalCount(input.pullRequest.changedFiles);
  const prAdditions = optionalCount(input.pullRequest.additions) ?? 0;
  const prDeletions = optionalCount(input.pullRequest.deletions) ?? 0;
  const hasPrStats =
    prChangedFileCount !== null ||
    optionalCount(input.pullRequest.additions) !== null ||
    optionalCount(input.pullRequest.deletions) !== null;

  const committedBucket: OverviewChangeBucket = hasPrStats
    ? {
        label: "Committed",
        value:
          prChangedFileCount !== null
            ? formatOverviewFileCount(prChangedFileCount)
            : "Files unknown",
        detail: "PR",
        additions: prAdditions,
        deletions: prDeletions,
        muted: prChangedFileCount === 0 && prAdditions === 0 && prDeletions === 0,
      }
    : {
        label: "Committed",
        value: input.pullRequest.isLoading ? "Loading" : "Unavailable",
        detail: "PR",
        muted: true,
      };

  return {
    label: "Changes",
    value: "PR + local",
    additions: input.local.insertions + prAdditions,
    deletions: input.local.deletions + prDeletions,
    breakdown: [
      committedBucket,
      localFileCount === 0
        ? {
            label: "Uncommitted",
            value: "No local changes",
            muted: true,
          }
        : {
            label: "Uncommitted",
            value: formatOverviewFileCount(localFileCount),
            detail: "local",
            additions: input.local.insertions,
            deletions: input.local.deletions,
            muted: false,
          },
    ],
  };
}
