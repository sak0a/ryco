import { ScrollView, Pressable } from "react-native";

import type { EnvironmentId } from "@ryco/contracts";

import { AppText as Text } from "./AppText";

export interface NodeScopeOption {
  readonly environmentId: EnvironmentId;
  readonly label: string;
}

export function NodeScopeControl(props: {
  readonly options: ReadonlyArray<NodeScopeOption>;
  readonly selected: EnvironmentId | null;
  readonly onSelect: (environmentId: EnvironmentId | null) => void;
}) {
  if (props.options.length < 2) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
      className="mt-3 max-h-11"
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: props.selected === null }}
        onPress={() => props.onSelect(null)}
        className={`h-10 justify-center rounded-xl px-3 ${
          props.selected === null ? "bg-subtle-strong" : "bg-subtle active:bg-subtle-strong"
        }`}
      >
        <Text className="text-xs font-ryco-bold text-foreground">All machines</Text>
      </Pressable>
      {props.options.map((option) => {
        const selected = option.environmentId === props.selected;
        return (
          <Pressable
            key={option.environmentId}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => props.onSelect(option.environmentId)}
            className={`h-10 justify-center rounded-xl px-3 ${
              selected ? "bg-subtle-strong" : "bg-subtle active:bg-subtle-strong"
            }`}
          >
            <Text className="text-xs font-ryco-bold text-foreground" numberOfLines={1}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
