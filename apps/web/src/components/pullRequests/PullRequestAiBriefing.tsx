import type { PullRequestAiAnalysis } from "@ryco/contracts";
import { DateTime, Option } from "effect";
import {
  ArrowRightIcon,
  BrainCircuitIcon,
  FileWarningIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  SparklesIcon,
} from "lucide-react";

import { cn } from "~/lib/utils";
import { Button } from "../ui/button";

interface PullRequestAiBriefingProps {
  readonly analysis: PullRequestAiAnalysis | null;
  readonly running: boolean;
  readonly disabled?: boolean | undefined;
  readonly onAnalyze: () => void;
  readonly onOpenFiles: () => void;
}

const analyzedAtFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function words(value: string): string {
  return value.replaceAll("-", " ");
}

function riskTone(risk: PullRequestAiAnalysis["assessment"]["risk"]): string {
  switch (risk) {
    case "high":
      return "border-rose-500/25 bg-rose-500/8 text-rose-700 dark:text-rose-300";
    case "medium":
      return "border-amber-500/25 bg-amber-500/8 text-amber-700 dark:text-amber-300";
    case "low":
      return "border-emerald-500/20 bg-emerald-500/7 text-emerald-700 dark:text-emerald-300";
    case "uncertain":
      return "border-border/55 bg-background/25 text-muted-foreground";
  }
}

function priorityTone(priority: PullRequestAiAnalysis["priority"]): string {
  switch (priority) {
    case "urgent":
      return "text-rose-700 dark:text-rose-300";
    case "high":
      return "text-amber-700 dark:text-amber-300";
    case "normal":
      return "text-sky-700 dark:text-sky-300";
    case "low":
      return "text-muted-foreground";
  }
}

