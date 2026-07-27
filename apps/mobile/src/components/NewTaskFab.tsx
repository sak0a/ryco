import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useThemeColor } from "../lib/useThemeColor";
import { SymbolView } from "./AppSymbol";
import { GlassSurface } from "./GlassSurface";

export const NEW_TASK_FAB_DIAMETER = 56;
/** Gap between the button and the home indicator. */
export const NEW_TASK_FAB_INSET = 16;

/**
 * Home's single primary action, floated bottom-right where a thumb reaches it.
 *
 * It carries the same glass treatment as the header capsule it replaces — this
 * is the header "+" moved, not a new visual language — and takes its prominence
 * from position and size (56pt against the header's 36pt) rather than colour.
 *
 * Deliberately its own module: `HomeScreen.test.ts` renders `HomeScreen()` under
 * a three-export `react-native` stub, so anything reading `useSafeAreaInsets`
 * has to be mockable at the module boundary.
 */
export function NewTaskFab(props: {
  readonly accessibilityLabel: string;
  readonly onPress: () => void;
}) {
  const insets = useSafeAreaInsets();
  const iconColor = useThemeColor("--color-icon");

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        right: NEW_TASK_FAB_INSET,
        bottom: insets.bottom + NEW_TASK_FAB_INSET,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={props.accessibilityLabel}
        onPress={props.onPress}
        className="active:opacity-70"
      >
        <GlassSurface
          radius={NEW_TASK_FAB_DIAMETER / 2}
          glassEffectStyle="regular"
          style={{
            height: NEW_TASK_FAB_DIAMETER,
            width: NEW_TASK_FAB_DIAMETER,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <SymbolView name="plus" size={24} tintColor={iconColor} type="monochrome" />
        </GlassSurface>
      </Pressable>
    </View>
  );
}
