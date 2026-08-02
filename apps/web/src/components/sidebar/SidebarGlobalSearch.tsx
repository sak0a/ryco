import { SearchIcon } from "lucide-react";
import { memo } from "react";

import { CommandDialogTrigger } from "../ui/command";
import { Kbd } from "../ui/kbd";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";

interface SidebarGlobalSearchProps {
  readonly shortcutLabel: string | null;
}

export const SidebarGlobalSearch = memo(function SidebarGlobalSearch({
  shortcutLabel,
}: SidebarGlobalSearchProps) {
  return (
    <div className="shrink-0 px-3 pb-1.5 pt-1">
      <SidebarMenu>
        <SidebarMenuItem>
          <CommandDialogTrigger
            render={
              <SidebarMenuButton
                size="sm"
                aria-label="Search Ryco"
                className="gap-2 px-2 py-1.5 text-muted-foreground/70 hover:bg-accent hover:text-foreground focus-visible:ring-0"
                data-testid="command-palette-trigger"
              />
            }
          >
            <SearchIcon aria-hidden className="size-3.5" />
            <span className="flex-1 truncate text-left text-xs">Search</span>
            {shortcutLabel ? (
              <Kbd className="h-4 min-w-0 rounded-sm px-1.5 text-[10px] pointer-coarse:hidden">
                {shortcutLabel}
              </Kbd>
            ) : null}
          </CommandDialogTrigger>
        </SidebarMenuItem>
      </SidebarMenu>
    </div>
  );
});
