import type { ThreadGoal, ThreadGoalStatus } from "@ryco/contracts";
import {
  CheckCircle2Icon,
  ChevronDownIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  TargetIcon,
  Trash2Icon,
} from "lucide-react";
import { memo, useEffect, useState } from "react";

import { cn } from "~/lib/utils";

const STATUS_LABEL: Record<ThreadGoalStatus, string> = {
  active: "Pursuing goal",
  paused: "Goal paused",
  blocked: "Goal blocked",
  usageLimited: "Usage limit reached",
  budgetLimited: "Goal budget reached",
  complete: "Goal achieved",
};

function elapsedSeconds(goal: ThreadGoal, now: number): number {
  const liveSeconds =
    goal.status === "active"
      ? Math.max(0, Math.floor((now - Date.parse(goal.updatedAt)) / 1_000))
      : 0;
  return goal.timeUsedSeconds + liveSeconds;
}

function formatElapsed(seconds: number): string {
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

const numberFormatter = new Intl.NumberFormat(undefined, { notation: "compact" });

function GoalAction(props: {
  readonly label: string;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
  readonly destructive?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.label}
      onClick={props.onClick}
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-background/75 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        props.destructive && "hover:text-destructive",
      )}
    >
      {props.children}
    </button>
  );
}

export const ComposerGoalHeader = memo(function ComposerGoalHeader(props: {
  readonly goal: ThreadGoal;
  readonly onEdit: () => void;
  readonly onStatusChange: (status: ThreadGoalStatus) => void;
  readonly onClear: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (props.goal.status !== "active") return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [props.goal.status, props.goal.updatedAt]);

  const canResume =
    props.goal.status === "paused" ||
    props.goal.status === "blocked" ||
    props.goal.status === "usageLimited";
  const complete = props.goal.status === "complete";

  return (
    <div className="rounded-t-[max(0px,calc(var(--radius-3xl)-3px))] border-b border-border/65 bg-muted/25 px-3.5 py-2.5">
      <div className="flex min-w-0 items-start gap-2.5">
        <div
          className={cn(
            "mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-border/60 bg-background/55 text-muted-foreground",
            props.goal.status === "active" && "border-primary/30 text-primary",
            complete && "border-emerald-500/30 text-emerald-600 dark:text-emerald-400",
          )}
        >
          {complete ? (
            <CheckCircle2Icon className="size-3.5" />
          ) : (
            <TargetIcon className="size-3.5" />
          )}
        </div>

        <button
          type="button"
          className="min-w-0 flex-1 text-left focus-visible:outline-none"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
        >
          <span className="flex items-center gap-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            {STATUS_LABEL[props.goal.status]}
            <span className="font-mono font-normal tracking-normal normal-case">
              {formatElapsed(elapsedSeconds(props.goal, now))}
            </span>
            {props.goal.tokenBudget !== null ? (
              <span className="font-normal tracking-normal normal-case">
                {numberFormatter.format(props.goal.tokensUsed)} /{" "}
                {numberFormatter.format(props.goal.tokenBudget)} tokens
              </span>
            ) : null}
          </span>
          <span
            className={cn(
              "mt-0.5 block text-sm leading-5 text-foreground/90",
              !expanded && "line-clamp-2",
            )}
          >
            {props.goal.objective}
          </span>
        </button>

        <div className="flex shrink-0 items-center gap-0.5">
          <GoalAction label="Edit goal" onClick={props.onEdit}>
            <PencilIcon className="size-3.5" />
          </GoalAction>
          {props.goal.status === "active" ? (
            <GoalAction label="Pause goal" onClick={() => props.onStatusChange("paused")}>
              <PauseIcon className="size-3.5" />
            </GoalAction>
          ) : canResume ? (
            <GoalAction label="Resume goal" onClick={() => props.onStatusChange("active")}>
              <PlayIcon className="size-3.5" />
            </GoalAction>
          ) : null}
          <GoalAction label="Clear goal" destructive onClick={props.onClear}>
            <Trash2Icon className="size-3.5" />
          </GoalAction>
          <ChevronDownIcon
            aria-hidden
            className={cn(
              "mt-1 size-3.5 text-muted-foreground/60 transition-transform",
              expanded && "rotate-180",
            )}
          />
        </div>
      </div>
    </div>
  );
});
