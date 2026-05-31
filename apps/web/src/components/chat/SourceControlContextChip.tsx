import type { ComposerSourceControlContext } from "@ryco/contracts";
import { CircleDotIcon, GitBranchIcon, XIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import {
  COMPOSER_INLINE_CHIP_CLASS_NAME,
  COMPOSER_INLINE_CHIP_DISMISS_BUTTON_CLASS_NAME,
  COMPOSER_INLINE_CHIP_ICON_CLASS_NAME,
  COMPOSER_INLINE_CHIP_LABEL_CLASS_NAME,
} from "../composerInlineChip";
import { PrCheckStatusBadge } from "../projectExplorer/PrCheckStatusBadge";
import { getPrCheckStatusFromChangeRequest } from "../projectExplorer/prCheckStatus";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

interface SourceControlContextChipProps {
  context: ComposerSourceControlContext;
  onRemove: (id: string) => void;
}

/**
 * Returns the display reference string.
 * - If the reference contains a slash before the '#', it's cross-repo: display as-is (`owner/repo#9`).
 * - Otherwise, if it already starts with '#', display as-is (`#42`).
 * - Otherwise, extract just the `#<number>` portion.
 */
function getDisplayReference(reference: string): string {
  const hashIndex = reference.indexOf("#");
  if (hashIndex < 0) return reference;

  const beforeHash = reference.slice(0, hashIndex);

  // Cross-repo: owner/repo#N — before the '#' contains a '/'
  if (beforeHash.includes("/")) {
    return reference;
  }

  // Same-repo: '#N' or 'owner/repo#N' with no owner part
  return reference.slice(hashIndex);
}

export function SourceControlContextChip(props: SourceControlContextChipProps) {
  const { context, onRemove } = props;

  const displayRef = getDisplayReference(context.reference);
  const title = context.detail.title;
  const isTruncated = context.detail.truncated;
  const checkStatus =
    context.kind === "change-request" && "baseRefName" in context.detail
      ? getPrCheckStatusFromChangeRequest(context.detail)
      : null;

  const Icon = context.kind === "change-request" ? GitBranchIcon : CircleDotIcon;

  const tooltipBody =
    "body" in context.detail && typeof context.detail.body === "string"
      ? context.detail.body
      : null;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className={COMPOSER_INLINE_CHIP_CLASS_NAME} data-context-id={context.id}>
            <Icon
              className={cn(COMPOSER_INLINE_CHIP_ICON_CLASS_NAME, "size-3.5")}
              aria-hidden="true"
            />
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
              {displayRef}
            </span>
            <span className={cn(COMPOSER_INLINE_CHIP_LABEL_CLASS_NAME, "max-w-32")}>{title}</span>
            {isTruncated ? (
              <span
                aria-label="Context truncated"
                className="ml-0.5 shrink-0 rounded-sm bg-warning/20 px-0.5 text-[9px] font-semibold uppercase leading-tight text-warning-foreground"
              >
                truncated
              </span>
            ) : null}
            {checkStatus ? <PrCheckStatusBadge view={checkStatus} mode="compact" /> : null}
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
