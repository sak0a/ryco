import {
  forwardRef,
  memo,
  useState,
  useCallback,
  type ComponentPropsWithoutRef,
  type ReactNode,
  type Ref,
} from "react";
import type { EnvironmentId, SourceControlChangeRequestMergeability } from "@ryco/contracts";
import { Button } from "./ui/button";
import { ScrollArea } from "./ui/scroll-area";
import { Tooltip, TooltipPopup, TooltipProvider, TooltipTrigger } from "./ui/tooltip";
import ChatMarkdown from "./ChatMarkdown";
import {
  CircleCheckIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  FileDiffIcon,
  GitBranchIcon,
  GitCommitIcon,
  GitPullRequestIcon,
  LaptopIcon,
  LoaderCircleIcon,
  LoaderIcon,
  RotateCwIcon,
  XCircleIcon,
} from "lucide-react";
import { cn } from "~/lib/utils";
import type { ActivePlanState } from "../session-logic";
import type { LatestProposedPlanState } from "../session-logic";
import {
  proposedPlanTitle,
  buildProposedPlanMarkdownFilename,
  normalizePlanMarkdownForExport,
  downloadPlanAsTextFile,
  stripDisplayedPlanMarkdown,
} from "../proposedPlan";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "./ui/menu";
import { readEnvironmentApi } from "~/environmentApi";
import { stackedThreadToast, toastManager } from "./ui/toast";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import type { ThreadSubagentView } from "../threadWorkspaceViewModel";
import {
  resolveSidebarStatusTextClassName,
  resolveSidebarStatusTextStyle,
} from "./sidebar/sidebarStatusText";
import { SubagentAvatar } from "./sidebar/SubagentAvatar";
import type { PrCheckStatusView } from "./projectExplorer/prCheckStatus";
import type { OverviewWorkflowCheckRow } from "./overviewPullRequestChecks.logic";

export interface OverviewPanelItem {
  label: string;
  value: string;
  detail?: string;
  additions?: number;
  deletions?: number;
  breakdown?: ReadonlyArray<{
    label: string;
    value: string;
    detail?: string;
    additions?: number;
    deletions?: number;
    muted?: boolean;
  }>;
  action?: "files" | "review";
  icon?: "changes" | "environment";
}

export type OverviewPullRequestCheckRun = OverviewWorkflowCheckRow;

export interface OverviewPullRequestState {
  number: number;
  title: string;
  url?: string;
  state?: string;
  commentsCount?: number;
  checkStatus: PrCheckStatusView | null;
  checksLoading: boolean;
  checksError?: string;
  mergeability?: SourceControlChangeRequestMergeability;
  hasMergeConflicts: boolean;
  activeCheckCount: number;
  runs: ReadonlyArray<OverviewPullRequestCheckRun>;
  latestRuns: ReadonlyArray<OverviewPullRequestCheckRun>;
}

function stepStatusIcon(status: string): React.ReactNode {
  if (status === "completed") {
    return (
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-500">
        <CheckIcon className="size-3" />
      </span>
    );
  }
  if (status === "inProgress") {
    return (
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-blue-500/15 text-blue-400">
        <LoaderIcon className="size-3 animate-spin" />
      </span>
    );
  }
  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-border/60 bg-muted/30">
      <span className="size-1.5 rounded-full bg-muted-foreground/30" />
    </span>
  );
}

interface PlanSidebarProps {
  activePlan: ActivePlanState | null;
  activeProposedPlan: LatestProposedPlanState | null;
  overviewItems?: ReadonlyArray<OverviewPanelItem>;
  pullRequest?: OverviewPullRequestState | null;
  onRefreshPullRequest?: () => void;
  isRefreshingPullRequest?: boolean;
  subagents?: ReadonlyArray<ThreadSubagentView>;
  sourceControlActions?: ReactNode;
  branchControl?: ReactNode;
  environmentId: EnvironmentId;
  markdownCwd: string | undefined;
  workspaceRoot: string | undefined;
  mode?: "floating" | "sheet" | "sidebar";
  onOpenFiles?: () => void;
  onOpenReview?: () => void;
  onOpenSubagent?: (subagent: ThreadSubagentView) => void;
}

