import type { SourceControlIssueSummary } from "@ryco/contracts";
import { DateTime, Option } from "effect";
import { memo } from "react";
import { MessageSquareIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import { LabelChip } from "./LabelChip";
import { StateBadge } from "./StateBadge";

const dateFmt = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
});

function formatItemDate(updatedAt: SourceControlIssueSummary["updatedAt"]): string {
  if (!updatedAt || Option.isNone(updatedAt)) return "";
  return dateFmt.format(DateTime.toDate(updatedAt.value));
}

export const IssueList = memo(function IssueList(props: {
  items: ReadonlyArray<SourceControlIssueSummary>;
  isLoading: boolean;
  emptyText: string;
  selectedKey?: string | null | undefined;
  /**
   * `compact` collapses each issue to a single line for pickers. An issue
   * carries far less metadata than a pull request, so the second row was
   * mostly empty — author and date fit beside the title instead.
   */
  density?: "default" | "compact";
  onSelect: (issue: SourceControlIssueSummary) => void;
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
  if (compact) {
    return (
      <ul role="listbox" className="divide-y divide-border/25">
        {props.items.map((issue) => {
          const itemKey = `${issue.provider}:${issue.number}`;
          const isSelected = props.selectedKey === itemKey;
          return (
            <li key={itemKey}>
              <button
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => props.onSelect(issue)}
                className={cn(
                  "flex w-full items-center gap-2 px-2.5 py-1.5 text-left",
                  "hover:bg-accent/40 focus-visible:bg-accent/60 focus-visible:outline-none",
                  isSelected && "bg-accent/55",
                )}
              >
                <StateBadge
                  kind={issue.state === "open" ? "issue-open" : "issue-closed"}
                  iconOnly
                  className="shrink-0"
                />
                <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
                  #{issue.number}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm">{issue.title}</span>
                {issue.author ? (
                  <span className="shrink-0 text-[11px] text-muted-foreground/60">
                    {issue.author}
                  </span>
                ) : null}
                {issue.updatedAt && Option.isSome(issue.updatedAt) ? (
                  <span className="shrink-0 text-[11px] text-muted-foreground/60">
                    {formatItemDate(issue.updatedAt)}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    );
  }
  return (
    <ul role="listbox" className="divide-y divide-border/40">
      {props.items.map((issue) => {
        const itemKey = `${issue.provider}:${issue.number}`;
        const isSelected = props.selectedKey === itemKey;
        const labels = issue.labels ?? [];
        const visibleLabels = labels.slice(0, 3);
        const moreLabelCount = labels.length - visibleLabels.length;
        return (
          <li key={itemKey}>
            <button
              type="button"
              role="option"
              aria-selected={isSelected}
              onClick={() => props.onSelect(issue)}
              className={cn(
                "flex w-full items-start gap-3 px-4 py-3 text-left",
                "hover:bg-accent/40 focus-visible:bg-accent/60 focus-visible:outline-none",
                isSelected && "bg-accent/55",
              )}
            >
              <StateBadge
                kind={issue.state === "open" ? "issue-open" : "issue-closed"}
                className="mt-0.5 shrink-0"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-muted-foreground text-xs">#{issue.number}</span>
                  <span className="min-w-0 flex-1 truncate font-medium text-sm">{issue.title}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-muted-foreground text-xs">
                  {issue.author ? <span>by {issue.author}</span> : null}
                  {visibleLabels.map((label) => (
                    <LabelChip key={label.name} label={label} />
                  ))}
                  {moreLabelCount > 0 ? (
                    <span className="text-[10px]">+{moreLabelCount}</span>
                  ) : null}
                  {typeof issue.commentsCount === "number" && issue.commentsCount > 0 ? (
                    <span className="inline-flex items-center gap-0.5">
                      <MessageSquareIcon className="size-3" />
                      {issue.commentsCount}
                    </span>
                  ) : null}
                  {issue.updatedAt && Option.isSome(issue.updatedAt) ? (
                    <span className="ml-auto">{formatItemDate(issue.updatedAt)}</span>
                  ) : null}
                </div>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
});