function ReadinessDial({ analysis }: { readonly analysis: PullRequestAiAnalysis }) {
  const readiness = Option.getOrNull(analysis.mergeReadiness);
  if (!readiness) {
    return (
      <div className="flex min-h-28 flex-col items-center justify-center rounded-xl border border-border/45 bg-background/24 px-4 text-center">
        <ShieldCheckIcon className="size-5 text-muted-foreground/55" />
        <p className="mt-2 font-medium text-[11px]">Readiness not applicable</p>
        <p className="mt-1 text-[9px] text-muted-foreground">
          This pull request is no longer open.
        </p>
      </div>
    );
  }
  const circumference = 2 * Math.PI * 35;
  const offset = circumference * (1 - readiness.score / 100);
  const scoreTone =
    readiness.score >= 80
      ? "stroke-emerald-500"
      : readiness.score >= 55
        ? "stroke-sky-500"
        : readiness.score >= 35
          ? "stroke-amber-500"
          : "stroke-rose-500";
  return (
    <div className="flex min-h-28 items-center gap-3 rounded-xl border border-border/45 bg-background/24 px-3.5">
      <div className="relative size-[78px] shrink-0">
        <svg viewBox="0 0 84 84" className="size-full -rotate-90" aria-hidden="true">
          <circle
            cx="42"
            cy="42"
            r="35"
            fill="none"
            strokeWidth="6"
            className="stroke-foreground/8"
          />
          <circle
            cx="42"
            cy="42"
            r="35"
            fill="none"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className={cn("transition-[stroke-dashoffset] duration-700", scoreTone)}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-heading font-semibold text-xl tabular-nums">{readiness.score}</span>
          <span className="text-[8px] text-muted-foreground">of 100</span>
        </div>
      </div>
      <div className="min-w-0">
        <p className="font-medium text-[11px]">Merge readiness</p>
        <p className="mt-1 text-[9px] leading-relaxed text-muted-foreground">
          {readiness.insufficientEvidence
            ? "Limited provider evidence — treat this as a directional estimate."
            : `${readiness.confidence}% evidence confidence across checks, review, mergeability, and implementation.`}
        </p>
        {readiness.appliedCaps[0] ? (
          <p className="mt-1.5 line-clamp-2 text-[9px] text-amber-700 dark:text-amber-300">
            {readiness.appliedCaps[0]}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function PullRequestAiBriefing(props: PullRequestAiBriefingProps) {
  if (!props.analysis) {
    return (
      <section className="pull-request-detail-glass relative mt-5 overflow-hidden rounded-2xl border border-sky-500/16 bg-sky-500/[0.025] px-4 py-3.5">
        <div className="flex items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-sky-500/16 bg-sky-500/7 text-sky-700 shadow-[inset_0_1px_0_rgb(255_255_255/0.16)] dark:text-sky-300">
            <BrainCircuitIcon className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-heading font-medium text-sm">AI review briefing</p>
            <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
              Generate a read-only summary, risk scan, review hotspots, priority, and explainable
              merge-readiness estimate.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={props.disabled || props.running}
            onClick={props.onAnalyze}
            className="shrink-0 rounded-xl bg-background/35 backdrop-blur-xl"
          >
            {props.running ? (
              <RefreshCwIcon className="size-3.5 animate-spin" />
            ) : (
              <SparklesIcon className="size-3.5" />
            )}
            {props.running ? "Analyzing" : "Analyze PR"}
          </Button>
        </div>
      </section>
    );
  }

  const { analysis } = props;
  const assessment = analysis.assessment;
  return (
    <section className="pull-request-detail-glass relative mt-5 overflow-hidden rounded-2xl border border-sky-500/16 bg-sky-500/[0.025] p-1 shadow-[inset_0_1px_0_rgb(255_255_255/0.12)]">
      <div className="rounded-[0.8rem] bg-background/24 px-4 py-3.5 backdrop-blur-2xl">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 font-heading font-medium text-[11px] text-sky-800 dark:text-sky-200">
            <BrainCircuitIcon className="size-3.5" /> AI review briefing
          </span>
          <span
            className={cn(
              "font-mono text-[9px] uppercase tracking-[0.12em]",
              priorityTone(analysis.priority),
            )}
          >
            {analysis.priority} · {analysis.priorityScore}
          </span>
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 text-[9px] capitalize",
              riskTone(assessment.risk),
            )}
          >
            {assessment.risk} risk
          </span>
          <span className="text-[9px] capitalize text-muted-foreground">
            {words(assessment.implementationPhase)} · {analysis.depth}
          </span>
          {analysis.isStale ? (
            <span className="rounded-full border border-amber-500/20 bg-amber-500/7 px-2 py-0.5 text-[9px] text-amber-700 dark:text-amber-300">
              Inputs changed · refresh recommended
            </span>
          ) : null}
          <div className="ml-auto flex items-center gap-2 text-[9px] text-muted-foreground">
            <span>{analysis.modelSelection.model}</span>
            <span className="opacity-35">·</span>
            <span>{analyzedAtFormatter.format(DateTime.toDate(analysis.analyzedAt))}</span>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Refresh AI review briefing"
              disabled={props.disabled || props.running}
              onClick={props.onAnalyze}
            >
              <RefreshCwIcon className={cn("size-3", props.running && "animate-spin")} />
            </Button>
          </div>
        </div>

        <div className="mt-3 grid gap-3 @[46rem]/pr-detail:grid-cols-[minmax(0,1fr)_17rem]">
          <div className="min-w-0">
            <p className="max-w-[80ch] text-[13px] leading-[1.6] text-foreground/88">
              {assessment.summary}
            </p>
            <div className="mt-3 grid gap-2 @[58rem]/pr-detail:grid-cols-2">
              <div className="rounded-xl border border-border/40 bg-background/22 px-3 py-2.5">
                <p className="text-[8px] font-semibold uppercase tracking-[0.13em] text-muted-foreground/70">
                  Why it needs attention
                </p>
                <p className="mt-1 text-[10px] leading-relaxed text-foreground/74">
                  {assessment.attentionReason}
                </p>
              </div>
              <div className="rounded-xl border border-border/40 bg-background/22 px-3 py-2.5">
                <p className="text-[8px] font-semibold uppercase tracking-[0.13em] text-muted-foreground/70">
                  Suggested next move
                </p>
                <p className="mt-1 text-[10px] leading-relaxed text-foreground/74">
                  {assessment.suggestedNextAction}
                </p>
              </div>
            </div>
          </div>
          <ReadinessDial analysis={analysis} />
        </div>

        {assessment.hotspots.length > 0 ? (
          <button
            type="button"
            onClick={props.onOpenFiles}
            className="mt-3 flex w-full items-center gap-2 rounded-xl border border-border/40 bg-background/18 px-3 py-2 text-left transition-colors hover:bg-foreground/[0.035] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <FileWarningIcon className="size-3.5 shrink-0 text-amber-600 dark:text-amber-300" />
            <span className="min-w-0 flex-1 truncate text-[10px] text-foreground/72">
              {assessment.hotspots[0]!.title}
              {assessment.hotspots.length > 1
                ? ` and ${assessment.hotspots.length - 1} more review hotspot${assessment.hotspots.length === 2 ? "" : "s"}`
                : ""}
            </span>
            <span className="text-[9px] text-muted-foreground">Open files</span>
            <ArrowRightIcon className="size-3 text-muted-foreground" />
          </button>
        ) : null}
      </div>
    </section>
  );
}
