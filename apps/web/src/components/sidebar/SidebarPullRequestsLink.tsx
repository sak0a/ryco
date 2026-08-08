import {
  selectUnreadPullRequestCount,
  usePullRequestStore,
} from "@ryco/client-runtime/state/pullRequests";
import { Link, useLocation } from "@tanstack/react-router";
import { GitPullRequestIcon } from "lucide-react";
import { memo } from "react";

import { cn } from "~/lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export const SidebarPullRequestsLink = memo(function SidebarPullRequestsLink() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const unreadCount = usePullRequestStore(selectUnreadPullRequestCount);
  const active = pathname === "/pull-requests";

  return (
    <div className="px-2 pb-1">
      <Tooltip>
        <TooltipTrigger
          render={
            <Link
              to="/pull-requests"
              search={{ view: "latest", q: "", tab: "conversation", focus: false, listWidth: 410 }}
              data-active={active || undefined}
              data-testid="sidebar-pull-requests-link"
              className={cn(
                "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs font-medium outline-hidden ring-ring transition-[background-color,color,transform] focus-visible:ring-2 active:translate-y-px",
                active
                  ? "bg-foreground/[0.075] text-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.08)]"
                  : "text-foreground/90 hover:bg-accent",
              )}
            >
              <GitPullRequestIcon className="size-3.5 shrink-0 text-muted-foreground/70" />
              <span className="min-w-0 flex-1 truncate">Pull Requests</span>
              {unreadCount > 0 ? (
                <span className="min-w-4 rounded-full bg-foreground/9 px-1 text-center font-mono text-[9px] leading-4 text-foreground/65 tabular-nums">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              ) : null}
            </Link>
          }
        />
        <TooltipPopup side="bottom">Open the pull request inbox</TooltipPopup>
      </Tooltip>
    </div>
  );
});
