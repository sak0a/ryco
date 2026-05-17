import { memo } from "react";
import { cn } from "~/lib/utils";
import {
  resolveStateBadgeVariant,
  type StateBadgeKind,
} from "../sourceControl/stateBadgeVariants";

export type { StateBadgeKind } from "../sourceControl/stateBadgeVariants";

export const StateBadge = memo(function StateBadge(props: {
  kind: StateBadgeKind;
  className?: string;
}) {
  const variant = variantByKind(props.kind);
  const Icon = variant.Icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium text-xs",
        variant.badgeClassName,
        props.className,
      )}
    >
      <Icon className="size-3" />
      {variant.label ?? labelFallback(props.kind)}
    </span>
  );
});

function variantByKind(kind: StateBadgeKind) {
  switch (kind) {
    case "issue-open":
      return resolveStateBadgeVariant({ kind: "issue", state: "open" });
    case "issue-closed":
      return resolveStateBadgeVariant({ kind: "issue", state: "closed" });
    case "issue-unknown":
      return resolveStateBadgeVariant({ kind: "issue", state: null });
    case "pr-open":
      return resolveStateBadgeVariant({ kind: "pr", state: "open", isDraft: false });
    case "pr-draft":
      return resolveStateBadgeVariant({ kind: "pr", state: "open", isDraft: true });
    case "pr-merged":
      return resolveStateBadgeVariant({ kind: "pr", state: "merged" });
    case "pr-closed":
      return resolveStateBadgeVariant({ kind: "pr", state: "closed" });
    case "pr-unknown":
      return resolveStateBadgeVariant({ kind: "pr", state: null });
  }
}

function labelFallback(kind: StateBadgeKind): string {
  return kind.startsWith("issue") ? "Issue" : "PR";
}

export function changeRequestStateKind(
  state: "open" | "closed" | "merged",
  isDraft?: boolean,
): StateBadgeKind {
  if (state === "merged") return "pr-merged";
  if (state === "closed") return "pr-closed";
  return isDraft ? "pr-draft" : "pr-open";
}
