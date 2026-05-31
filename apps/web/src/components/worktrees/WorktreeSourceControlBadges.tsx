import type { MouseEvent } from "react";
import { cn } from "~/lib/utils";
import {
  resolveStateBadgeVariant,
  type StateBadgeVariant,
} from "../sourceControl/stateBadgeVariants";
import type { LinkedWorktreeItem } from "./LinkedWorktreeItemDialog";

export interface WorktreeSourceControlBadgesProps {
  issueNumber?: number | null | undefined;
  prNumber?: number | null | undefined;
  issueState?: "open" | "closed" | null | undefined;
  prState?: "open" | "closed" | "merged" | null | undefined;
  prIsDraft?: boolean | null | undefined;
  onOpenLinkedItem?: ((item: LinkedWorktreeItem) => void) | undefined;
  className?: string | undefined;
  density?: "compact" | "header" | undefined;
  labelStyle?: "number" | "kind" | undefined;
}

export function WorktreeSourceControlBadges(props: WorktreeSourceControlBadgesProps) {
  const issueNumber = props.issueNumber ?? null;
  const prNumber = props.prNumber ?? null;

  if (issueNumber === null && prNumber === null) {
    return null;
  }

  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1", props.className)}>
      {issueNumber !== null ? (
        <WorktreeSourceControlBadge
          variant={resolveStateBadgeVariant({
            kind: "issue",
            state: props.issueState ?? null,
          })}
          number={issueNumber}
          kind="issue"
          kindLabel="Issue"
          displayLabel={props.labelStyle === "kind" ? `Issue #${issueNumber}` : `#${issueNumber}`}
          density={props.density ?? "compact"}
          onClick={
            props.onOpenLinkedItem
              ? () => props.onOpenLinkedItem?.({ kind: "issue", number: issueNumber })
              : undefined
          }
        />
      ) : null}
      {prNumber !== null ? (
        <WorktreeSourceControlBadge
          variant={resolveStateBadgeVariant({
            kind: "pr",
            state: props.prState ?? null,
            isDraft: props.prIsDraft ?? null,
          })}
          number={prNumber}
          kind="pr"
          kindLabel="Pull request"
          displayLabel={props.labelStyle === "kind" ? `PR #${prNumber}` : `#${prNumber}`}
          density={props.density ?? "compact"}
          onClick={
            props.onOpenLinkedItem
              ? () => props.onOpenLinkedItem?.({ kind: "pr", number: prNumber })
              : undefined
          }
        />
      ) : null}
    </span>
  );
}

function WorktreeSourceControlBadge(props: {
  variant: StateBadgeVariant;
  number: number;
  kind: LinkedWorktreeItem["kind"];
  kindLabel: string;
  displayLabel: string;
  density: "compact" | "header";
  onClick?: (() => void) | undefined;
}) {
  const Icon = props.variant.Icon;
  const title = props.variant.label
    ? `${props.kindLabel} #${props.number} — ${props.variant.label}`
    : `${props.kindLabel} #${props.number}`;
  const baseClass =
    props.density === "header"
      ? "inline-flex h-5 shrink-0 items-center justify-center gap-1 rounded-md border px-1.5 text-[10px] font-semibold tabular-nums leading-none"
      : "inline-flex h-4 shrink-0 items-center justify-center gap-0.5 rounded-sm border px-1 text-[9px] font-semibold tabular-nums leading-none";
  const iconClass = props.density === "header" ? "size-3" : "size-2.5";

  if (props.onClick) {
    const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      props.onClick?.();
    };
    return (
      <button
        type="button"
        className={cn(
          baseClass,
          props.variant.compactClassName,
          "cursor-pointer hover:brightness-125 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-current",
        )}
        title={title}
        aria-label={title}
        data-linked-worktree-item={props.kind}
        onClick={handleClick}
      >
        <Icon className={iconClass} />
        <span>{props.displayLabel}</span>
      </button>
    );
  }

  return (
    <span
      className={cn(baseClass, props.variant.compactClassName)}
      title={title}
      aria-label={title}
      data-linked-worktree-item={props.kind}
    >
      <Icon className={iconClass} />
      <span>{props.displayLabel}</span>
    </span>
  );
}
