import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { relativeTime } from "../../lib/time";
import type { InboxThreadRow as InboxThreadRowModel, InboxThreadState } from "./inboxModel";

function statusDotClassName(state: InboxThreadState): string {
  switch (state) {
    case "needs-input":
      return "bg-warning";
    case "delivery-unknown":
    case "error":
      return "bg-danger-foreground";
    case "working":
    case "connecting":
      return "bg-accent";
    case "reconnecting":
      return "border-2 border-warning";
    case "idle":
      return "border border-foreground-tertiary";
  }
}

function statusTextClassName(state: InboxThreadState): string {
  switch (state) {
    case "needs-input":
    case "reconnecting":
      return "text-warning";
    case "delivery-unknown":
    case "error":
      return "text-danger-foreground";
    case "working":
    case "connecting":
      return "text-accent-strong";
    case "idle":
      return "text-foreground-tertiary";
  }
}

export function InboxThreadRow(props: {
  readonly row: InboxThreadRowModel;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${props.row.title}, ${props.row.contextLabel}, ${props.row.statusLabel}`}
      onPress={props.onPress}
      className="mx-4 mb-2.5 flex-row items-start gap-3 rounded-2xl bg-card px-4 py-3.5 active:bg-card-alt"
    >
      <View className={`mt-1.5 h-2.5 w-2.5 rounded-full ${statusDotClassName(props.row.state)}`} />
      <View className="min-w-0 flex-1 gap-1">
        <View className="flex-row items-baseline gap-3">
          <Text
            className="min-w-0 flex-1 font-ryco-medium text-[17px] leading-[22px] text-foreground"
            numberOfLines={1}
          >
            {props.row.title}
          </Text>
          <Text className="font-mono text-2xs text-foreground-tertiary">
            {relativeTime(props.row.updatedAt)}
          </Text>
        </View>
        <Text className="font-sans text-xs text-foreground-muted" numberOfLines={1}>
          {props.row.contextLabel}
        </Text>
        <Text
          className={`text-xs font-ryco-medium ${statusTextClassName(props.row.state)}`}
          numberOfLines={1}
        >
          {props.row.statusLabel}
        </Text>
      </View>
    </Pressable>
  );
}
