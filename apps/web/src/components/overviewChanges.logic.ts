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
      {
        label: "Uncommitted",
        value: formatOverviewFileCount(localFileCount),
        detail: "local",
        additions: input.local.insertions,
        deletions: input.local.deletions,
        muted: localFileCount === 0,
      },
    ],
  };
}
