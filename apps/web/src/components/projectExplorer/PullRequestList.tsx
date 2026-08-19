import type { ChangeRequest } from "@ryco/contracts";
import { DateTime, Option } from "effect";
import { memo } from "react";
import { GitBranchIcon, MessageSquareIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import { LabelChip } from "./LabelChip";
import { PrCheckStatusBadge } from "./PrCheckStatusBadge";
import { changeRequestStateKind, StateBadge } from "./StateBadge";
import { getPrCheckStatusFromChangeRequest } from "./prCheckStatus";
import { PullRequestStackPosition } from "./PullRequestStackPosition";

const dateFmt = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
});

function formatItemDate(updatedAt: ChangeRequest["updatedAt"]): string {
  if (!updatedAt || Option.isNone(updatedAt)) return "";
  return dateFmt.format(DateTime.toDate(updatedAt.value));
}

export const PullRequestList = memo(function PullRequestList(props: {
  items: ReadonlyArray<ChangeRequest>;
  isLoading: boolean;
  emptyText: string;
  selectedKey?: string | null | undefined;
  /**
   * `compact` is for pickers, where the row is a choice rather than a summary:
   * the state pill becomes an inline glyph so the title gets the full width,
   * and labels and comment counts drop out as noise. `default` keeps the
   * browsing layout used by the project explorer and worktree dialog.
   */
  density?: "default" | "compact";
  onSelect: (changeRequest: ChangeRequest) => void;
}) {
  const compact = props.density === "compact";
  if (props.isLoading && props.items.length === 0) {
    return (
      <div
        className={cn(
          "text-center text-muted-foreground text-sm",
          compact ? "px-3 py-6" : "px-4 py-8",
        )}
      >
        Loading…
      </div>
    );
  }
  if (props.items.length === 0) {
    return (
      <div
        className={cn(
          "text-center text-muted-foreground text-sm",
          compact ? "px-3 py-6" : "px-4 py-8",
        )}
      >
        {props.emptyText}
      </div>
    );
  }
  return (
    <ul
      role="listbox"
      className={cn(compact ? "divide-y divide-border/25" : "divide-y divide-border/40")}
    >
      {props.items.map((pr) => {
        const itemKey = `${pr.provider}:${pr.number}`;
        const isSelected = props.selectedKey === itemKey;
        const labels = pr.labels ?? [];
        const visibleLabels = labels.slice(0, 3);
        const moreLabelCount = labels.length - visibleLabels.length;
        const checkStatus = getPrCheckStatusFromChangeRequest(pr);
        const stateKind = changeRequestStateKind(pr.state, pr.isDraft);
        return (
          <li key={itemKey}>
            <button
              type="button"
              role="option"
              aria-selected={isSelected}
              onClick={() => props.onSelect(pr)}
              className={cn(
                "flex w-full text-left",
                "hover:bg-accent/40 focus-visible:bg-accent/60 focus-visible:outline-none",
                compact ? "items-center gap-2 px-2.5 py-1.5" : "items-start gap-3 px-4 py-3",
                isSelected && "bg-accent/55",
              )}
            >
              <StateBadge
                kind={stateKind}
                iconOnly={compact}
                className={compact ? "shrink-0" : "mt-0.5 shrink-0"}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
                    #{pr.number}
                  </span>
                  {pr.provider === "github" && pr.stackSummary ? (
                    <PullRequestStackPosition stack={pr.stackSummary} />
                  ) : null}
                  <span className="min-w-0 flex-1 truncate font-medium text-sm">{pr.title}</span>
                  <PrCheckStatusBadge view={checkStatus} mode="compact" />
                </div>
                {compact ? (
                  <div className="mt-0.5 flex items-center gap-1.5 text-muted-foreground text-[11px]">
                    <GitBranchIcon className="size-3 shrink-0" />
                    <span className="min-w-0 truncate font-mono">{pr.headRefName}</span>
                    {pr.author ? (
                      <span className="shrink-0 text-muted-foreground/60">· {pr.author}</span>
                    ) : null}
                    {pr.updatedAt && Option.isSome(pr.updatedAt) ? (
                      <span className="ml-auto shrink-0 text-muted-foreground/60">
                        {formatItemDate(pr.updatedAt)}
                      </span>
                    ) : null}
                  </div>
                ) : (
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-muted-foreground text-xs">
                    {pr.author ? <span>by {pr.author}</span> : null}
                    <span className="inline-flex items-center gap-1">
                      <GitBranchIcon className="size-3" />
                      <span className="truncate font-mono">
                        {pr.headRefName} → {pr.baseRefName}
                      </span>
                    </span>
                    {visibleLabels.map((label) => (
                      <LabelChip key={label.name} label={label} />
                    ))}
                    {moreLabelCount > 0 ? (
                      <span className="text-[10px]">+{moreLabelCount}</span>
                    ) : null}
                    {typeof pr.commentsCount === "number" && pr.commentsCount > 0 ? (
                      <span className="inline-flex items-center gap-0.5">
                        <MessageSquareIcon className="size-3" />
                        {pr.commentsCount}
                      </span>
                    ) : null}
                    {pr.updatedAt && Option.isSome(pr.updatedAt) ? (
                      <span className="ml-auto">{formatItemDate(pr.updatedAt)}</span>
                    ) : null}
                  </div>
                )}
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
});
