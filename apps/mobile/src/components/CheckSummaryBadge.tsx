import { View } from "react-native";

import { cn } from "../lib/cn";
import type { CheckSummary, CheckSummaryState } from "../features/threads/prCheckSummary";
import { AppText as Text } from "./AppText";

// The CI summary beside a PR badge: a state dot plus "3/9".
//
// `unknown` is grey and says so. It must never borrow the neutral styling of a
// PR that genuinely has no checks, and certainly not the green of one that
// passed — "we could not read it" is its own answer.
const DOT: Readonly<Record<CheckSummaryState, string>> = {
  passed: "bg-success",
  failed: "bg-danger-foreground",
  running: "bg-accent",
  queued: "bg-foreground-tertiary",
  none: "bg-transparent border border-border",
  unknown: "bg-transparent border border-dashed border-foreground-tertiary",
};

const TEXT: Readonly<Record<CheckSummaryState, string>> = {
  passed: "text-success",
  failed: "text-danger-foreground",
  running: "text-accent-strong",
  queued: "text-foreground-tertiary",
  none: "text-foreground-tertiary",
  unknown: "text-foreground-tertiary",
};

export function CheckSummaryBadge(props: { readonly summary: CheckSummary }) {
  const { summary } = props;
  // A PR with no checks at all is not worth a badge; silence is accurate.
  if (summary.state === "none") return null;

  return (
    <View
      accessible
      accessibilityLabel={summary.accessibilityLabel}
      className="shrink-0 flex-row items-center gap-1"
    >
      <View className={cn("h-2 w-2 rounded-full", DOT[summary.state])} />
      <Text className={cn("font-mono text-2xs", TEXT[summary.state])} numberOfLines={1}>
        {summary.countLabel ?? "?"}
      </Text>
    </View>
  );
}
