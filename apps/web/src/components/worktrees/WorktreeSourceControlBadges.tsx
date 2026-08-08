import type { MouseEvent } from "react";
import type { PullRequestId } from "@ryco/contracts";
import { AtlassianJiraIcon } from "../Icons";
import { cn } from "~/lib/utils";
import { workItemStateLabel } from "~/lib/workItemState";
import {
  resolveStateBadgeVariant,
  type StateBadgeVariant,
} from "../sourceControl/stateBadgeVariants";
import type { LinkedWorktreeItem } from "./LinkedWorktreeItemDialog";
import { useRelatedPullRequests } from "../pullRequests/useRelatedPullRequests";

export interface WorktreeSourceControlBadgesProps {
  issueNumber?: number | null | undefined;
  prNumber?: number | null | undefined;
  issueState?: "open" | "closed" | null | undefined;
  prState?: "open" | "closed" | "merged" | null | undefined;
  prIsDraft?: boolean | null | undefined;
  workItemProvider?: "jira" | null | undefined;
  workItemKey?: string | null | undefined;
  workItemState?: "open" | "in_progress" | "done" | "closed" | "unknown" | null | undefined;
  workItemStateName?: string | null | undefined;
  onOpenLinkedItem?: ((item: LinkedWorktreeItem) => void) | undefined;
  worktreeId?: string | null | undefined;
  onOpenPullRequest?: ((pullRequestId: PullRequestId) => void) | undefined;
  className?: string | undefined;
  density?: "compact" | "header" | undefined;
  labelStyle?: "number" | "kind" | undefined;
  displayMode?: "all" | "prefer-pr" | undefined;
}

export function WorktreeSourceControlBadges(props: WorktreeSourceControlBadgesProps) {
  const relatedPullRequests = useRelatedPullRequests("worktree", props.worktreeId);
  const canonicalPullRequests = relatedPullRequests.slice(0, 2);
  const prNumber = relatedPullRequests.length === 0 ? (props.prNumber ?? null) : null;
  const hasPullRequest = relatedPullRequests.length > 0 || prNumber !== null;
  const issueNumber =
    props.displayMode === "prefer-pr" && hasPullRequest ? null : (props.issueNumber ?? null);
  const workItemKey = props.workItemProvider === "jira" ? (props.workItemKey ?? null) : null;

  if (issueNumber === null && !hasPullRequest && workItemKey === null) {
    return null;
  }

  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1", props.className)}>
      {workItemKey !== null ? (
        <WorktreeWorkItemBadge
          itemKey={workItemKey}
          state={props.workItemState ?? null}
          stateName={props.workItemStateName ?? null}
          density={props.density ?? "compact"}
          onClick={
            props.onOpenLinkedItem
              ? () =>
                  props.onOpenLinkedItem?.({
                    kind: "workItem",
                    provider: "jira",
                    key: workItemKey,
                  })
              : undefined
          }
        />
      ) : null}
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
      {canonicalPullRequests.map((item) => {
        const pullRequest = item.pullRequest;
        const stateLabel = pullRequest.isDraft ? "Draft" : pullRequest.state;
        return (
          <WorktreeSourceControlBadge
            key={pullRequest.identity.id}
            variant={resolveStateBadgeVariant({
              kind: "pr",
              state: pullRequest.state,
              isDraft: pullRequest.isDraft,
            })}
            number={pullRequest.identity.number}
            kind="pr"
            kindLabel="Pull request"
            displayLabel={
              props.labelStyle === "kind"
                ? `PR #${pullRequest.identity.number}`
                : `#${pullRequest.identity.number}`
            }
            density={props.density ?? "compact"}
            title={`${pullRequest.repository.displayName} #${pullRequest.identity.number} — ${stateLabel}: ${pullRequest.title}`}
            onClick={
              props.onOpenPullRequest
                ? () => props.onOpenPullRequest?.(pullRequest.identity.id)
                : undefined
            }
          />
        );
      })}
      {relatedPullRequests.length > canonicalPullRequests.length ? (
        <span
          className="text-[9px] font-semibold text-muted-foreground"
          title={`${relatedPullRequests.length - canonicalPullRequests.length} more related pull requests`}
        >
          +{relatedPullRequests.length - canonicalPullRequests.length}
        </span>
      ) : null}
    </span>
  );
}

function WorktreeWorkItemBadge(props: {
  itemKey: string;
  state: WorktreeSourceControlBadgesProps["workItemState"];
  stateName: string | null;
  density: "compact" | "header";
  onClick?: (() => void) | undefined;
}) {
  const baseClass =
    props.density === "header"
      ? "inline-flex h-5 shrink-0 items-center justify-center gap-1 rounded-md border px-1.5 text-[10px] font-semibold tabular-nums leading-none"
      : "inline-flex h-4 shrink-0 items-center justify-center gap-0.5 rounded-sm border px-1 text-[9px] font-semibold tabular-nums leading-none";
  const iconClass = props.density === "header" ? "size-3" : "size-2.5";
  const stateLabel = props.state
    ? workItemStateLabel({ state: props.state, stateName: props.stateName })
    : null;
  const title = `Jira ${props.itemKey}${stateLabel ? ` — ${stateLabel}` : ""}`;
  const className = "border-violet-500/20 bg-violet-500/10 text-violet-600 dark:text-violet-300";

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
          className,
          "cursor-pointer hover:brightness-125 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-current",
        )}
        title={title}
        aria-label={title}
        data-linked-worktree-item="workItem"
        onClick={handleClick}
      >
        <AtlassianJiraIcon className={iconClass} />
        <span>{props.itemKey}</span>
      </button>
    );
  }

  return (
    <span
      className={cn(baseClass, className)}
      title={title}
      aria-label={title}
      data-linked-worktree-item="workItem"
    >
      <AtlassianJiraIcon className={iconClass} />
      <span>{props.itemKey}</span>
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
  title?: string | undefined;
}) {
  const Icon = props.variant.Icon;
  const title =
    props.title ??
    (props.variant.label
      ? `${props.kindLabel} #${props.number} — ${props.variant.label}`
      : `${props.kindLabel} #${props.number}`);
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
