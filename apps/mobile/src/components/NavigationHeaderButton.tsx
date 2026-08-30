import { Pressable } from "react-native";

import { useThemeColor } from "../lib/useThemeColor";
import { SymbolView } from "./AppSymbol";

export type NavigationHeaderAction = "back" | "close";

export function NavigationHeaderButton(props: {
  readonly action: NavigationHeaderAction;
  readonly onPress: () => void;
  readonly accessibilityLabel?: string;
}) {
  const iconColor = useThemeColor("--color-icon");
  const accessibilityLabel =
    props.accessibilityLabel ?? (props.action === "back" ? "Back" : "Close");

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={6}
      className="h-11 w-11 items-center justify-center rounded-full active:bg-subtle-strong"
      onPress={props.onPress}
    >
      <SymbolView
        name={props.action === "back" ? "chevron.left" : "xmark"}
        size={props.action === "back" ? 19 : 17}
        tintColor={iconColor as string}
        type="monochrome"
      />
    </Pressable>
  );
}
