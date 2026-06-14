import type { EnvironmentId, SourceControlWorkflowJob } from "@ryco/contracts";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useGitStatus } from "~/lib/gitStatusState";
import {
  changeRequestDetailQueryOptions,
  changeRequestListQueryOptions,
  sourceControlContextQueryKeys,
  workflowRunJobsQueryOptions,
  workflowRunsQueryOptions,
} from "~/lib/sourceControlContextRpc";
import { cn } from "~/lib/utils";
import PlanSidebar, { type OverviewPanelItem, type OverviewPullRequestState } from "../PlanSidebar";
import type { ActivePlanState, LatestProposedPlanState } from "../../session-logic";
import type { ThreadSubagentView } from "../../threadWorkspaceViewModel";
import type { GitActionPostPushEvent } from "../GitActionsControl";
import {
  createPostPushWorkflowDiscoveryWatch,
  type PostPushWorkflowDiscoveryWatch,
} from "../postPushWorkflowDiscovery.logic";
import {
  areOverviewWorkflowRunsSupported,
  buildOverviewCheckRollupRows,
  buildOverviewItems,
  buildOverviewWorkflowCheckRows,
  compactQueryErrorMessage,
  findChangeRequestForBranch,
  getPrCheckStatusForQuery,
  getPrCheckStatusFromChangeRequest,
  getPrCheckStatusFromWorkflowRuns,
  hasDiscoveredPostPushWorkflowRun,
  isOverviewActiveCheckKind,
  isOverviewActiveWorkflowRun,
  resolveOverviewPullRequestNumber,
  resolveWorkflowDetailRunIds,
  resolveWorkflowRunsRefetchInterval,
  selectActivePostPushWorkflowDiscoveryWatch,
  selectOverviewChecksError,
  shouldRefreshPrCheckStatus,
  sourceControlOptionValue,
  summarizeActiveWorkflowJob,
} from "./ChatOverviewPanel.logic";

export const OVERVIEW_FLOATING_EXIT_DURATION_MS = 260;
export const OVERVIEW_SIDEBAR_EXIT_DURATION_MS = 320;
export const OVERVIEW_SIDEBAR_FRAME_WIDTH = "calc(340px + 0.75rem)";

export function OverviewSidebarMotionFrame(props: {
  animate: boolean;
  children: ReactNode;
  open: boolean;
}) {
  const [entered, setEntered] = useState(!props.animate && props.open);

  useEffect(() => {
    if (!props.animate) {
      setEntered(props.open);
      return;
    }

    if (!props.open) {
      setEntered(false);
      return;
    }

    const frameId = window.requestAnimationFrame(() => setEntered(true));
    return () => window.cancelAnimationFrame(frameId);
  }, [props.animate, props.open]);

  const active = props.animate ? props.open && entered : props.open;

  return (
    <div
      aria-hidden={props.open ? undefined : true}
      inert={props.open ? undefined : true}
      className={cn(
        "h-full min-h-0 shrink-0 overflow-hidden transition-[width,opacity] duration-[320ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none",
        active ? "w-(--overview-sidebar-frame-width) opacity-100" : "w-0 opacity-0",
      )}
      style={
        {
          "--overview-sidebar-frame-width": OVERVIEW_SIDEBAR_FRAME_WIDTH,
        } as CSSProperties
      }
    >
      <div
        className={cn(
          "h-full min-h-0 w-(--overview-sidebar-frame-width) transition-[translate,opacity] duration-[320ms] ease-[cubic-bezier(0.16,1,0.3,1)] will-change-transform motion-reduce:transition-none",
          active ? "translate-x-0 opacity-100" : "translate-x-5 opacity-0",
        )}
      >
        {props.children}
      </div>
    </div>
  );
}

