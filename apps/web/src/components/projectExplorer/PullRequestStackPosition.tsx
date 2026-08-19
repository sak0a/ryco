import type { SourceControlChangeRequestStackSummary } from "@ryco/contracts";
import { GitForkIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function PullRequestStackPosition(props: {
  stack: SourceControlChangeRequestStackSummary;
  appearance?: "badge" | "plain";
  className?: string | undefined;
}) {
  const appearance = props.appearance ?? "badge";
  const label = `Stack #${props.stack.number}, pull request ${props.stack.position} of ${props.stack.size}`;
  const chip = (
    <span
      aria-label={label}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 font-medium tabular-nums",
        appearance === "badge"
          ? "rounded-md border border-border/60 bg-muted/45 px-1.5 py-0.5 text-[10px] text-muted-foreground"
          : "text-xs text-muted-foreground",
        props.className,
      )}
    >
      <GitForkIcon className="size-3" aria-hidden="true" />
      <span>
        {props.stack.position}/{props.stack.size}
      </span>
    </span>
  );
  return (
    <Tooltip>
      <TooltipTrigger render={chip} />
      <TooltipPopup>
        Stack #{props.stack.number} · targets {props.stack.baseRefName}
      </TooltipPopup>
    </Tooltip>
  );
}
