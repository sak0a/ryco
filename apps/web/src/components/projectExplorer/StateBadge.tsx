import { memo } from "react";
import { cn } from "~/lib/utils";
import { resolveStateBadgeVariant, type StateBadgeKind } from "../sourceControl/stateBadgeVariants";

export type { StateBadgeKind } from "../sourceControl/stateBadgeVariants";
export { changeRequestStateKind } from "../sourceControl/stateBadgeVariants";

export const StateBadge = memo(function StateBadge(props: {
  kind: StateBadgeKind;
  className?: string;
  /**
   * Drops the pill and the text, leaving the tinted glyph. Used where rows are
   * dense and the state is supporting information rather than the point — the
   * full pill claims a column and forces the title to wrap.
   */
  iconOnly?: boolean;
}) {
  const variant = variantByKind(props.kind);
  const Icon = variant.Icon;
  const label = variant.label ?? labelFallback(props.kind);
  if (props.iconOnly) {
    return (
      <span
        aria-label={label}
        title={label}
        className={cn(
          "inline-flex items-center justify-center rounded-full",
          variant.badgeClassName,
          "bg-transparent p-0",
          props.className,
        )}
      >
        <Icon className="size-3.5" />
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium text-xs",
        variant.badgeClassName,
        props.className,
      )}
    >
      <Icon className="size-3" />
      {label}
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
