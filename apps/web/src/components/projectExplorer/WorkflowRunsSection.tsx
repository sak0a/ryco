import type {
  EnvironmentId,
  SourceControlWorkflowJob,
  SourceControlWorkflowRun,
  SourceControlWorkflowStep,
} from "@ryco/contracts";
import { DateTime, Option } from "effect";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactNode } from "react";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  CircleDashedIcon,
  Clock3Icon,
  ExternalLinkIcon,
  FileTextIcon,
  GitBranchIcon,
  GitCommitIcon,
  LoaderCircleIcon,
  RotateCwIcon,
  UserIcon,
  XCircleIcon,
} from "lucide-react";
import {
  workflowJobLogQueryOptions,
  workflowRunJobsQueryOptions,
  workflowRunsQueryOptions,
} from "~/lib/sourceControlContextRpc";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";

const dateTimeFmt = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

interface WorkflowRunsSectionProps {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  pullRequestNumber?: number | null;
  title?: string;
  description?: string;
}

type WorkflowTone = "success" | "failure" | "running" | "waiting" | "neutral";

function optionValue<T>(value: Option.Option<T>): T | null {
  return Option.isSome(value) ? value.value : null;
}

function normalizeStatus(value: string | null | undefined): string {
  return value?.trim().toLowerCase().replaceAll("_", " ") ?? "";
}

function isFailure(value: string | null | undefined): boolean {
  return ["failure", "timed out", "action required", "startup failure"].includes(
    normalizeStatus(value),
  );
}

function workflowTone(input: {
  readonly status: string;
  readonly conclusion: string | null;
}): WorkflowTone {
  const status = normalizeStatus(input.status);
  const conclusion = normalizeStatus(input.conclusion);
  if (isFailure(conclusion)) return "failure";
  if (conclusion === "success") return "success";
  if (status === "in progress" || status === "queued") return "running";
  if (status === "waiting" || status === "requested" || status === "pending") return "waiting";
  return "neutral";
}

function toneClasses(tone: WorkflowTone): string {
  switch (tone) {
    case "success":
      return "border-emerald-500/30 bg-emerald-500/8 text-emerald-700 dark:text-emerald-300";
    case "failure":
      return "border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-300";
    case "running":
      return "border-sky-500/30 bg-sky-500/8 text-sky-700 dark:text-sky-300";
    case "waiting":
      return "border-amber-500/30 bg-amber-500/8 text-amber-700 dark:text-amber-300";
    case "neutral":
      return "border-border bg-muted/30 text-muted-foreground";
  }
}

function WorkflowStatusIcon({ tone }: { tone: WorkflowTone }) {
  switch (tone) {
    case "success":
      return <CheckCircle2Icon className="size-3.5" />;
    case "failure":
      return <XCircleIcon className="size-3.5" />;
    case "running":
      return <LoaderCircleIcon className="size-3.5 animate-spin" />;
    case "waiting":
      return <Clock3Icon className="size-3.5" />;
    case "neutral":
      return <CircleDashedIcon className="size-3.5" />;
  }
}

function statusLabel(status: string, conclusion: string | null): string {
  return conclusion ? normalizeStatus(conclusion) : normalizeStatus(status) || "unknown";
}

function formatDate(value: Option.Option<DateTime.Utc>): string | null {
  const dateTime = optionValue(value);
  return dateTime ? dateTimeFmt.format(DateTime.toDate(dateTime)) : null;
}

