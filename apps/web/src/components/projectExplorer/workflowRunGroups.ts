import type { ChangeRequest, SourceControlWorkflowRun } from "@ryco/contracts";
import { DateTime, Option } from "effect";

type WorkflowGroupChangeRequest = Pick<
  ChangeRequest,
  "headRefName" | "headSha" | "number" | "provider" | "title" | "url"
>;

export type WorkflowRunGroupSource =
  | {
      readonly kind: "pull-request";
      readonly branchName: string | null;
      readonly changeRequest: WorkflowGroupChangeRequest;
    }
  | {
      readonly kind: "branch";
      readonly branchName: string;
    }
  | {
      readonly kind: "unknown";
    };

export interface WorkflowRunGroup {
  readonly id: string;
  readonly source: WorkflowRunGroupSource;
  readonly runs: ReadonlyArray<SourceControlWorkflowRun>;
  readonly latestRun: SourceControlWorkflowRun;
}

interface MutableWorkflowRunGroup {
  readonly id: string;
  readonly source: WorkflowRunGroupSource;
  readonly firstRunIndex: number;
  runs: Array<SourceControlWorkflowRun>;
  latestRun: SourceControlWorkflowRun;
}

function optionValue<T>(value: Option.Option<T> | T | null | undefined): T | null {
  if (
    typeof value === "object" &&
    value !== null &&
    "_tag" in value &&
    (value._tag === "Some" || value._tag === "None")
  ) {
    return Option.getOrNull(value as Option.Option<T>);
  }
  return value ?? null;
}

function trimmedOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function runBranchName(run: SourceControlWorkflowRun): string | null {
  return trimmedOrNull(optionValue(run.branch));
}

function runTimestampMs(run: SourceControlWorkflowRun): number {
  const timestamp = optionValue(run.updatedAt) ?? optionValue(run.startedAt);
  return timestamp ? DateTime.toDate(timestamp).getTime() : 0;
}

function buildChangeRequestIndexes(changeRequests: ReadonlyArray<WorkflowGroupChangeRequest>) {
  const byHeadSha = new Map<string, WorkflowGroupChangeRequest>();
  const byBranch = new Map<string, WorkflowGroupChangeRequest>();

  for (const changeRequest of changeRequests) {
    const headSha = trimmedOrNull(changeRequest.headSha);
    if (headSha && !byHeadSha.has(headSha)) {
      byHeadSha.set(headSha, changeRequest);
    }

    const headRefName = trimmedOrNull(changeRequest.headRefName);
    if (headRefName && !byBranch.has(headRefName)) {
      byBranch.set(headRefName, changeRequest);
    }
  }

  return { byBranch, byHeadSha };
}

function matchingChangeRequest(
  run: SourceControlWorkflowRun,
  indexes: ReturnType<typeof buildChangeRequestIndexes>,
): WorkflowGroupChangeRequest | null {
  const commitOid = trimmedOrNull(run.commit.oid);
  const branchName = runBranchName(run);

  return (
    (commitOid ? indexes.byHeadSha.get(commitOid) : undefined) ??
    (branchName ? indexes.byBranch.get(branchName) : undefined) ??
    null
  );
}

function groupSourceForRun(
  run: SourceControlWorkflowRun,
  indexes: ReturnType<typeof buildChangeRequestIndexes>,
): WorkflowRunGroupSource {
  const branchName = runBranchName(run);
  const changeRequest = matchingChangeRequest(run, indexes);

  if (changeRequest) {
    return { kind: "pull-request", branchName, changeRequest };
  }
  if (branchName) {
    return { kind: "branch", branchName };
  }
  return { kind: "unknown" };
}

function groupIdForSource(source: WorkflowRunGroupSource): string {
  switch (source.kind) {
    case "pull-request":
      return `pr:${source.changeRequest.provider}:${source.changeRequest.number}`;
    case "branch":
      return `branch:${source.branchName}`;
    case "unknown":
      return "unknown";
  }
}

export function groupWorkflowRunsBySource(input: {
  readonly runs: ReadonlyArray<SourceControlWorkflowRun>;
  readonly changeRequests: ReadonlyArray<WorkflowGroupChangeRequest>;
}): ReadonlyArray<WorkflowRunGroup> {
  const indexes = buildChangeRequestIndexes(input.changeRequests);
  const groups = new Map<string, MutableWorkflowRunGroup>();

  input.runs.forEach((run, index) => {
    const source = groupSourceForRun(run, indexes);
    const id = groupIdForSource(source);
    const existing = groups.get(id);

    if (existing) {
      existing.runs.push(run);
      if (runTimestampMs(run) > runTimestampMs(existing.latestRun)) {
        existing.latestRun = run;
      }
      return;
    }

    groups.set(id, {
      id,
      source,
      firstRunIndex: index,
      runs: [run],
      latestRun: run,
    });
  });

  return Array.from(groups.values())
    .toSorted((a, b) => {
      const byLatestRun = runTimestampMs(b.latestRun) - runTimestampMs(a.latestRun);
      return byLatestRun === 0 ? a.firstRunIndex - b.firstRunIndex : byLatestRun;
    })
    .map((group) => ({
      id: group.id,
      source: group.source,
      runs: group.runs,
      latestRun: group.latestRun,
    }));
}
