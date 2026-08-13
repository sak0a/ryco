import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import {
  DIRECT_CONNECTION_METHODS,
  type DirectConnectionMode,
} from "./directConnectionMethodsModel";

export function DirectConnectionMethods(props: {
  readonly value: DirectConnectionMode;
  readonly disabled?: boolean;
  readonly onChange: (mode: DirectConnectionMode) => void;
}) {
  return (
    <View className="gap-2">
      {DIRECT_CONNECTION_METHODS.map((method) => {
        const selected = props.value === method.id;
        return (
          <Pressable
            key={method.id}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected, disabled: props.disabled }}
            accessibilityLabel={`${method.title}. ${method.detail}`}
            disabled={props.disabled}
            onPress={() => props.onChange(method.id)}
            className={`min-h-16 flex-row items-center gap-3 rounded-full border px-5 py-3 active:bg-subtle disabled:opacity-40 ${
              selected ? "border-accent bg-accent-bg" : "border-border bg-card"
            }`}
          >
            <View className="min-w-0 flex-1">
              <Text className="text-base font-ryco-bold text-foreground">{method.title}</Text>
              <Text className="mt-0.5 text-xs font-ryco-medium text-foreground-muted">
                {method.detail}
              </Text>
            </View>
            <View
              className={`h-5 w-5 items-center justify-center rounded-full border ${
                selected ? "border-accent bg-accent" : "border-border"
              }`}
            >
              {selected ? <View className="h-2 w-2 rounded-full bg-primary-foreground" /> : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}
