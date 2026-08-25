import { Pressable, View } from "react-native";

import { SymbolView } from "../../../components/AppSymbol";
import { AppText as Text } from "../../../components/AppText";
import { useThemeColor } from "../../../lib/useThemeColor";

export function SettingsRow(props: {
  readonly label: string;
  readonly value?: string;
  readonly detail?: string;
  readonly onPress?: () => void;
  readonly first?: boolean;
  readonly destructive?: boolean;
  /** Renders the row inert and dimmed. Pass `onPress` anyway; it is ignored. */
  readonly disabled?: boolean;
}) {
  const chevronColor = useThemeColor("--color-icon-subtle");
  const content = (
    <View
      className={`flex-row items-center gap-3 px-5 py-3.5 ${props.first ? "" : "border-t border-border-subtle"} ${props.disabled ? "opacity-40" : ""}`}
    >
      <View className="min-w-0 flex-1">
        <Text
          className={`font-sans text-[17px] ${props.destructive ? "text-danger-foreground" : "text-foreground"}`}
        >
          {props.label}
        </Text>
        {props.detail ? (
          <Text className="mt-0.5 font-sans text-xs leading-4 text-foreground-muted">
            {props.detail}
          </Text>
        ) : null}
      </View>
      {props.value ? (
        <Text className="font-sans text-sm text-foreground-muted" numberOfLines={1}>
          {props.value}
        </Text>
      ) : null}
      {props.onPress && !props.disabled ? (
        <SymbolView
          name={{ ios: "chevron.right", android: "chevron_right" }}
          size={16}
          tintColor={chevronColor}
          type="monochrome"
        />
      ) : null}
    </View>
  );
  if (!props.onPress || props.disabled) return content;
  return (
    <Pressable onPress={props.onPress} className="active:bg-subtle">
      {content}
    </Pressable>
  );
}