function subagentStatusBucket(
  status: ThreadSubagentView["status"],
): "idle" | "in_progress" | "review" | "done" {
  if (status === "running") return "in_progress";
  if (status === "failed") return "review";
  if (status === "finished") return "done";
  return "idle";
}

function subagentStatusLabel(status: ThreadSubagentView["status"]): string {
  if (status === "running") return "Working";
  if (status === "failed") return "Needs review";
  if (status === "finished") return "Finished";
  return "Idle";
}

function SubagentStatusDot({ status }: { status: ThreadSubagentView["status"] }) {
  const dotClassName =
    status === "running"
      ? "bg-sky-400"
      : status === "finished"
        ? "bg-emerald-400"
        : status === "failed"
          ? "bg-destructive"
          : "bg-muted-foreground/30";
  return (
    <span
      className="relative flex size-2 shrink-0 items-center justify-center"
      title={subagentStatusLabel(status)}
    >
      {status === "running" ? (
        <span className="absolute inline-flex size-2 animate-ping rounded-full bg-sky-400/60" />
      ) : null}
      <span className={cn("relative inline-flex size-1.5 rounded-full", dotClassName)} />
    </span>
  );
}

function overviewItemIcon(icon: OverviewPanelItem["icon"]): React.ReactNode {
  if (icon === "changes") {
    return <FileDiffIcon className="size-3.5" />;
  }
  return <LaptopIcon className="size-3.5" />;
}

function ActiveCheckSpinner({ kind }: { kind: "pending" | "running" }): React.ReactNode {
  return (
    <LoaderCircleIcon
      className={cn(
        "size-4 shrink-0 animate-spin",
        kind === "running" ? "text-sky-600 dark:text-sky-300" : "text-amber-400",
      )}
    />
  );
}

function pullRequestCheckCountLabel(count: number, kind: "pending" | "running"): string {
  return `${count} ${kind} ${count === 1 ? "check" : "checks"}`;
}

function resolveActiveCheckKind(
  runs: ReadonlyArray<OverviewPullRequestCheckRun>,
  checkStatus: PrCheckStatusView | null | undefined,
): "pending" | "running" {
  if (runs.some((run) => run.statusKind === "running")) {
    return "running";
  }
  if (runs.some((run) => run.statusKind === "pending")) {
    return "pending";
  }
  return checkStatus?.kind === "pending" ? "pending" : "running";
}

function pullRequestStatusIcon(
  kind: PrCheckStatusView["kind"] | "merge-conflicts",
): React.ReactNode {
  if (kind === "loading") {
    return <LoaderCircleIcon className="size-4 shrink-0 animate-spin text-muted-foreground/55" />;
  }
  if (kind === "pending" || kind === "running") {
    return <ActiveCheckSpinner kind={kind} />;
  }
  if (kind === "passed") {
    return <CircleCheckIcon className="size-4 shrink-0 text-emerald-500" />;
  }
  if (kind === "merge-conflicts" || kind === "failed" || kind === "api-error") {
    return <XCircleIcon className="size-4 shrink-0 text-destructive" />;
  }
  if (kind === "cancelled") {
    return <XCircleIcon className="size-4 shrink-0 text-muted-foreground/55" />;
  }
  return <span className="size-4 shrink-0 rounded-full border border-muted-foreground/35" />;
}

function pullRequestStatusTextClassName(kind: PrCheckStatusView["kind"] | "merge-conflicts") {
  if (kind === "passed") return "text-foreground/90";
  if (kind === "running") return "text-sky-600 dark:text-sky-300";
  if (kind === "pending") return "text-amber-500/85";
  if (kind === "merge-conflicts" || kind === "failed" || kind === "api-error") {
    return "text-muted-foreground/70";
  }
  return "text-muted-foreground/70";
}

interface PullRequestStatusRowProps extends Omit<
  ComponentPropsWithoutRef<"div">,
  "children" | "title"
> {
  icon: React.ReactNode;
  label: string;
  detail?: string | undefined;
  trailing?: React.ReactNode | undefined;
  href?: string | undefined;
  interactive?: boolean | undefined;
}

