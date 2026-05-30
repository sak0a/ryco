import type { ChangeRequest } from "@ryco/contracts";
import { DateTime, Option } from "effect";
import { memo } from "react";
import { GitBranchIcon, MessageSquareIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import { LabelChip } from "./LabelChip";
import { changeRequestStateKind, StateBadge } from "./StateBadge";

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
  onSelect: (changeRequest: ChangeRequest) => void;
}) {
  if (props.isLoading && props.items.length === 0) {
    return <div className="px-4 py-8 text-center text-muted-foreground text-sm">Loading…</div>;
  }
  if (props.items.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-muted-foreground text-sm">{props.emptyText}</div>
    );
  }
  return (
    <ul role="listbox" className="divide-y divide-border/40">
      {props.items.map((pr) => {
        const itemKey = `${pr.provider}:${pr.number}`;
        const isSelected = props.selectedKey === itemKey;
        const labels = pr.labels ?? [];
        const visibleLabels = labels.slice(0, 3);
        const moreLabelCount = labels.length - visibleLabels.length;
        return (
          <li key={itemKey}>
            <button
              type="button"
              role="option"
              aria-selected={isSelected}
              onClick={() => props.onSelect(pr)}
              className={cn(
                "flex w-full items-start gap-3 px-4 py-3 text-left",
                "hover:bg-accent/40 focus-visible:bg-accent/60 focus-visible:outline-none",
                isSelected && "bg-accent/55",
              )}
            >
              <StateBadge
                kind={changeRequestStateKind(pr.state, pr.isDraft)}
                className="mt-0.5 shrink-0"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-muted-foreground text-xs">#{pr.number}</span>
                  <span className="min-w-0 flex-1 truncate font-medium text-sm">{pr.title}</span>
                </div>
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
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
});
