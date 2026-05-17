import { memo } from "react";
import { BugIcon, GitPullRequestIcon, type LucideIcon, SlashIcon, TicketIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
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
      className={cn("mx-auto mb-2 flex max-w-208 flex-wrap items-center gap-1.5", props.className)}
      data-testid="composer-hint-row"
    >
      {pills.map((pill) => {
        const Icon = PILL_ICON[pill.id];
        return (
          <Button
            key={pill.id}
            variant="outline"
            size="xs"
            aria-label={pill.ariaLabel}
            onClick={() => props.onInsertTrigger(pill.trigger)}
          >
            <Icon className="size-3.5 opacity-80" aria-hidden />
            <span>{pill.label}</span>
          </Button>
        );
      })}
    </div>
  );
});
