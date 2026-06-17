import { useAtomValue } from "@effect/atom-react";
import type {
  ChangeRequest,
  EnvironmentId,
  SourceControlChangeRequestDetail,
  SourceControlWorkflowRunListResult,
} from "@ryco/contracts";
import { useEffect, useMemo } from "react";

import {
  getOverviewChangeRequestDetailKey,
  getOverviewChangeRequestListKey,
  getOverviewQueryAtom,
  getOverviewWorkflowRunJobsAtom,
  getOverviewWorkflowRunJobsKey,
  getOverviewWorkflowRunsKey,
  type OverviewQueryState,
  type OverviewWorkflowRunJobsResult,
  selectOverviewWorkflowRunJobs,
  watchOverviewChangeRequestDetail,
  watchOverviewChangeRequestList,
  watchOverviewWorkflowRunJobs,
  watchOverviewWorkflowRuns,
} from "./overviewAtoms";

/**
 * Atom-backed replacement for the React Query open change-request list used by
 * the overview panel to locate the pull request for the current branch.
 */
export function useOverviewChangeRequestList(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  enabled: boolean;
}): OverviewQueryState<ReadonlyArray<ChangeRequest>> {
  const { environmentId, cwd, enabled } = input;
  const key = getOverviewChangeRequestListKey({ environmentId, cwd, enabled });

  useEffect(
    () => watchOverviewChangeRequestList({ environmentId, cwd, enabled }),
    [environmentId, cwd, enabled],
  );

  return useAtomValue(getOverviewQueryAtom(key)) as OverviewQueryState<
    ReadonlyArray<ChangeRequest>
  >;
}

/**
 * Atom-backed replacement for the React Query pull request detail query. Polls
 * every 30s while the pull request is open, matching the previous behavior.
 */
export function useOverviewPullRequestDetail(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  reference: string | null;
  enabled: boolean;
}): OverviewQueryState<SourceControlChangeRequestDetail> {
  const { environmentId, cwd, reference, enabled } = input;
  const key = getOverviewChangeRequestDetailKey({ environmentId, cwd, reference, enabled });

  useEffect(
    () => watchOverviewChangeRequestDetail({ environmentId, cwd, reference, enabled }),
    [environmentId, cwd, reference, enabled],
  );

  return useAtomValue(
    getOverviewQueryAtom(key),
  ) as OverviewQueryState<SourceControlChangeRequestDetail>;
}

/**
 * Atom-backed replacement for the React Query workflow runs query. The polling
 * interval is computed by the caller (post-push discovery / active-run policy)
 * and re-evaluated after every fetch, matching the previous `refetchInterval`.
 */
export function useOverviewWorkflowRuns(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  pullRequestNumber: number | null;
  commitSha: string | null;
  enabled: boolean;
  resolveIntervalMs: (data: SourceControlWorkflowRunListResult | null) => number | false;
}): OverviewQueryState<SourceControlWorkflowRunListResult> {
  const { environmentId, cwd, pullRequestNumber, commitSha, enabled, resolveIntervalMs } = input;
  const key = getOverviewWorkflowRunsKey({
    environmentId,
    cwd,
    pullRequestNumber,
    commitSha,
    enabled,
  });

  useEffect(
    () =>
      watchOverviewWorkflowRuns(
        { environmentId, cwd, pullRequestNumber, commitSha, enabled },
        resolveIntervalMs,
      ),
    [environmentId, cwd, pullRequestNumber, commitSha, enabled, resolveIntervalMs],
  );

  return useAtomValue(
    getOverviewQueryAtom(key),
  ) as OverviewQueryState<SourceControlWorkflowRunListResult>;
}

/**
 * Atom-backed replacement for the React Query `useQueries` workflow run jobs
 * fetch. Caches jobs per run id and polls the active run every 30s.
 */
export function useOverviewWorkflowRunJobs(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  runIds: ReadonlyArray<string>;
  activeRunId: string | null;
  enabled: boolean;
}): OverviewWorkflowRunJobsResult {
  const { environmentId, cwd, runIds, activeRunId, enabled } = input;
  const key = getOverviewWorkflowRunJobsKey({ environmentId, cwd, runIds, activeRunId, enabled });

  useEffect(
    () => watchOverviewWorkflowRunJobs({ environmentId, cwd, runIds, activeRunId, enabled }),
    [environmentId, cwd, runIds, activeRunId, enabled],
  );

  const map = useAtomValue(getOverviewWorkflowRunJobsAtom(key));

  return useMemo<OverviewWorkflowRunJobsResult>(
    () => selectOverviewWorkflowRunJobs(map, runIds, enabled),
    [map, runIds, enabled],
  );
}
