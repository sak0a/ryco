import type { SidebarViewMode } from "@ryco/contracts/settings";
import { FolderTreeIcon, InboxIcon } from "lucide-react";
import { memo, useCallback, useRef } from "react";

import { cn } from "../../lib/utils";

interface SidebarViewToggleProps {
  readonly value: SidebarViewMode;
  readonly onChange: (value: SidebarViewMode) => void;
}

const OPTIONS = [
  { value: "workspace", label: "Workspace", icon: FolderTreeIcon },
  { value: "inbox", label: "Inbox", icon: InboxIcon },
] as const;

export const SidebarViewToggle = memo(function SidebarViewToggle({
  value,
  onChange,
}: SidebarViewToggleProps) {
  const refs = useRef<Record<SidebarViewMode, HTMLButtonElement | null>>({
    workspace: null,
    inbox: null,
  });
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const next = value === "workspace" ? "inbox" : "workspace";
      onChange(next);
      requestAnimationFrame(() => refs.current[next]?.focus());
    },
    [onChange, value],
  );

  return (
    <div className="px-3 pb-1.5" data-testid="sidebar-view-toggle">
      <div
        aria-label="Sidebar view"
        className="grid grid-cols-2 gap-0.5 rounded-lg bg-sidebar-accent/45 p-0.5"
        role="tablist"
      >
        {OPTIONS.map((option) => {
          const Icon = option.icon;
          const selected = value === option.value;
          return (
            <button
              key={option.value}
              ref={(element) => {
                refs.current[option.value] = element;
              }}
              aria-controls={`sidebar-${option.value}-panel`}
              aria-selected={selected}
              className={cn(
                "inline-flex h-7 cursor-pointer items-center justify-center gap-1.5 rounded-md px-2 text-[11px] font-medium outline-hidden ring-ring transition-colors focus-visible:ring-2",
                selected
                  ? "bg-sidebar text-sidebar-foreground shadow-xs"
                  : "text-muted-foreground hover:text-sidebar-foreground",
              )}
              id={`sidebar-${option.value}-tab`}
              onClick={() => onChange(option.value)}
              onKeyDown={handleKeyDown}
              role="tab"
              tabIndex={selected ? 0 : -1}
              type="button"
            >
              <Icon aria-hidden className="size-3" />
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
});
