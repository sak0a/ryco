import {
  CheckCircle2Icon,
  CircleDotIcon,
  GitMergeIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
  XCircleIcon,
  type LucideIcon,
} from "lucide-react";

export type StateBadgeKind =
  | "issue-open"
  | "issue-closed"
  | "issue-unknown"
  | "pr-open"
  | "pr-draft"
  | "pr-merged"
  | "pr-closed"
  | "pr-unknown";

export type StateBadgeTone = "emerald" | "violet" | "zinc" | "rose" | "blue";

export interface StateBadgeVariant {
  readonly kind: StateBadgeKind;
  readonly Icon: LucideIcon;
  readonly tone: StateBadgeTone;
  /** Human-readable state label, or `null` when state is unknown. */
  readonly label: string | null;
  /** Tailwind classes for the bigger pill style (`StateBadge`). */
  readonly badgeClassName: string;
  /** Tailwind classes for the compact sidebar chip. */
  readonly compactClassName: string;
}

const tones: Record<StateBadgeTone, { badge: string; compact: string }> = {
  emerald: {
    badge: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
    compact: "border-emerald-500/16 bg-emerald-500/10 text-emerald-500 dark:text-emerald-400",
  },
  violet: {
    badge: "bg-violet-500/12 text-violet-700 dark:text-violet-300",
    compact: "border-violet-500/16 bg-violet-500/10 text-violet-500 dark:text-violet-400",
  },
  zinc: {
    badge: "bg-zinc-500/14 text-zinc-700 dark:text-zinc-300",
    compact: "border-zinc-500/16 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
  },
  rose: {
    badge: "bg-rose-500/12 text-rose-700 dark:text-rose-300",
    compact: "border-rose-500/16 bg-rose-500/10 text-rose-500 dark:text-rose-400",
  },
  blue: {
    badge: "bg-blue-500/12 text-blue-700 dark:text-blue-300",
    compact: "border-blue-500/16 bg-blue-500/10 text-blue-500 dark:text-blue-400",
  },
};

export interface ResolveStateBadgeVariantInput {
  readonly kind: "issue" | "pr";
  readonly state: "open" | "closed" | "merged" | null;
  readonly isDraft?: boolean | null;
}

export function resolveStateBadgeVariant(input: ResolveStateBadgeVariantInput): StateBadgeVariant {
  if (input.kind === "issue") {
    if (input.state === "closed") {
      return variant("issue-closed", CheckCircle2Icon, "violet", "Closed");
    }
    if (input.state === "open") {
      return variant("issue-open", CircleDotIcon, "emerald", "Open");
    }
    return variant("issue-unknown", CircleDotIcon, "emerald", null);
  }
  // pr
  if (input.state === "merged") {
    return variant("pr-merged", GitMergeIcon, "violet", "Merged");
  }
  if (input.state === "closed") {
    return variant("pr-closed", XCircleIcon, "rose", "Closed");
  }
  if (input.state === "open") {
    if (input.isDraft) {
      return variant("pr-draft", GitPullRequestDraftIcon, "zinc", "Draft");
    }
    return variant("pr-open", GitPullRequestIcon, "emerald", "Open");
  }
  return variant("pr-unknown", GitPullRequestIcon, "blue", null);
}

function variant(
  kind: StateBadgeKind,
  Icon: LucideIcon,
  tone: StateBadgeTone,
  label: string | null,
): StateBadgeVariant {
  return {
    kind,
    Icon,
    tone,
    label,
    badgeClassName: tones[tone].badge,
    compactClassName: tones[tone].compact,
  };
}
