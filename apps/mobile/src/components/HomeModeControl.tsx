import { Pressable, View } from "react-native";

import { AppText as Text } from "./AppText";
import type { HomeMode } from "../features/home/homeMode";

const MODES: ReadonlyArray<{ readonly mode: HomeMode; readonly label: string }> = [
  { mode: "inbox", label: "Inbox" },
  { mode: "projects", label: "Projects" },
];

export function HomeModeControl(props: {
  readonly mode: HomeMode;
  readonly onSelect: (mode: HomeMode) => void;
}) {
  return (
    <View
      accessibilityRole="tablist"
      className="mx-4 mt-2 flex-row rounded-2xl border border-border bg-glass-surface p-1"
    >
      {MODES.map((item) => {
        const selected = props.mode === item.mode;
        return (
          <Pressable
            key={item.mode}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => props.onSelect(item.mode)}
            className={`h-11 flex-1 items-center justify-center rounded-xl ${
              selected ? "bg-subtle-strong" : "active:bg-subtle"
            }`}
          >
            <Text
              className={`text-sm ${
                selected
                  ? "font-ryco-bold text-foreground"
                  : "font-ryco-medium text-foreground-muted"
              }`}
            >
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