function formatDuration(value: Option.Option<number>): string | null {
  const ms = optionValue(value);
  if (ms === null) return null;
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainderSeconds = seconds % 60;
  if (minutes < 60)
    return remainderSeconds > 0 ? `${minutes}m ${remainderSeconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainderMinutes = minutes % 60;
  return remainderMinutes > 0 ? `${hours}h ${remainderMinutes}m` : `${hours}h`;
}

function errorMessage(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : fallback;
  const providerMatch = /^Source control provider [^ ]+ failed in [^:]+:\s*(.*)$/u.exec(raw);
  return providerMatch?.[1] ?? raw;
}

function StatusPill(props: { status: string; conclusion: string | null }) {
  const tone = workflowTone(props);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-medium text-[11px]",
        toneClasses(tone),
      )}
    >
      <WorkflowStatusIcon tone={tone} />
      {statusLabel(props.status, props.conclusion)}
    </span>
  );
}

function MetaItem(props: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1 text-muted-foreground">
      {props.icon}
      <span className="truncate">{props.children}</span>
    </span>
  );
}

export function WorkflowRunsSection(props: WorkflowRunsSectionProps) {
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const runsQuery = useQuery(
    workflowRunsQueryOptions({
      environmentId: props.environmentId,
      cwd: props.cwd,
      ...(props.pullRequestNumber !== undefined
        ? { pullRequestNumber: props.pullRequestNumber }
        : {}),
      limit: 20,
    }),
  );

  const runs = runsQuery.data?.runs ?? [];
  const failedRuns = runs.filter((run) => isFailure(optionValue(run.conclusion)));

  return (
    <section className="flex h-full min-h-0 flex-col">
      <header className="flex items-start gap-3 border-border/60 border-b px-4 py-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-sm">{props.title ?? "GitHub Actions"}</h3>
          <p className="mt-0.5 text-muted-foreground text-xs">
            {props.description ??
              (props.pullRequestNumber
                ? "Workflow runs for the pull request head commit."
                : "Recent workflow runs for this repository.")}
          </p>
          {runsQuery.data && Option.isSome(runsQuery.data.headSha) ? (
            <p className="mt-1 font-mono text-muted-foreground/80 text-[11px]">
              head {runsQuery.data.headSha.value.slice(0, 12)}
            </p>
          ) : null}
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => runsQuery.refetch()}
          disabled={runsQuery.isFetching}
        >
          <RotateCwIcon className={runsQuery.isFetching ? "size-3.5 animate-spin" : "size-3.5"} />
          Refresh
        </Button>
      </header>

      {failedRuns.length > 0 ? (
        <div className="border-rose-500/20 border-b bg-rose-500/8 px-4 py-2 text-rose-700 text-xs dark:text-rose-300">
          <span className="inline-flex items-center gap-1.5 font-medium">
            <AlertTriangleIcon className="size-3.5" />
            {failedRuns.length} failed workflow {failedRuns.length === 1 ? "run" : "runs"}
          </span>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {runsQuery.isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Spinner className="size-4" />
            Loading workflow runs…
          </div>
        ) : runsQuery.isError ? (
          <WorkflowStateMessage
            tone="error"
            message={errorMessage(runsQuery.error, "Failed to load workflow runs.")}
          />
        ) : runs.length === 0 ? (
          <WorkflowStateMessage
            tone="empty"
            message={
              props.pullRequestNumber
                ? "No GitHub Actions runs were found for this pull request head commit."
                : "No recent GitHub Actions workflow runs were found."
            }
          />
        ) : (
          <ol className="space-y-2">
            {runs.map((run) => {
              const isExpanded = expandedRunId === run.runId;
              return (
                <li
                  key={run.runId}
                  className={cn(
                    "overflow-hidden rounded-lg border border-border/70 bg-muted/12",
                    isFailure(optionValue(run.conclusion)) ? "border-rose-500/30" : "",
                  )}
                >
                  <WorkflowRunRow
                    run={run}
                    expanded={isExpanded}
                    onToggle={() => setExpandedRunId(isExpanded ? null : run.runId)}
                  />
                  {isExpanded ? (
                    <WorkflowRunJobsPanel
                      environmentId={props.environmentId}
                      cwd={props.cwd}
                      run={run}
                    />
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}

function WorkflowRunRow(props: {
  run: SourceControlWorkflowRun;
  expanded: boolean;
  onToggle: () => void;
}) {
  const conclusion = optionValue(props.run.conclusion);
  const tone = workflowTone({ status: props.run.status, conclusion });
  const startedAt = formatDate(props.run.startedAt);
  const duration = formatDuration(props.run.durationMs);
  const actor = optionValue(props.run.actor);
  const branch = optionValue(props.run.branch);

  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <button
        type="button"
        className="flex min-w-0 flex-1 items-start gap-2 text-left"
        onClick={props.onToggle}
        aria-expanded={props.expanded}
      >
        <ChevronRightIcon
          className={cn(
            "mt-1 size-3.5 shrink-0 text-muted-foreground/70 transition-transform",
            props.expanded ? "rotate-90" : "",
          )}
        />
        <span className={cn("mt-0.5 shrink-0", tone === "failure" ? "text-rose-500" : "")}>
          <WorkflowStatusIcon tone={tone} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate font-medium text-sm">{props.run.workflowName}</span>
            <StatusPill status={props.run.status} conclusion={conclusion} />
          </span>
          {props.run.displayTitle && props.run.displayTitle !== props.run.workflowName ? (
            <span className="mt-0.5 block truncate text-muted-foreground text-xs">
              {props.run.displayTitle}
            </span>
          ) : null}
          <span className="mt-1 flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-[11px]">
            {branch ? (
              <MetaItem icon={<GitBranchIcon className="size-3" />}>
                <span className="font-mono">{branch}</span>
              </MetaItem>
            ) : null}
            <MetaItem icon={<GitCommitIcon className="size-3" />}>
              <span className="font-mono">{props.run.commit.shortOid}</span>
            </MetaItem>
            {actor ? <MetaItem icon={<UserIcon className="size-3" />}>{actor}</MetaItem> : null}
            {startedAt ? (
              <MetaItem icon={<Clock3Icon className="size-3" />}>{startedAt}</MetaItem>
            ) : null}
            {duration ? <span className="text-muted-foreground">{duration}</span> : null}
          </span>
        </span>
      </button>
      <a
        href={props.run.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-muted-foreground text-xs hover:bg-secondary hover:text-foreground"
      >
        <ExternalLinkIcon className="size-3.5" />
        GitHub
      </a>
    </div>
  );
}

function WorkflowRunJobsPanel(props: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  run: SourceControlWorkflowRun;
}) {
  const jobsQuery = useQuery(
    workflowRunJobsQueryOptions({
      environmentId: props.environmentId,
      cwd: props.cwd,
      runId: props.run.runId,
      enabled: true,
    }),
  );

  const jobs = jobsQuery.data?.jobs ?? [];
  const failedJobs = jobs.filter((job) => isFailure(optionValue(job.conclusion)));

  return (
    <div className="border-border/60 border-t bg-background/35 px-3 py-3">
      {jobsQuery.isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-xs">
          <Spinner className="size-3.5" />
          Loading jobs…
        </div>
      ) : jobsQuery.isError ? (
        <WorkflowStateMessage
          tone="error"
          message={errorMessage(jobsQuery.error, "Failed to load workflow jobs.")}
          compact
        />
      ) : jobs.length === 0 ? (
        <WorkflowStateMessage
          tone="empty"
          message="No job details are available for this run."
          compact
        />
      ) : (
        <div className="space-y-2">
          {failedJobs.length > 0 ? (
            <div className="rounded-md border border-rose-500/25 bg-rose-500/8 px-2 py-1.5 text-rose-700 text-xs dark:text-rose-300">
              Failed jobs: {failedJobs.map((job) => job.name).join(", ")}
            </div>
          ) : null}
          <ol className="space-y-2">
            {jobs.map((job) => (
              <WorkflowJobItem
                key={job.jobId}
                job={job}
                runId={props.run.runId}
                environmentId={props.environmentId}
                cwd={props.cwd}
              />
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function WorkflowJobItem(props: {
  job: SourceControlWorkflowJob;
  runId: string;
  environmentId: EnvironmentId | null;
  cwd: string | null;
}) {
  const [showLog, setShowLog] = useState(false);
  const conclusion = optionValue(props.job.conclusion);
  const startedAt = formatDate(props.job.startedAt);
  const duration = formatDuration(props.job.durationMs);
  const failed = isFailure(conclusion);

  return (
    <li
      className={cn(
        "rounded-md border border-border/60 bg-muted/12",
        failed ? "border-rose-500/30 bg-rose-500/5" : "",
      )}
    >
      <div className="flex items-start gap-2 px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate font-medium text-xs">{props.job.name}</span>
            <StatusPill status={props.job.status} conclusion={conclusion} />
            {props.job.url && Option.isSome(props.job.url) ? (
              <a
                href={props.job.url.value}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-muted-foreground text-[11px] hover:text-foreground"
              >
                <ExternalLinkIcon className="size-3" />
                GitHub
              </a>
            ) : null}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground text-[11px]">
            {startedAt ? <span>{startedAt}</span> : null}
            {duration ? <span>{duration}</span> : null}
          </div>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={() => setShowLog((v) => !v)}>
          <FileTextIcon className="size-3.5" />
          {showLog ? "Hide log" : "Load log"}
        </Button>
      </div>
      <WorkflowStepList steps={props.job.steps} />
      {showLog ? (
        <WorkflowJobLog
          environmentId={props.environmentId}
          cwd={props.cwd}
          runId={props.runId}
          jobId={props.job.jobId}
        />
      ) : null}
    </li>
  );
}

function WorkflowStepList({ steps }: { steps: ReadonlyArray<SourceControlWorkflowStep> }) {
  if (steps.length === 0) {
    return (
      <div className="border-border/60 border-t px-3 py-2 text-muted-foreground/70 text-xs">
        No step summaries available.
      </div>
    );
  }

  return (
    <ol className="border-border/60 border-t divide-y divide-border/40">
      {steps.map((step) => {
        const conclusion = optionValue(step.conclusion);
        const duration = formatDuration(step.durationMs);
        return (
          <li
            key={`${step.number}-${step.name}`}
            className="flex items-center gap-2 px-3 py-1.5 text-xs"
          >
            <span className="w-6 shrink-0 font-mono text-muted-foreground text-[10px] tabular-nums">
              {step.number}
            </span>
            <span className="min-w-0 flex-1 truncate">{step.name}</span>
            {duration ? (
              <span className="shrink-0 text-muted-foreground text-[11px]">{duration}</span>
            ) : null}
            <StatusPill status={step.status} conclusion={conclusion} />
          </li>
        );
      })}
    </ol>
  );
}

function WorkflowJobLog(props: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  runId: string;
  jobId: string;
}) {
  const logQuery = useQuery(
    workflowJobLogQueryOptions({
      environmentId: props.environmentId,
      cwd: props.cwd,
      runId: props.runId,
      jobId: props.jobId,
      enabled: true,
    }),
  );

  return (
    <div className="border-border/60 border-t bg-background/60">
      {logQuery.isLoading ? (
        <div className="flex items-center gap-2 px-3 py-2 text-muted-foreground text-xs">
          <Spinner className="size-3.5" />
          Loading log…
        </div>
      ) : logQuery.isError ? (
        <WorkflowStateMessage
          tone="error"
          message={errorMessage(logQuery.error, "Failed to load workflow log.")}
          compact
        />
      ) : logQuery.data && logQuery.data.log.length > 0 ? (
        <>
          {logQuery.data.truncated ? (
            <div className="border-amber-500/20 border-b bg-amber-500/8 px-3 py-1.5 text-amber-700 text-xs dark:text-amber-300">
              Log preview truncated to keep Ryco responsive.
            </div>
          ) : null}
          <pre className="max-h-80 overflow-auto px-3 py-2 font-mono text-[11px] leading-snug">
            {logQuery.data.log}
          </pre>
        </>
      ) : (
        <WorkflowStateMessage tone="empty" message="No log output returned for this job." compact />
      )}
    </div>
  );
}

function WorkflowStateMessage(props: {
  tone: "empty" | "error";
  message: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-md border px-3 text-sm",
        props.compact ? "py-2 text-xs" : "py-4",
        props.tone === "error"
          ? "border-destructive/25 bg-destructive/8 text-destructive"
          : "border-border/70 bg-muted/20 text-muted-foreground",
      )}
    >
      {props.message}
    </div>
  );
}
