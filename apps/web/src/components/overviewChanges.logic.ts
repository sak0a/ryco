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
 * Build the overview "Changes" file list from three sources, in precedence
 * order:
 *  1. The session's turn diff summaries (the same source the Review panel
 *     renders) — these carry the M/A/D status letter and this session's
 *     committed *and* uncommitted agent changes.
 *  2. Uncommitted working-tree files not already seen (e.g. manual edits).
 *  3. Committed-vs-base files from git (`git diff base...HEAD`) not already
 *     seen — commits from earlier sessions or work already pushed to the PR
 *     that this session's turn summaries don't include. Without this, a clean
 *     working tree with no session turns would show nothing even though the
 *     branch/PR has committed changes.
 * Each file is categorized: a file with pending working-tree changes is "local"
 * (needs committing), otherwise "committed".
 */
export function buildOverviewChangedFiles(
  turnDiffSummaries: ReadonlyArray<TurnDiffSummary>,
  workingTreeFiles: ReadonlyArray<OverviewWorkingTreeFile>,
  committedFiles: ReadonlyArray<OverviewWorkingTreeFile> = [],
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
  for (const file of committedFiles) {
    if (byPath.has(file.path)) continue;
    byPath.set(file.path, {
      path: file.path,
      insertions: file.insertions,
      deletions: file.deletions,
      category: "committed",
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

export interface OverviewChangesBucketTotals {
  fileCount: number;
  insertions: number;
  deletions: number;
}

export function formatOverviewFileCount(count: number): string {
  return `${count} ${count === 1 ? "file" : "files"}`;
}

function sumChangedFiles(files: ReadonlyArray<OverviewChangedFile>): OverviewChangesBucketTotals {
  let insertions = 0;
  let deletions = 0;
  for (const file of files) {
    insertions += file.insertions;
    deletions += file.deletions;
  }
  return { fileCount: files.length, insertions, deletions };
}

/**
 * Split a changed-file list into committed vs uncommitted (local) totals. Files
 * with an unknown category are treated as local — matching how the Changes file
 * list buckets them — so nothing is dropped.
 */
export function partitionOverviewChangedFiles(files: ReadonlyArray<OverviewChangedFile>): {
  committed: OverviewChangesBucketTotals;
  local: OverviewChangesBucketTotals;
} {
  return {
    committed: sumChangedFiles(files.filter((file) => file.category === "committed")),
    local: sumChangedFiles(files.filter((file) => file.category !== "committed")),
  };
}

/**
 * Build the collapsed "Changes" summary item from the same committed/local
 * buckets the expanded file list renders (see {@link buildOverviewChangedFiles}
 * and {@link partitionOverviewChangedFiles}). Deriving both from one source
 * keeps the summary line, the +/- totals, and the file list in agreement, and
 * — because turn summaries capture committed changes — counts committed work
 * that has not been pushed yet, which a working-tree-only view would miss.
 */
export function buildOverviewChangesItem(input: {
  committed: OverviewChangesBucketTotals;
  local: OverviewChangesBucketTotals;
  pullRequestNumber?: number | null | undefined;
}): OverviewChangesItemView {
  const { committed, local } = input;
  const additions = committed.insertions + local.insertions;
  const deletions = committed.deletions + local.deletions;
  const hasCommitted = committed.fileCount > 0;
  const hasLocal = local.fileCount > 0;

  if (!hasCommitted && !hasLocal) {
    return { label: "Changes", value: "No changes", additions: 0, deletions: 0 };
  }

  if (hasCommitted && hasLocal) {
    const committedBucket: OverviewChangeBucket = {
      label: "Committed",
      value: formatOverviewFileCount(committed.fileCount),
      ...(input.pullRequestNumber ? { detail: `PR #${input.pullRequestNumber}` } : {}),
      additions: committed.insertions,
      deletions: committed.deletions,
      muted: false,
    };
    const uncommittedBucket: OverviewChangeBucket = {
      label: "Uncommitted",
      value: formatOverviewFileCount(local.fileCount),
      detail: "local",
      additions: local.insertions,
      deletions: local.deletions,
      muted: false,
    };
    return {
      label: "Changes",
      value: "Committed + local",
      additions,
      deletions,
      breakdown: [committedBucket, uncommittedBucket],
    };
  }

  // Exactly one bucket has changes → a flat file-count summary reads cleaner
  // than a single-row breakdown.
  const fileCount = hasCommitted ? committed.fileCount : local.fileCount;
  return {
    label: "Changes",
    value: formatOverviewFileCount(fileCount),
    additions,
    deletions,
  };
}
