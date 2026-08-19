import type { SourceControlChangeRequestStack } from "@ryco/contracts";
import { useState } from "react";

import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { PullRequestStackPosition } from "./PullRequestStackPosition";
import { changeRequestStateKind, StateBadge } from "./StateBadge";
import { assessPullRequestStack, pullRequestStackEntriesTopDown } from "./pullRequestStack.logic";

const ASSESSMENT_COLOR_CLASS = {
  ready: "text-emerald-600 dark:text-emerald-400",
  blocked: "text-destructive",
  pending: "text-muted-foreground",
  warning: "text-amber-600 dark:text-amber-400",
  complete: "text-violet-600 dark:text-violet-400",
} as const;

export function PullRequestStackPopover(props: {
  stack: SourceControlChangeRequestStack;
  currentNumber: number;
  onSelectPullRequest?: ((number: number) => void) | undefined;
}) {
  const [open, setOpen] = useState(false);
  const assessment = assessPullRequestStack(props.stack);
  const entriesTopDown = pullRequestStackEntriesTopDown(props.stack);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2"
            aria-label={`View stack #${props.stack.number}, pull request ${props.stack.position} of ${props.stack.size}`}
          >
            <PullRequestStackPosition stack={props.stack} appearance="plain" />
          </Button>
        }
      />
      <PopoverPopup
        align="end"
        side="bottom"
        sideOffset={6}
        className="w-[min(26rem,calc(100vw-1rem))] p-0"
        viewportClassName="p-0"
      >
        <div className="border-border border-b px-4 py-3">
          <div className={cn("text-sm font-medium", ASSESSMENT_COLOR_CLASS[assessment.tone])}>
            {assessment.label}
          </div>
          <div className="mt-0.5 text-muted-foreground text-xs">
            Stack #{props.stack.number} · targets {props.stack.baseRefName}
          </div>
        </div>

        <div className="max-h-[min(28rem,70vh)] overflow-y-auto py-1.5">
          {entriesTopDown.map((entry, index) => {
            const current = entry.number === props.currentNumber;
            return (
              <div key={entry.number} className="relative px-2">
                {index < entriesTopDown.length - 1 ? (
                  <span
                    aria-hidden="true"
                    className="absolute left-[1.6875rem] top-8 h-[calc(100%-1rem)] w-px bg-border"
                  />
                ) : null}
                <button
                  type="button"
                  aria-current={current ? "page" : undefined}
                  className={cn(
                    "group relative flex w-full items-start gap-3 rounded-md px-2 py-2 text-left outline-none focus-visible:ring-1 focus-visible:ring-ring/60",
                    current ? "bg-accent/55" : "hover:bg-accent/40",
                  )}
                  onClick={() => {
                    setOpen(false);
                    if (!current) props.onSelectPullRequest?.(entry.number);
                  }}
                >
                  <StateBadge
                    kind={changeRequestStateKind(entry.state, entry.isDraft)}
                    iconOnly
                    className="mt-0.5 shrink-0 bg-background"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-foreground text-sm">{entry.title}</span>
                    <span className="mt-0.5 block truncate text-muted-foreground text-xs">
                      #{entry.number} · {entry.headRefName} · {entry.mergeability}
                    </span>
                  </span>
                </button>
              </div>
            );
          })}

          <div className="relative mx-2 flex items-center gap-3 px-2 py-2 text-muted-foreground text-xs">
            <span aria-hidden="true" className="absolute -top-2 left-4 h-6 w-px bg-border" />
            <span
              aria-hidden="true"
              className="flex size-4 shrink-0 items-center justify-center rounded-full border border-border bg-background"
            />
            <span className="truncate">{props.stack.baseRefName}</span>
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
}