export function FloatingOverviewMotionFrame(props: {
  animate: boolean;
  children: ReactNode;
  open: boolean;
}) {
  const [entered, setEntered] = useState(!props.animate && props.open);

  useEffect(() => {
    if (!props.animate) {
      setEntered(props.open);
      return;
    }

    if (!props.open) {
      setEntered(false);
      return;
    }

    const frameId = window.requestAnimationFrame(() => setEntered(true));
    return () => window.cancelAnimationFrame(frameId);
  }, [props.animate, props.open]);

  const active = props.animate ? props.open && entered : props.open;

  return (
    <div className="pointer-events-none absolute top-3 right-3 z-40">
      <div
        aria-hidden={props.open ? undefined : true}
        inert={props.open ? undefined : true}
        className={cn(
          "origin-top-right transition-[translate,opacity] duration-[260ms] ease-[cubic-bezier(0.16,1,0.3,1)] will-change-transform motion-reduce:transition-none",
          active ? "translate-x-0 opacity-100" : "translate-x-3 opacity-0",
        )}
      >
        {props.children}
      </div>
    </div>
  );
}

export interface ChatOverviewPanelProps {
  environmentId: EnvironmentId;
  gitCwd: string | null;
  activeWorktreeBranch: string | null;
  activeThreadBranch: string | null;
  activeWorktreePrNumber: number | null;
  activeWorktreePrState: string | null | undefined;
  activeWorktreeTitle: string | null | undefined;
  activeThreadKey: string | null;
  activeEnvironmentUnavailableState: {
    label: string;
    connectionState: string;
  } | null;
  activePlan: ActivePlanState | null;
  sidebarProposedPlan: LatestProposedPlanState | null;
  threadSubagents: ReadonlyArray<ThreadSubagentView>;
  sourceControlActions: ReactNode;
  branchControl: ReactNode;
  markdownCwd: string | undefined;
  workspaceRoot: string | undefined;
  mode: "floating" | "sheet" | "sidebar";
  onOpenFiles: () => void;
  onOpenReview: () => void;
  onOpenSubagent: (subagent: ThreadSubagentView) => void;
}

export function usePostPushWorkflowWatch() {
  const queryClient = useQueryClient();
  const [postPushWorkflowWatch, setPostPushWorkflowWatch] =
    useState<PostPushWorkflowDiscoveryWatch | null>(null);

  const handlePostPush = useCallback(
    (event: GitActionPostPushEvent) => {
      setPostPushWorkflowWatch(
        createPostPushWorkflowDiscoveryWatch({
          environmentId: event.environmentId,
          threadKey: event.threadKey,
          cwd: event.cwd,
          pullRequestNumber: event.pullRequestNumber,
          commitSha: event.commitSha,
          nowMs: Date.now(),
        }),
      );
      void queryClient.invalidateQueries({
        queryKey: sourceControlContextQueryKeys.changeRequests(event.environmentId, event.cwd),
      });
      void queryClient.invalidateQueries({
        queryKey: sourceControlContextQueryKeys.workflows(event.environmentId, event.cwd),
      });
    },
    [queryClient],
  );

  useEffect(() => {
    if (!postPushWorkflowWatch) return;
    const timeoutId = window.setTimeout(
      () =>
        setPostPushWorkflowWatch((current) => (current === postPushWorkflowWatch ? null : current)),
      Math.max(0, postPushWorkflowWatch.expiresAtMs - Date.now()),
    );
    return () => window.clearTimeout(timeoutId);
  }, [postPushWorkflowWatch]);

  const clearWatch = useCallback(() => {
    setPostPushWorkflowWatch(null);
  }, []);

  return { postPushWorkflowWatch, handlePostPush, clearWatch } as const;
}

