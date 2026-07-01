import { EyeIcon, RotateCwIcon, TriangleAlertIcon } from "lucide-react";
import { memo } from "react";

import { useAppearancePreference } from "~/hooks/useAppearancePreference";
import { cn } from "~/lib/utils";

import type { PanelLayout } from "../themes/appearancePreferences";
import { OverviewLayoutContent } from "./overview/overviewLayouts";
import { isOverviewEmpty, OverviewBadge, OverviewEmptyState } from "./overview/overviewSections";
import type { OverviewLayoutProps, OverviewPanelMode } from "./overview/overviewTypes";
import { Button } from "./ui/button";
import { ScrollArea } from "./ui/scroll-area";

export type {
  OverviewChangedFile,
  OverviewChanges,
  OverviewFileStatus,
  OverviewPanelItem,
  OverviewPullRequestCheckRun,
  OverviewPullRequestState,
} from "./overview/overviewTypes";

export interface PlanSidebarProps extends OverviewLayoutProps {
  mode?: OverviewPanelMode;
}

function HeaderTrailing({
  layout,
  layoutProps,
}: {
  layout: PanelLayout;
  layoutProps: OverviewLayoutProps;
}) {
  const showConflict = layout === "board" && Boolean(layoutProps.pullRequest?.hasMergeConflicts);
  const showRefresh = Boolean(layoutProps.onRefreshPullRequest);
  if (!showConflict && !showRefresh) return null;

  // A lingering source-control fetch error is surfaced loudly once (via toast);
  // afterwards this quiet dot on the refresh control is the only persistent cue
  // that the panel data may be stale and a retry is worthwhile.
  const hasSourceControlError = Boolean(layoutProps.pullRequest?.checksError);

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {showConflict ? (
        <OverviewBadge tone="error">
          <TriangleAlertIcon /> conflict
        </OverviewBadge>
      ) : null}
      {showRefresh ? (
        <div className="relative shrink-0">
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            className="text-muted-foreground hover:text-foreground"
            onClick={layoutProps.onRefreshPullRequest}
            disabled={layoutProps.isRefreshingPullRequest}
            aria-label={
              hasSourceControlError
                ? "Retry loading source control (last refresh failed)"
                : "Refresh source control"
            }
          >
            <RotateCwIcon
              className={cn("size-3.5", layoutProps.isRefreshingPullRequest && "animate-spin")}
            />
          </Button>
          {hasSourceControlError && !layoutProps.isRefreshingPullRequest ? (
            <span
              aria-hidden
              className="pointer-events-none absolute -top-0.5 -right-0.5 size-2 rounded-full bg-warning ring-2 ring-card"
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const PlanSidebar = memo(function PlanSidebar({
  mode = "sidebar",
  ...layoutProps
}: PlanSidebarProps) {
  const layout = useAppearancePreference("panelLayout") as PanelLayout;
  const empty = isOverviewEmpty(layoutProps);

  const body = empty ? (
    <OverviewEmptyState />
  ) : (
    <OverviewLayoutContent layout={layout} {...layoutProps} />
  );

  const pullRequestUrl = layoutProps.pullRequest?.url;
  const showViewPullRequest = layout === "stack" && Boolean(pullRequestUrl);

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col backdrop-blur",
        mode === "sidebar" &&
          "my-3 mr-3 w-[340px] shrink-0 self-start overflow-hidden rounded-lg border border-border/70 bg-card/90 shadow-xl supports-[backdrop-filter]:bg-card/75",
        mode === "sheet" && "h-full w-full bg-card/90 supports-[backdrop-filter]:bg-card/75",
        mode === "floating" &&
          "pointer-events-auto max-h-[min(72vh,42rem)] w-[min(360px,calc(100vw_-_1.5rem))] rounded-lg border border-border/60 bg-card/95 shadow-xl dark:bg-card/90",
      )}
      style={mode === "sidebar" ? { maxHeight: "calc(100% - 1.5rem)" } : undefined}
    >
      {!empty && layoutProps.branchControl ? (
        <div className="flex min-w-0 shrink-0 items-center justify-between gap-2 border-b border-border/60 px-3 py-2.5">
          <div className="flex min-w-0 items-center">{layoutProps.branchControl}</div>
          <HeaderTrailing layout={layout} layoutProps={layoutProps} />
        </div>
      ) : null}

      {mode === "sidebar" ? (
        <div
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]"
          data-slot="scroll-area-viewport"
        >
          {body}
        </div>
      ) : (
        <ScrollArea className="min-h-0 flex-1" scrollbarGutter>
          {body}
        </ScrollArea>
      )}

      {!empty && layoutProps.sourceControlActions ? (
        <div className="flex shrink-0 items-center gap-2 border-t border-border/60 bg-card/50 px-3 py-2.5">
          <div className="flex min-w-0 flex-1">{layoutProps.sourceControlActions}</div>
          {showViewPullRequest ? (
            <Button
              variant="outline"
              size="icon"
              className="size-8 shrink-0"
              render={
                <a
                  href={pullRequestUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="View pull request"
                />
              }
            >
              <EyeIcon className="size-3.5" />
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});

export default PlanSidebar;
