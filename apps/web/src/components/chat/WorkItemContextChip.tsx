import type { ComposerWorkItemContext } from "@ryco/contracts";
import { XIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import { workItemStateLabel } from "~/lib/workItemState";
import {
  COMPOSER_INLINE_CHIP_CLASS_NAME,
  COMPOSER_INLINE_CHIP_DISMISS_BUTTON_CLASS_NAME,
  COMPOSER_INLINE_CHIP_ICON_CLASS_NAME,
  COMPOSER_INLINE_CHIP_LABEL_CLASS_NAME,
} from "../composerInlineChip";
import { AtlassianJiraIcon } from "../Icons";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

interface WorkItemContextChipProps {
  context: ComposerWorkItemContext;
  onRemove: (id: string) => void;
}

export function WorkItemContextChip(props: WorkItemContextChipProps) {
  const { context, onRemove } = props;

  const title = context.detail.title;
  const isTruncated = context.detail.truncated;
  const stateLabel = workItemStateLabel(context.detail);
  const isDone = context.detail.state === "done" || context.detail.state === "closed";
  const tooltipBody = context.detail.description.trim().length > 0
    ? context.detail.description
    : null;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className={COMPOSER_INLINE_CHIP_CLASS_NAME} data-context-id={context.id}>
            <AtlassianJiraIcon
              className={cn(COMPOSER_INLINE_CHIP_ICON_CLASS_NAME, "size-3.5")}
              aria-hidden="true"
            />
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
              {context.key}
            </span>
            <span className={cn(COMPOSER_INLINE_CHIP_LABEL_CLASS_NAME, "max-w-32")}>{title}</span>
            <span
              className={cn(
                "ml-0.5 shrink-0 rounded-sm px-1 text-[9px] font-semibold uppercase leading-tight",
                isDone ? "bg-muted text-muted-foreground" : "bg-info/15 text-info-foreground",
              )}
            >
              {stateLabel}
            </span>
            {isTruncated ? (
              <span
                aria-label="Context truncated"
                className="ml-0.5 shrink-0 rounded-sm bg-warning/20 px-0.5 text-[9px] font-semibold uppercase leading-tight text-warning-foreground"
              >
                truncated
              </span>
            ) : null}
            <button
              type="button"
              aria-label="Remove context"
              className={COMPOSER_INLINE_CHIP_DISMISS_BUTTON_CLASS_NAME}
              onClick={() => onRemove(context.id)}
            >
              <XIcon className="size-3" aria-hidden="true" />
            </button>
          </span>
        }
      />
      {tooltipBody ? (
        <TooltipPopup side="top" className="max-w-80 whitespace-pre-wrap leading-tight">
          {tooltipBody}
        </TooltipPopup>
      ) : null}
    </Tooltip>
  );
}
