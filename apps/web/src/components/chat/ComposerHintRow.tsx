import { Fragment, memo } from "react";
import { BugIcon, GitPullRequestIcon, type LucideIcon, SlashIcon, TicketIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import {
  type HintRowPill,
  type HintRowTrigger,
  resolveHintRowPills,
} from "./ComposerHintRow.logic";

const PILL_ICON: Record<HintRowPill["id"], LucideIcon> = {
  "reference-issue": BugIcon,
  "reference-pr": GitPullRequestIcon,
  "reference-jira": TicketIcon,
  "browse-commands": SlashIcon,
};

export interface ComposerHintRowProps {
  readonly visible: boolean;
  readonly hasSourceControlRemote: boolean;
  readonly hasJiraProvider: boolean;
  readonly onInsertTrigger: (trigger: HintRowTrigger) => void;
  readonly className?: string;
}

export const ComposerHintRow = memo(function ComposerHintRow(props: ComposerHintRowProps) {
  if (!props.visible) {
    return null;
  }
  const pills = resolveHintRowPills({
    hasSourceControlRemote: props.hasSourceControlRemote,
    hasJiraProvider: props.hasJiraProvider,
  });
  if (pills.length === 0) {
    return null;
  }

  return (
    <div
      className={cn(
        "mx-auto mb-2 flex max-w-208 flex-wrap items-center justify-center gap-x-3 gap-y-1 text-muted-foreground text-sm",
        props.className,
      )}
      data-testid="composer-hint-row"
    >
      {pills.map((pill, index) => {
        const Icon = PILL_ICON[pill.id];
        return (
          <Fragment key={pill.id}>
            {index > 0 ? (
              <span aria-hidden className="select-none text-muted-foreground/40">
                •
              </span>
            ) : null}
            <button
              type="button"
              aria-label={pill.ariaLabel}
              onClick={() => props.onInsertTrigger(pill.trigger)}
              className="inline-flex cursor-pointer items-center gap-1 rounded-sm transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
            >
              <Icon className="size-4 opacity-70" aria-hidden />
              <span>{pill.label}</span>
            </button>
          </Fragment>
        );
      })}
    </div>
  );
});
