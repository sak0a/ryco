import Constants from "expo-constants";
import { View } from "react-native";

import { AppText as Text } from "./AppText";

// Ryco brand placeholder. Replaces the upstream brand marks that the strip list
// drops. Text-only so it carries no stripped brand assets; keeps the `compact` /
// `stageLabel` prop shape the upstream mark exposed.
const appVariant = Constants.expoConfig?.extra?.appVariant;
const DEFAULT_STAGE_LABEL =
  appVariant === "development" ? "Dev" : appVariant === "preview" ? "Preview" : "Alpha";

export function RycoWordmark(props: { readonly compact?: boolean; readonly stageLabel?: string }) {
  const compact = props.compact ?? false;
  const stageLabel = props.stageLabel ?? DEFAULT_STAGE_LABEL;

  if (compact) {
    return (
      <View className="h-11 w-11 items-center justify-center">
        <Text className="text-xl font-ryco-bold tracking-[-0.8px] text-foreground">R</Text>
      </View>
    );
  }

  return (
    <View className="flex-row items-center gap-3">
      <View className="gap-1">
        <View className="flex-row items-center gap-2">
          <Text className="text-lg font-ryco-bold tracking-[-0.4px] text-foreground">Ryco</Text>
          <View className="rounded-full bg-subtle px-2 py-1">
            <Text className="text-3xs font-ryco-bold tracking-[1.1px] uppercase text-foreground-muted">
              {stageLabel}
            </Text>
          </View>
        </View>
        <Text className="text-xs font-medium text-foreground-muted">
          Mobile control surface for your live coding environments
        </Text>
      </View>
    </View>
  );
}