const PullRequestStatusRow = forwardRef<HTMLElement, PullRequestStatusRowProps>(
  function PullRequestStatusRow(
    { icon, label, detail, className, trailing, href, interactive, ...domProps },
    ref,
  ) {
    const content = (
      <>
        <span className="flex size-5 shrink-0 items-center justify-center">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] leading-5">{label}</span>
          {detail ? (
            <span className="block truncate text-[10px] leading-4 text-muted-foreground/45">
              {detail}
            </span>
          ) : null}
        </span>
        {trailing ? <span className="shrink-0 text-[11px]">{trailing}</span> : null}
      </>
    );

    const rowClassName = cn(
      "flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left",
      (href || interactive) &&
        "transition-colors hover:bg-muted/45 focus-visible:bg-muted/45 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring",
      className,
    );

    if (href) {
      return (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className={rowClassName}
          ref={ref as Ref<HTMLAnchorElement>}
        >
          {content}
        </a>
      );
    }

    if (interactive) {
      return (
        <button
          {...(domProps as ComponentPropsWithoutRef<"button">)}
          type="button"
          className={cn(rowClassName, "appearance-none bg-transparent")}
          ref={ref as Ref<HTMLButtonElement>}
        >
          {content}
        </button>
      );
    }

    return (
      <div {...domProps} className={rowClassName} ref={ref as Ref<HTMLDivElement>}>
        {content}
      </div>
    );
  },
);

