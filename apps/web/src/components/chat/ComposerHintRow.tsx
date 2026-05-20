import { memo } from "react";

import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { type HintRowTrigger, resolveHintRowPills } from "./ComposerHintRow.logic";

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
        "mx-auto mb-2 flex max-w-208 flex-wrap items-center justify-center gap-2",
        props.className,
      )}
      data-testid="composer-hint-row"
    >
      {pills.map((pill) => (
        <Button
          key={pill.id}
          variant="outline"
          size="sm"
          aria-label={pill.ariaLabel}
          onClick={() => props.onInsertTrigger(pill.trigger)}
        >
          {pill.label}
        </Button>
      ))}
    </div>
  );
});
