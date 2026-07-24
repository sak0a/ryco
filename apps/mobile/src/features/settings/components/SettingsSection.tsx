import type { ReactNode } from "react";
import { View } from "react-native";

import { AppText as Text } from "../../../components/AppText";

export function SettingsSection(props: { readonly title?: string; readonly children: ReactNode }) {
  return (
    <View className="mt-6">
      {props.title ? (
        <Text className="px-5 pb-2.5 text-sm font-ryco-medium text-foreground-muted">
          {props.title}
        </Text>
      ) : null}
      <View className="mx-5 overflow-hidden rounded-2xl border border-border bg-card">
        {props.children}
      </View>
    </View>
  );
}
