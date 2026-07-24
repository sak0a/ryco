import type { ComponentProps } from "react";
import { Pressable } from "react-native";

import { useThemeColor } from "../lib/useThemeColor";
import { SymbolView } from "./AppSymbol";
import { GlassSurface } from "./GlassSurface";

// Floating circular nav/overlay action rendered as translucent glass (§3.5.3).
// On iOS 26 it is a real glass circle; on the fallback it is the opaque
// glass-surface fill + specular rim from GlassSurface. 36pt visual, ≥44pt touch.
export function GlassIconButton(props: {
  readonly icon: ComponentProps<typeof SymbolView>["name"];
  readonly accessibilityLabel: string;
  readonly onPress?: () => void;
  readonly size?: number;
}) {
  const iconColor = useThemeColor("--color-icon");
  const diameter = props.size ?? 36;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel}
      onPress={props.onPress}
      hitSlop={8}
      className="active:opacity-60"
    >
      <GlassSurface
        radius={diameter / 2}
        glassEffectStyle="clear"
        style={{
          height: diameter,
          width: diameter,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <SymbolView name={props.icon} size={18} tintColor={iconColor} type="monochrome" />
      </GlassSurface>
    </Pressable>
  );
}