export function ChatOverviewPanel(
  props: ChatOverviewPanelProps & {
    postPushWorkflowWatch: PostPushWorkflowDiscoveryWatch | null;
    onPostPushDiscoveryComplete: () => void;
  },
) {
  const {
    environmentId,
    gitCwd,
    activeWorktreeBranch,
    activeThreadBranch,
    activeWorktreePrNumber,
    activeWorktreePrState,
    activeWorktreeTitle,
    postPushWorkflowWatch,
    activeThreadKey,
    activeEnvironmentUnavailableState,
    activePlan,
    sidebarProposedPlan,
    threadSubagents,
    sourceControlActions,
    branchControl,
    markdownCwd,
    workspaceRoot,
    mode,
    onOpenFiles,
    onOpenReview,
    onOpenSubagent,
    onPostPushDiscoveryComplete,
  } = props;

  const gitStatusQuery = useGitStatus({ environmentId, cwd: gitCwd });
  const overviewBranchName =
    activeWorktreeBranch ?? activeThreadBranch ?? gitStatusQuery.data?.refName ?? null;

  const overviewBranchPullRequestsQuery = useQuery({
    ...changeRequestListQueryOptions({
      environmentId,
      cwd: gitCwd,
      state: "open",
      limit: 50,
      enabled:
        overviewBranchName !== null &&
        activeWorktreePrNumber == null &&
        gitStatusQuery.data?.pr == null,
    }),
  });

  const overviewBranchPullRequest = useMemo(
    () => findChangeRequestForBranch(overviewBranchPullRequestsQuery.data, overviewBranchName),
    [overviewBranchName, overviewBranchPullRequestsQuery.data],
  );

  const postPushWorkflowWatchForContext = selectActivePostPushWorkflowDiscoveryWatch({
    watch: postPushWorkflowWatch,
    environmentId,
    threadKey: activeThreadKey,
    cwd: gitCwd,
    pullRequestNumber: null,
    nowMs: Date.now(),
  });

  const overviewPullRequestNumber = resolveOverviewPullRequestNumber({
    activeWorktreePrNumber,
    gitStatusPrNumber: gitStatusQuery.data?.pr?.number ?? null,
    overviewBranchPullRequestNumber: overviewBranchPullRequest?.number ?? null,
    postPushWatchPullRequestNumber: postPushWorkflowWatchForContext?.pullRequestNumber ?? null,
  });

  const activePostPushWorkflowWatch = selectActivePostPushWorkflowDiscoveryWatch({
    watch: postPushWorkflowWatchForContext,
    environmentId,
    threadKey: activeThreadKey,
    cwd: gitCwd,
    pullRequestNumber: overviewPullRequestNumber,
    nowMs: Date.now(),
  });

  const overviewPullRequestReference =
    overviewPullRequestNumber !== null ? String(overviewPullRequestNumber) : null;
  const overviewGitProvider = gitStatusQuery.data?.sourceControlProvider?.kind ?? null;

  const overviewPullRequestDetailQuery = useQuery({
    ...changeRequestDetailQueryOptions({
      environmentId,
      cwd: gitCwd,
      reference: overviewPullRequestReference,
      enabled: overviewPullRequestNumber !== null,
    }),
    refetchInterval: (query) => {
      const detail = query.state.data;
      return detail?.state === "open" ? 30_000 : false;
    },
  });

  const overviewPullRequestProvider =
    overviewPullRequestDetailQuery.data?.provider ??
    overviewBranchPullRequest?.provider ??
    overviewGitProvider;

  const overviewWorkflowRunsSupported = areOverviewWorkflowRunsSupported(
    overviewPullRequestProvider,
  );

  const overviewWorkflowRunsEnabled =
    overviewWorkflowRunsSupported && overviewPullRequestNumber !== null;

  const overviewWorkflowRunsQuery = useQuery({
    ...workflowRunsQueryOptions({
      environmentId,
      cwd: gitCwd,
      pullRequestNumber: overviewPullRequestNumber,
      commitSha: activePostPushWorkflowWatch?.commitSha ?? null,
      limit: 20,
      enabled: overviewWorkflowRunsEnabled,
    }),
    refetchInterval: (query) => {
      const data = query.state.data;
      const status = data
        ? getPrCheckStatusFromWorkflowRuns({
            runs: data.runs,
            headSha: sourceControlOptionValue(data.headSha),
          })
        : null;
      return resolveWorkflowRunsRefetchInterval({
        activeWatch: activePostPushWorkflowWatch,
        nowMs: Date.now(),
        discoveredPostPushRun: hasDiscoveredPostPushWorkflowRun({
          watch: activePostPushWorkflowWatch,
          runs: data?.runs,
        }),
        statusRefreshable: status ? shouldRefreshPrCheckStatus(status) : false,
      });
    },
  });

  useEffect(() => {
    if (!activePostPushWorkflowWatch) return;
    if (
      !hasDiscoveredPostPushWorkflowRun({
        watch: activePostPushWorkflowWatch,
        runs: overviewWorkflowRunsQuery.data?.runs,
      })
    ) {
      return;
    }
    onPostPushDiscoveryComplete();
  }, [
    activePostPushWorkflowWatch,
    overviewWorkflowRunsQuery.data?.runs,
    onPostPushDiscoveryComplete,
  ]);

  const overviewActiveWorkflowRunId = useMemo(() => {
    const runs = overviewWorkflowRunsQuery.data?.runs ?? [];
    return runs.find(isOverviewActiveWorkflowRun)?.runId ?? null;
  }, [overviewWorkflowRunsQuery.data]);

  const overviewWorkflowDetailRunIds = useMemo(
    () =>
      resolveWorkflowDetailRunIds({
        workflowRunsSupported: overviewWorkflowRunsSupported,
        pullRequestNumber: overviewPullRequestNumber,
        runs: overviewWorkflowRunsQuery.data?.runs,
        activeWorkflowRunId: overviewActiveWorkflowRunId,
      }),
    [
      overviewActiveWorkflowRunId,
      overviewPullRequestNumber,
      overviewWorkflowRunsQuery.data?.runs,
      overviewWorkflowRunsSupported,
    ],
  );

  const overviewWorkflowRunJobQueries = useQueries({
    queries: overviewWorkflowDetailRunIds.map((runId) => ({
      ...workflowRunJobsQueryOptions({
        environmentId,
        cwd: gitCwd,
        runId,
        enabled: overviewWorkflowRunsSupported && overviewPullRequestNumber !== null,
      }),
      refetchInterval: overviewActiveWorkflowRunId === runId ? 30_000 : false,
    })),
  });

  const overviewWorkflowJobsByRunId = useMemo(() => {
    const jobsByRunId = new Map<string, ReadonlyArray<SourceControlWorkflowJob>>();
    overviewWorkflowDetailRunIds.forEach((runId, index) => {
      const jobs = overviewWorkflowRunJobQueries[index]?.data?.jobs;
      if (jobs) {
        jobsByRunId.set(runId, jobs);
      }
    });
    return jobsByRunId;
  }, [overviewWorkflowDetailRunIds, overviewWorkflowRunJobQueries]);

  const overviewWorkflowRunJobsLoading = overviewWorkflowRunJobQueries.some(
    (query) => query.isLoading,
  );

  const overviewPullRequest = useMemo<OverviewPullRequestState | null>(() => {
    if (overviewPullRequestNumber === null) {
      return null;
    }
    const gitPr = gitStatusQuery.data?.pr ?? null;
    const branchPr = overviewBranchPullRequest;
    const detail = overviewPullRequestDetailQuery.data ?? null;
    const workflowData = overviewWorkflowRunsSupported
      ? (overviewWorkflowRunsQuery.data ?? null)
      : null;
    const checksQueryError = selectOverviewChecksError({
      workflowRunsSupported: overviewWorkflowRunsSupported,
      workflowError: overviewWorkflowRunsQuery.error,
      detailError: overviewPullRequestDetailQuery.error,
    });
    const activeWorkflowJobDetail =
      overviewActiveWorkflowRunId === null
        ? undefined
        : summarizeActiveWorkflowJob(overviewWorkflowJobsByRunId.get(overviewActiveWorkflowRunId));
    const checkStatus =
      workflowData && overviewWorkflowRunsSupported
        ? getPrCheckStatusForQuery({
            isLoading: overviewWorkflowRunsQuery.isLoading,
            error: overviewWorkflowRunsQuery.error,
            status: getPrCheckStatusFromWorkflowRuns({
              runs: workflowData.runs,
              headSha: sourceControlOptionValue(workflowData.headSha),
            }),
          })
        : detail
          ? getPrCheckStatusFromChangeRequest(detail)
          : branchPr
            ? getPrCheckStatusFromChangeRequest(branchPr)
            : getPrCheckStatusForQuery({
                isLoading:
                  (overviewWorkflowRunsSupported && overviewWorkflowRunsQuery.isLoading) ||
                  overviewPullRequestDetailQuery.isLoading,
                error: checksQueryError,
                status: null,
              });
    const workflowRows = workflowData
      ? buildOverviewWorkflowCheckRows({
          runs: workflowData.runs,
          jobsByRunId: overviewWorkflowJobsByRunId,
        })
      : [];
    const rollupRows = buildOverviewCheckRollupRows({
      rollup: detail?.checkRollup ?? branchPr?.checkRollup,
    });
    const hasWorkflowJobRows = Array.from(overviewWorkflowJobsByRunId.values()).some(
      (jobs) => jobs.length > 0,
    );
    const latestRuns = hasWorkflowJobRows
      ? workflowRows
      : rollupRows.length > 0
        ? rollupRows
        : workflowRows;
    if (activeWorkflowJobDetail) {
      for (const run of latestRuns) {
        if (
          isOverviewActiveCheckKind(run.statusKind) &&
          overviewActiveWorkflowRunId !== null &&
          run.id.startsWith(`run:${overviewActiveWorkflowRunId}`)
        ) {
          run.activeDetail = activeWorkflowJobDetail;
        }
      }
    }
    const runs = latestRuns.filter((run) => isOverviewActiveCheckKind(run.statusKind));
    const pullRequestUrl = detail?.url ?? gitPr?.url ?? branchPr?.url ?? null;
    const pullRequestState =
      detail?.state ?? activeWorktreePrState ?? gitPr?.state ?? branchPr?.state ?? null;
    const checksError = compactQueryErrorMessage(checksQueryError);

    return {
      number: overviewPullRequestNumber,
      title:
        detail?.title ??
        gitPr?.title ??
        branchPr?.title ??
        activeWorktreeTitle ??
        `Pull request #${overviewPullRequestNumber}`,
      ...(pullRequestUrl ? { url: pullRequestUrl } : {}),
      ...(pullRequestState ? { state: pullRequestState } : {}),
      ...(typeof detail?.commentsCount === "number"
        ? { commentsCount: detail.commentsCount }
        : detail
          ? { commentsCount: detail.comments.length }
          : typeof branchPr?.commentsCount === "number"
            ? { commentsCount: branchPr.commentsCount }
            : {}),
      checkStatus,
      checksLoading:
        (overviewWorkflowRunsSupported && overviewWorkflowRunsQuery.isLoading) ||
        overviewPullRequestDetailQuery.isLoading ||
        overviewWorkflowRunJobsLoading,
      ...(checksError ? { checksError } : {}),
      ...(detail?.mergeability ? { mergeability: detail.mergeability } : {}),
      hasMergeConflicts: detail?.mergeability === "conflicting",
      activeCheckCount:
        runs.length > 0
          ? runs.length
          : checkStatus && isOverviewActiveCheckKind(checkStatus.kind)
            ? 1
            : 0,
      runs,
      latestRuns,
    };
  }, [
    activeWorktreePrState,
    activeWorktreeTitle,
    gitStatusQuery.data?.pr,
    overviewActiveWorkflowRunId,
    overviewBranchPullRequest,
    overviewWorkflowJobsByRunId,
    overviewWorkflowRunJobsLoading,
    overviewPullRequestDetailQuery.data,
    overviewPullRequestDetailQuery.error,
    overviewPullRequestDetailQuery.isLoading,
    overviewPullRequestNumber,
    overviewWorkflowRunsSupported,
    overviewWorkflowRunsQuery.data,
    overviewWorkflowRunsQuery.error,
    overviewWorkflowRunsQuery.isLoading,
  ]);

  const overviewItems = useMemo<OverviewPanelItem[]>(
    () =>
      buildOverviewItems({
        gitStatusData: gitStatusQuery.data,
        overviewPullRequestDetailData: overviewPullRequestDetailQuery.data ?? null,
        overviewPullRequestDetailIsLoading: overviewPullRequestDetailQuery.isLoading,
        overviewPullRequestNumber,
        activeEnvironmentUnavailableState,
      }),
    [
      activeEnvironmentUnavailableState,
      gitStatusQuery.data,
      overviewPullRequestDetailQuery.data,
      overviewPullRequestDetailQuery.isLoading,
      overviewPullRequestNumber,
    ],
  );

  return (
    <PlanSidebar
      activePlan={activePlan}
      activeProposedPlan={sidebarProposedPlan}
      overviewItems={overviewItems}
      pullRequest={overviewPullRequest}
      subagents={threadSubagents}
      sourceControlActions={sourceControlActions}
      branchControl={branchControl}
      environmentId={environmentId}
      markdownCwd={markdownCwd}
      workspaceRoot={workspaceRoot}
      mode={mode}
      onOpenFiles={onOpenFiles}
      onOpenReview={onOpenReview}
      onOpenSubagent={onOpenSubagent}
    />
  );
}

export default ChatOverviewPanel;
