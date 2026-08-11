import { WS_METHODS } from "@ryco/contracts";
import { ActivityIcon, BarChart3Icon, ShieldAlertIcon } from "lucide-react";

import { useHostedRpcCapability } from "~/hostedHub/capabilities";
import { cn } from "~/lib/utils";

import { SidebarInset } from "../ui/sidebar";
import { ScrollArea } from "../ui/scroll-area";
import { StatePanel } from "../settings/statistics/parts";
import { ActivityView } from "./activity/ActivityView";
import type { StatisticsSearch } from "./statisticsSearch";
import { UsageView } from "./usage/UsageView";

export function StatisticsPage({
  search,
  onSearchChange,
}: {
  readonly search: StatisticsSearch;
  readonly onSearchChange: (next: StatisticsSearch) => void;
}) {
  const method =
    search.view === "usage" ? WS_METHODS.serverGetUsageSummary : WS_METHODS.serverGetStatistics;
  const capability = useHostedRpcCapability(method);
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex min-h-14 shrink-0 items-center border-b border-border/75 bg-background/90 px-5 backdrop-blur-sm sm:px-7">
          <div className="flex min-w-0 flex-1 items-center gap-5">
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold tracking-tight">Statistics</h1>
              <p className="text-[11px] text-muted-foreground">Usage and work signals</p>
            </div>
            <div className="inline-flex rounded-lg bg-muted/75 p-0.5">
              {(["usage", "activity"] as const).map((view) => {
                const Icon = view === "usage" ? BarChart3Icon : ActivityIcon;
                return (
                  <button
                    key={view}
                    type="button"
                    onClick={() => onSearchChange({ ...search, view })}
                    className={cn(
                      "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium capitalize transition-colors",
                      search.view === view
                        ? "bg-background text-foreground shadow-xs"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Icon className="size-3.5" /> {view}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="hidden text-right sm:block">
            <p className="text-xs font-medium">
              {search.range === "all"
                ? "All available history"
                : `Last ${search.range.slice(0, -1)} days`}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {search.view === "usage" ? "Local calendar window" : "UTC activity window"}
            </p>
          </div>
        </header>

        <ScrollArea className="min-h-0 flex-1">
          <div className="mx-auto w-full max-w-[1480px] px-5 py-7 sm:px-8 sm:py-9 lg:px-10">
            {!capability.allowed ? (
              <StatePanel
                icon={ShieldAlertIcon}
                title="Statistics aren’t available for this session"
                description={capability.reason ?? "Owner access is required."}
              />
            ) : search.view === "usage" ? (
              <UsageView search={search} onSearchChange={onSearchChange} />
            ) : (
              <ActivityView search={search} onSearchChange={onSearchChange} />
            )}
          </div>
        </ScrollArea>
      </div>
    </SidebarInset>
  );
}
