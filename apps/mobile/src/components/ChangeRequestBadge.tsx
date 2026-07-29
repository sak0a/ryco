import { View } from "react-native";

import { cn } from "../lib/cn";
import type { ChangeRequestBadge as ChangeRequestBadgeModel } from "../lib/changeRequestBadge";
import { AppText as Text } from "./AppText";

// Outlined, not filled. This is last-known metadata, not live status — nothing
// refreshes `prState` in the background (see lib/changeRequestBadge.ts). A solid
// status chip would read as "this is true right now", which it is not.
const TONE_CLASS: Readonly<Record<ChangeRequestBadgeModel["tone"], string>> = {
  open: "border-success/40 text-success",
  draft: "border-foreground-tertiary/40 text-foreground-tertiary",
  merged: "border-plan/40 text-plan",
  closed: "border-danger-foreground/40 text-danger-foreground",
  neutral: "border-border text-foreground-tertiary",
};

export function ChangeRequestBadge(props: {
  readonly badge: ChangeRequestBadgeModel;
  readonly className?: string;
}) {
  return (
    <View
      accessible
      accessibilityLabel={props.badge.accessibilityLabel}
      className={cn(
        "shrink-0 rounded-md border px-1.5 py-px",
        TONE_CLASS[props.badge.tone],
        props.className,
      )}
    >
      <Text className={cn("font-mono text-2xs", TONE_CLASS[props.badge.tone])} numberOfLines={1}>
        {props.badge.label}
      </Text>
    </View>
  );
}
