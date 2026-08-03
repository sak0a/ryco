import { Pressable, ScrollView, View } from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  ReduceMotion,
  SlideInDown,
  SlideOutDown,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/AppText";
import { SymbolView } from "../../components/AppSymbol";
import { GlassSurface } from "../../components/GlassSurface";
import { OverlayPortal } from "../../components/OverlayPortal";
import { cn } from "../../lib/cn";
import { useThemeColor } from "../../lib/useThemeColor";
import type { SessionPolicyGroup, SessionPolicyModel } from "./sessionPolicyModel";

// Session policy sheet for an existing thread.
//
// Projected through OverlayPortal rather than a React Native <Modal>: a Modal
// is a separate native window, so presenting one moves window focus and closes
// the soft keyboard. This sheet is opened from the composer, which is the
// keyboard-sticky surface, so a Modal would dismiss the keyboard every time the
// user checked a setting mid-message (see OverlayPortal.tsx:4-7).

function PolicyGroup<Value extends string>(props: {
  readonly group: SessionPolicyGroup<Value>;
  readonly onSelect: (value: Value) => void;
}) {
  const selected = props.group.segments.find((segment) => segment.selected);
  // The one reason worth surfacing is the one attached to a segment the user
  // can see is off. Prefer a disabled-but-relevant reason over none at all.
  const reason =
    props.group.segments.find((segment) => segment.disabled && segment.disabledReason)
      ?.disabledReason ?? null;

  return (
    <View className="gap-2">
      <Text className="px-1 text-xs font-ryco-bold uppercase tracking-wide text-foreground-tertiary">
        {props.group.label}
      </Text>
      <View className="flex-row gap-1.5 rounded-2xl bg-subtle p-1">
        {props.group.segments.map((segment) => {
          const isCaution = segment.tone === "caution";
          return (
            <Pressable
              key={segment.value}
              accessibilityRole="radio"
              accessibilityState={{ checked: segment.selected, disabled: segment.disabled }}
              accessibilityLabel={
                segment.disabled && segment.disabledReason
                  ? `${segment.label}. ${segment.disabledReason}`
                  : `${segment.label}. ${segment.description}`
              }
              disabled={segment.disabled}
              onPress={() => props.onSelect(segment.value)}
              className={cn(
                "min-h-11 flex-1 flex-row items-center justify-center rounded-xl px-1.5 py-2 active:opacity-70",
                segment.selected ? (isCaution ? "bg-warning-bg" : "bg-card") : "bg-transparent",
                segment.disabled && "opacity-40",
              )}
            >
              {/* No per-segment icon: Access is four segments sharing ~82pt
                  each, and an icon plus its gap costs 20 of that — enough to
                  truncate "Auto-accept" to "Auto-acc…". The glyph stays on the
                  rail pill, where there is room for it. */}
              <Text
                className={cn(
                  "shrink text-center text-xs font-ryco-bold",
                  segment.selected && isCaution ? "text-warning" : "text-foreground",
                )}
                numberOfLines={1}
              >
                {segment.shortLabel}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {selected ? (
        <Text className="px-1 text-xs text-foreground-muted">{selected.description}</Text>
      ) : null}
      {reason ? <Text className="px-1 text-xs font-ryco-medium text-warning">{reason}</Text> : null}
    </View>
  );
}

export function SessionPolicySheet(props: {
  readonly visible: boolean;
  readonly model: SessionPolicyModel;
  readonly onClose: () => void;
  readonly onSelectRuntimeMode: (
    value: SessionPolicyModel["access"]["segments"][number]["value"],
  ) => void;
  readonly onSelectInteractionMode: (
    value: NonNullable<SessionPolicyModel["mode"]>["segments"][number]["value"],
  ) => void;
}) {
  const insets = useSafeAreaInsets();
  const iconColor = useThemeColor("--color-icon");

  if (!props.visible) return null;

  return (
    <OverlayPortal>
      <Animated.View
        entering={FadeIn.duration(160).reduceMotion(ReduceMotion.System)}
        exiting={FadeOut.duration(140).reduceMotion(ReduceMotion.System)}
        className="absolute inset-0"
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close session policy"
          onPress={props.onClose}
          className="flex-1 bg-backdrop"
        />
      </Animated.View>
      <Animated.View
        // Matches the model picker exactly: two sibling sheets opened from the
        // same rail, so one animating and the other not would read as a bug.
        entering={SlideInDown.duration(260).reduceMotion(ReduceMotion.System)}
        exiting={SlideOutDown.duration(200).reduceMotion(ReduceMotion.System)}
        pointerEvents="box-none"
        className="absolute inset-x-0 bottom-0 px-3"
        style={{ paddingBottom: Math.max(12, insets.bottom) }}
      >
        <GlassSurface radius={28} glassEffectStyle="regular" style={{ padding: 16 }}>
          <View className="mb-3 flex-row items-center justify-between">
            <Text className="text-base font-ryco-bold text-foreground">Session policy</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Done"
              onPress={props.onClose}
              className="h-9 w-9 items-center justify-center rounded-full active:bg-subtle-strong"
            >
              <SymbolView
                name="xmark"
                size={15}
                tintColor={iconColor as string}
                type="monochrome"
              />
            </Pressable>
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ gap: 18, paddingBottom: 4 }}
            style={{ maxHeight: 420 }}
          >
            {props.model.mode ? (
              <PolicyGroup group={props.model.mode} onSelect={props.onSelectInteractionMode} />
            ) : null}
            <PolicyGroup group={props.model.access} onSelect={props.onSelectRuntimeMode} />
          </ScrollView>
        </GlassSurface>
      </Animated.View>
    </OverlayPortal>
  );
}
