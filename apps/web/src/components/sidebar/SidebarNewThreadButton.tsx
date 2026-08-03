import { SquarePenIcon } from "lucide-react";
import { memo } from "react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export interface SidebarNewThreadButtonProps {
  readonly shortcutLabel: string | null;
  readonly disabled: boolean;
  readonly onClick: () => void;
}

/**
 * Sidebar-level entry point to the new-thread surface, above the project list.
 *
 * The per-project pencil and ⌘K both assume you already know where you are
 * going; this one starts in the project you last worked in and lets the page's
 * own "Work in …" row retarget from there.
 */
export const SidebarNewThreadButton = memo(function SidebarNewThreadButton({
  shortcutLabel,
  disabled,
  onClick,
}: SidebarNewThreadButtonProps) {
  return (
    <div className="px-2 pb-1">
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              disabled={disabled}
              onClick={onClick}
              data-testid="sidebar-new-thread-button"
              className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-foreground/90 text-xs font-medium outline-hidden ring-ring transition-colors hover:bg-accent focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50"
            >
              <SquarePenIcon className="size-3.5 shrink-0 text-muted-foreground/70" />
              <span className="min-w-0 flex-1 truncate">New thread</span>
              {shortcutLabel ? (
                <span className="shrink-0 text-[10px] text-muted-foreground/50">
                  {shortcutLabel}
                </span>
              ) : null}
            </button>
          }
        />
        <TooltipPopup side="bottom">
          {disabled ? "Add a project first" : "Start a new thread"}
        </TooltipPopup>
      </Tooltip>
    </div>
  );
});