function PullRequestChecksTooltipContent({
  runs,
}: {
  runs: ReadonlyArray<OverviewPullRequestCheckRun>;
}) {
  return (
    <div className="max-h-80 w-[28rem] max-w-[calc(100vw-2rem)] overflow-y-auto py-1">
      <div className="mb-1 px-1 text-[10px] font-medium tracking-widest text-muted-foreground/45 uppercase">
        Latest checks
      </div>
      <div className="space-y-0.5">
        {runs.map((run) => (
          <a
            key={run.id}
            href={run.url}
            target={run.url ? "_blank" : undefined}
            rel={run.url ? "noreferrer" : undefined}
            className={cn(
              "flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-[12px]",
              run.url && "transition-colors hover:bg-muted/45",
            )}
          >
            {run.statusLabel === "Skipped" ? (
              <span className="size-4 shrink-0 rounded-full border-2 border-dashed border-muted-foreground/35" />
            ) : (
              pullRequestStatusIcon(run.statusKind)
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-foreground/90">{run.name}</span>
              {run.detail ? (
                <span className="block truncate text-[10px] leading-4 text-muted-foreground/45">
                  {run.detail}
                </span>
              ) : null}
            </span>
            <span
              className={cn(
                "shrink-0 text-muted-foreground/60",
                run.tone === "success" && run.statusLabel !== "Skipped" && "text-emerald-500/90",
                run.tone === "failure" || run.tone === "error" ? "text-destructive/90" : undefined,
                run.tone === "running" && "text-sky-600 dark:text-sky-300",
                run.tone === "pending" && "text-amber-500/85",
              )}
            >
              {run.statusLabel}
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}

const PlanSidebar = memo(function PlanSidebar({
  activePlan,
  activeProposedPlan,
  overviewItems = [],
  pullRequest = null,
  onRefreshPullRequest,
  isRefreshingPullRequest = false,
  subagents = [],
  sourceControlActions,
  branchControl,
  environmentId,
  markdownCwd,
  workspaceRoot,
  mode = "sidebar",
  onOpenFiles,
  onOpenReview,
  onOpenSubagent,
}: PlanSidebarProps) {
  const [proposedPlanExpanded, setProposedPlanExpanded] = useState(false);
  const [isSavingToWorkspace, setIsSavingToWorkspace] = useState(false);
  const { copyToClipboard, isCopied } = useCopyToClipboard();

  const planMarkdown = activeProposedPlan?.planMarkdown ?? null;
  const displayedPlanMarkdown = planMarkdown ? stripDisplayedPlanMarkdown(planMarkdown) : null;
  const planTitle = planMarkdown ? proposedPlanTitle(planMarkdown) : null;

  const handleCopyPlan = useCallback(() => {
    if (!planMarkdown) return;
    copyToClipboard(planMarkdown);
  }, [planMarkdown, copyToClipboard]);

  const handleDownload = useCallback(() => {
    if (!planMarkdown) return;
    const filename = buildProposedPlanMarkdownFilename(planMarkdown);
    downloadPlanAsTextFile(filename, normalizePlanMarkdownForExport(planMarkdown));
  }, [planMarkdown]);

  const handleSaveToWorkspace = useCallback(() => {
    const api = readEnvironmentApi(environmentId);
    if (!api || !workspaceRoot || !planMarkdown) return;
    const filename = buildProposedPlanMarkdownFilename(planMarkdown);
    setIsSavingToWorkspace(true);
    void api.projects
      .writeFile({
        cwd: workspaceRoot,
        relativePath: filename,
        contents: normalizePlanMarkdownForExport(planMarkdown),
      })
      .then((result) => {
        toastManager.add({
          type: "success",
          title: "Plan saved",
          description: result.relativePath,
        });
      })
      .catch((error) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not save plan",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      })
      .then(
        () => setIsSavingToWorkspace(false),
        () => setIsSavingToWorkspace(false),
      );
  }, [environmentId, planMarkdown, workspaceRoot]);

  const pullRequestActiveCheckCount = pullRequest?.activeCheckCount ?? 0;
  const activeCheckKind =
    pullRequest && pullRequestActiveCheckCount > 0
      ? resolveActiveCheckKind(pullRequest.runs, pullRequest.checkStatus)
      : null;
  const pullRequestSummaryKind: PrCheckStatusView["kind"] | null =
    pullRequestActiveCheckCount > 0
      ? activeCheckKind
      : (pullRequest?.checkStatus?.kind ?? (pullRequest?.checksLoading ? "loading" : null));
  const pullRequestSummaryLabel = pullRequest
    ? pullRequestActiveCheckCount > 0
      ? pullRequestCheckCountLabel(pullRequestActiveCheckCount, activeCheckKind ?? "running")
      : (pullRequest.checkStatus?.label ?? "Loading checks")
    : "";
  const primaryActiveRun = pullRequest?.runs[0] ?? null;
  const pullRequestSummaryDetail =
    pullRequestActiveCheckCount > 0
      ? (primaryActiveRun?.activeDetail ?? primaryActiveRun?.detail ?? primaryActiveRun?.name)
      : pullRequest?.checkStatus?.kind === "failed" && pullRequest.checkStatus.failedChecks[0]
        ? pullRequest.checkStatus.failedChecks[0].workflowName
          ? `${pullRequest.checkStatus.failedChecks[0].workflowName} / ${pullRequest.checkStatus.failedChecks[0].name}`
          : pullRequest.checkStatus.failedChecks[0].name
        : pullRequest?.checkStatus?.kind === "api-error"
          ? pullRequest.checksError
          : undefined;

  const contentScroller = (children: ReactNode) =>
    mode === "sidebar" ? (
      <div
        className="min-h-0 max-h-[inherit] overflow-y-auto overscroll-contain [scrollbar-gutter:stable]"
        data-slot="scroll-area-viewport"
      >
        {children}
      </div>
    ) : (
      <ScrollArea className="min-h-0 flex-1" scrollbarGutter>
        {children}
      </ScrollArea>
    );

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col backdrop-blur",
        mode === "sidebar" &&
          "my-3 mr-3 w-[340px] shrink-0 self-start overflow-hidden rounded-lg border border-border/70 bg-card/90 shadow-xl supports-[backdrop-filter]:bg-card/75",
        mode === "sheet" && "h-full w-full bg-card/90 supports-[backdrop-filter]:bg-card/75",
        mode === "floating" &&
          "pointer-events-auto max-h-[min(72vh,42rem)] w-[min(360px,calc(100vw_-_1.5rem))] rounded-lg border border-border/60 bg-card/95 shadow-xl dark:bg-card/90",
      )}
      style={mode === "sidebar" ? { maxHeight: "calc(100% - 1.5rem)" } : undefined}
    >
      {/* Content */}
      {contentScroller(
        <div className="space-y-3 p-2.5">
          {sourceControlActions || branchControl ? (
            <div className="space-y-1.5">
              <p className="px-1 text-[10px] font-semibold tracking-widest text-muted-foreground/40 uppercase">
                Source control
              </p>
              <div className="space-y-1 rounded-md border border-border/50 bg-background/35 p-2">
                {sourceControlActions ? (
                  <div className="@container/header-actions flex min-w-0 items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground/60">
                      <GitCommitIcon className="size-3.5 shrink-0" />
                      <span className="text-[11px]">Actions</span>
                    </div>
                    <div className="flex shrink-0 items-center">{sourceControlActions}</div>
                  </div>
                ) : null}
                {branchControl ? (
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground/60">
                      <GitBranchIcon className="size-3.5 shrink-0" />
                      <span className="text-[11px]">Branch</span>
                    </div>
                    <div className="flex min-w-0 flex-1 justify-end">{branchControl}</div>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {overviewItems.length > 0 ? (
            <div className="space-y-1">
              <p className="px-1 text-[10px] font-semibold tracking-widest text-muted-foreground/40 uppercase">
                Status
              </p>
              {overviewItems.map((item) => {
                const onAction =
                  item.action === "files"
                    ? onOpenFiles
                    : item.action === "review"
                      ? onOpenReview
                      : undefined;
                const content = (
                  <>
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted/45 text-muted-foreground/65">
                      {overviewItemIcon(item.icon)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[10px] text-muted-foreground/45">{item.label}</p>
                          <p className="truncate text-[12px] text-foreground/90">{item.value}</p>
                          {item.detail ? (
                            <p className="mt-0.5 truncate text-[10px] text-muted-foreground/45">
                              {item.detail}
                            </p>
                          ) : null}
                        </div>
                        {typeof item.additions === "number" ||
                        typeof item.deletions === "number" ? (
                          <div className="flex shrink-0 items-center gap-1 pt-3 font-mono text-[11px] tabular-nums">
                            {typeof item.additions === "number" ? (
                              <span className="text-success">+{item.additions}</span>
                            ) : null}
                            {typeof item.deletions === "number" ? (
                              <span className="text-destructive">-{item.deletions}</span>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                      {item.breakdown && item.breakdown.length > 0 ? (
                        <div className="mt-1 space-y-0.5">
                          {item.breakdown.map((entry) => (
                            <div
                              key={`${entry.label}:${entry.value}`}
                              className={cn(
                                "flex min-w-0 items-center justify-between gap-2 rounded-sm py-0.5 pl-0.5 text-[10px]",
                                entry.muted
                                  ? "text-muted-foreground/35"
                                  : "text-muted-foreground/60",
                              )}
                            >
                              <div className="min-w-0">
                                <span className="font-medium">{entry.label}</span>
                                <span className="mx-1 text-muted-foreground/30">·</span>
                                <span>{entry.value}</span>
                                {entry.detail ? (
                                  <>
                                    <span className="mx-1 text-muted-foreground/30">·</span>
                                    <span className="truncate">{entry.detail}</span>
                                  </>
                                ) : null}
                              </div>
                              {typeof entry.additions === "number" ||
                              typeof entry.deletions === "number" ? (
                                <div className="flex shrink-0 items-center gap-1 font-mono tabular-nums">
                                  {typeof entry.additions === "number" ? (
                                    <span
                                      className={cn(
                                        entry.muted ? "text-success/45" : "text-success",
                                      )}
                                    >
                                      +{entry.additions}
                                    </span>
                                  ) : null}
                                  {typeof entry.deletions === "number" ? (
                                    <span
                                      className={cn(
                                        entry.muted ? "text-destructive/45" : "text-destructive",
                                      )}
                                    >
                                      -{entry.deletions}
                                    </span>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </>
                );
                return onAction ? (
                  <button
                    key={`${item.label}:${item.value}`}
                    type="button"
                    className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/50"
                    onClick={onAction}
                  >
                    {content}
                  </button>
                ) : (
                  <div
                    key={`${item.label}:${item.value}`}
                    className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5"
                  >
                    {content}
                  </div>
                );
              })}
            </div>
          ) : null}

          {pullRequest ? (
            <div className="space-y-1.5">
              <div className="flex min-w-0 items-center justify-between gap-2 px-1">
                <p className="text-[10px] font-semibold tracking-widest text-muted-foreground/40 uppercase">
                  Pull Request
                </p>
                {onRefreshPullRequest ? (
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    className="-my-1 shrink-0 text-muted-foreground/50 hover:text-foreground/70"
                    onClick={onRefreshPullRequest}
                    disabled={isRefreshingPullRequest}
                    aria-label="Refresh checks"
                  >
                    <RotateCwIcon
                      className={cn("size-3.5", isRefreshingPullRequest && "animate-spin")}
                    />
                  </Button>
                ) : null}
              </div>
              <div className="rounded-md border border-border/50 bg-background/35 p-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted/45 text-muted-foreground/65">
                    <GitPullRequestIcon className="size-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-medium text-foreground/90">
                      #{pullRequest.number} {pullRequest.title}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground/55">
                      {pullRequest.state ? <span>{pullRequest.state}</span> : null}
                      {typeof pullRequest.commentsCount === "number" ? (
                        <span>
                          {pullRequest.commentsCount}{" "}
                          {pullRequest.commentsCount === 1 ? "comment" : "comments"}
                        </span>
                      ) : null}
                    </p>
                  </div>
                  {pullRequest.url ? (
                    <a
                      href={pullRequest.url}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 rounded-md p-1 text-muted-foreground/55 transition-colors hover:bg-muted/60 hover:text-foreground"
                      aria-label={`Open pull request #${pullRequest.number}`}
                    >
                      <ExternalLinkIcon className="size-3.5" />
                    </a>
                  ) : null}
                </div>
                <div className="mt-2 space-y-0.5">
                  {pullRequestSummaryKind ? (
                    pullRequest.latestRuns.length > 0 ? (
                      <TooltipProvider delay={80} closeDelay={120}>
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <PullRequestStatusRow
                                icon={pullRequestStatusIcon(pullRequestSummaryKind)}
                                label={pullRequestSummaryLabel}
                                detail={pullRequestSummaryDetail}
                                interactive
                                tabIndex={0}
                                aria-label={`${pullRequestSummaryLabel}. Show latest checks.`}
                                className={cn(
                                  "cursor-pointer",
                                  pullRequestStatusTextClassName(pullRequestSummaryKind),
                                )}
                              />
                            }
                          />
                          <TooltipPopup side="left" align="start" className="p-0">
                            <PullRequestChecksTooltipContent runs={pullRequest.latestRuns} />
                          </TooltipPopup>
                        </Tooltip>
                      </TooltipProvider>
                    ) : (
                      <PullRequestStatusRow
                        icon={pullRequestStatusIcon(pullRequestSummaryKind)}
                        label={pullRequestSummaryLabel}
                        detail={pullRequestSummaryDetail}
                        className={pullRequestStatusTextClassName(pullRequestSummaryKind)}
                      />
                    )
                  ) : null}
                  {pullRequest.hasMergeConflicts ? (
                    <PullRequestStatusRow
                      icon={pullRequestStatusIcon("merge-conflicts")}
                      label="Merge conflicts"
                      className={pullRequestStatusTextClassName("merge-conflicts")}
                      trailing={<span className="text-muted-foreground/45">Fix</span>}
                    />
                  ) : null}
                  {pullRequest.checksError && pullRequestSummaryKind !== "api-error" ? (
                    <PullRequestStatusRow
                      icon={pullRequestStatusIcon("api-error")}
                      label="Checks unavailable"
                      detail={pullRequest.checksError}
                      className="text-destructive/90"
                    />
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          {/* Explanation */}
          {activePlan?.explanation ? (
            <p className="text-[13px] leading-relaxed text-muted-foreground/80">
              {activePlan.explanation}
            </p>
          ) : null}

          {/* Plan Steps */}
          {activePlan && activePlan.steps.length > 0 ? (
            <div className="space-y-1">
              <p className="mb-2 text-[10px] font-semibold tracking-widest text-muted-foreground/40 uppercase">
                Steps
              </p>
              {activePlan.steps.map((step) => (
                <div
                  key={`${step.status}:${step.step}`}
                  className={cn(
                    "flex items-start gap-2.5 rounded-lg px-2.5 py-2 transition-colors duration-200",
                    step.status === "inProgress" && "bg-blue-500/5",
                    step.status === "completed" && "bg-emerald-500/5",
                  )}
                >
                  <div className="mt-0.5">{stepStatusIcon(step.status)}</div>
                  <p
                    className={cn(
                      "text-[13px] leading-snug",
                      step.status === "completed"
                        ? "text-muted-foreground/50 line-through decoration-muted-foreground/20"
                        : step.status === "inProgress"
                          ? "text-foreground/90"
                          : "text-muted-foreground/70",
                    )}
                  >
                    {step.step}
                  </p>
                </div>
              ))}
            </div>
          ) : null}

          {/* Proposed Plan Markdown */}
          {planMarkdown ? (
            <div className="space-y-2">
              <div className="flex min-w-0 items-center justify-between gap-2">
                <button
                  type="button"
                  className="group flex min-w-0 flex-1 items-center gap-1.5 text-left"
                  onClick={() => setProposedPlanExpanded((v) => !v)}
                >
                  {proposedPlanExpanded ? (
                    <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground/40 transition-transform" />
                  ) : (
                    <ChevronRightIcon className="size-3 shrink-0 text-muted-foreground/40 transition-transform" />
                  )}
                  <span className="truncate text-[10px] font-semibold tracking-widest text-muted-foreground/40 uppercase group-hover:text-muted-foreground/60">
                    {planTitle ?? "Full Plan"}
                  </span>
                </button>
                <Menu>
                  <MenuTrigger
                    render={
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        className="shrink-0 text-muted-foreground/50 hover:text-foreground/70"
                        aria-label="Plan actions"
                      />
                    }
                  >
                    <EllipsisIcon className="size-3.5" />
                  </MenuTrigger>
                  <MenuPopup align="end">
                    <MenuItem onClick={handleCopyPlan}>
                      {isCopied ? "Copied!" : "Copy to clipboard"}
                    </MenuItem>
                    <MenuItem onClick={handleDownload}>Download as markdown</MenuItem>
                    <MenuItem
                      onClick={handleSaveToWorkspace}
                      disabled={!workspaceRoot || isSavingToWorkspace}
                    >
                      Save to workspace
                    </MenuItem>
                  </MenuPopup>
                </Menu>
              </div>
              {proposedPlanExpanded ? (
                <div className="rounded-lg border border-border/50 bg-background/50 p-3">
                  <ChatMarkdown
                    text={displayedPlanMarkdown ?? ""}
                    cwd={markdownCwd}
                    isStreaming={false}
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Empty state */}
          {!activePlan &&
          !planMarkdown &&
          subagents.length === 0 &&
          overviewItems.length === 0 &&
          !pullRequest &&
          !sourceControlActions &&
          !branchControl ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <p className="text-[13px] text-muted-foreground/40">No active plan yet.</p>
              <p className="mt-1 text-[11px] text-muted-foreground/30">
                Plans and subagents will appear here as the thread runs.
              </p>
            </div>
          ) : null}

          {/* Subagents */}
          {subagents.length > 0 ? (
            <div className="space-y-0.5">
              <p className="mb-1 px-1 text-[10px] font-semibold tracking-widest text-muted-foreground/40 uppercase">
                Subagents
              </p>
              {subagents.map((subagent) => {
                const bucket = subagentStatusBucket(subagent.status);
                return (
                  <button
                    key={subagent.key}
                    type="button"
                    className="group flex w-full min-w-0 items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-muted/40"
                    onClick={() => onOpenSubagent?.(subagent)}
                    aria-label={`${subagent.name} — ${subagentStatusLabel(subagent.status)}`}
                    title={subagent.detail ?? undefined}
                  >
                    <SubagentAvatar name={subagent.name} className="size-5" />
                    <span className="min-w-0 flex-1">
                      <span
                        className={resolveSidebarStatusTextClassName(
                          bucket,
                          "block truncate text-[13px] font-medium",
                        )}
                        style={resolveSidebarStatusTextStyle(subagent.name, {
                          durationSeconds: 2.2,
                        })}
                      >
                        {subagent.name}
                      </span>
                      {subagent.role ? (
                        <span className="block truncate text-[11px] text-muted-foreground/50">
                          {subagent.role}
                        </span>
                      ) : null}
                    </span>
                    <SubagentStatusDot status={subagent.status} />
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>,
      )}
    </div>
  );
});

export default PlanSidebar;
export type { PlanSidebarProps };
