import { Pressable, View } from "react-native";

import { SymbolView } from "../../../components/AppSymbol";
import { AppText as Text } from "../../../components/AppText";
import { useThemeColor } from "../../../lib/useThemeColor";

export function SettingsRow(props: {
  readonly label: string;
  readonly value?: string;
  readonly onPress?: () => void;
  readonly first?: boolean;
  readonly destructive?: boolean;
}) {
  const chevronColor = useThemeColor("--color-icon-subtle");
  const content = (
    <View
      className={`flex-row items-center gap-3 px-4 py-3 ${props.first ? "" : "border-t border-border"}`}
    >
      <Text
        className={`flex-1 font-sans text-base ${props.destructive ? "text-rose-700 dark:text-rose-300" : "text-foreground"}`}
      >
        {props.label}
      </Text>
      {props.value ? (
        <Text className="font-sans text-sm text-foreground-muted" numberOfLines={1}>
          {props.value}
        </Text>
      ) : null}
      {props.onPress ? (
        <SymbolView name={{ ios: "chevron.right", android: "chevron_right" }} size={16} tintColor={chevronColor} type="monochrome" />
      ) : null}
    </View>
  );
  if (!props.onPress) return content;
  return (
    <Pressable onPress={props.onPress} className="active:bg-subtle">
      {content}
    </Pressable>
  );
}
