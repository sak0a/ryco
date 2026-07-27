import { Pressable, ScrollView, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/AppText";
import { SymbolView } from "../../components/AppSymbol";
import { GlassSurface } from "../../components/GlassSurface";
import { OverlayPortal } from "../../components/OverlayPortal";
import { ProviderIcon } from "../../components/ProviderIcon";
import { cn } from "../../lib/cn";
import { useThemeColor } from "../../lib/useThemeColor";
import type { ModelPickerModel } from "./modelPickerModel";

// Grouped model picker, one section per provider instance, with the provider's
// brand mark on the section header. Like the policy sheet it goes through
// OverlayPortal rather than a Modal so opening it does not dismiss the
// composer's keyboard.

export function ModelPickerSheet(props: {
  readonly visible: boolean;
  readonly model: ModelPickerModel;
  readonly query: string;
  readonly onChangeQuery: (query: string) => void;
  readonly onClose: () => void;
  readonly onSelect: (key: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const iconColor = useThemeColor("--color-icon");
  const placeholderColor = useThemeColor("--color-placeholder");
  const textColor = useThemeColor("--color-foreground");

  if (!props.visible) return null;

  return (
    <OverlayPortal>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close model picker"
        onPress={props.onClose}
        className="absolute inset-0 bg-backdrop"
      />
      <View
        pointerEvents="box-none"
        className="absolute inset-x-0 bottom-0 px-3"
        style={{ paddingBottom: Math.max(12, insets.bottom) }}
      >
        <GlassSurface radius={28} glassEffectStyle="regular" style={{ padding: 16 }}>
          <View className="mb-3 flex-row items-center justify-between">
            <Text className="text-base font-ryco-bold text-foreground">Model</Text>
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

          <View className="mb-3 flex-row items-center rounded-2xl bg-sidebar-search px-3">
            <SymbolView
              name="magnifyingglass"
              size={15}
              tintColor={placeholderColor as string}
              type="monochrome"
            />
            <TextInput
              accessibilityLabel="Search models"
              value={props.query}
              onChangeText={props.onChangeQuery}
              placeholder="Search models"
              placeholderTextColor={placeholderColor as string}
              autoCapitalize="none"
              autoCorrect={false}
              className="h-10 flex-1 px-2 font-sans text-sm"
              style={{ color: textColor as string }}
            />
          </View>

          {props.model.lockNotice ? (
            <Text className="mb-2 px-1 text-xs font-ryco-medium text-warning">
              {props.model.lockNotice}
            </Text>
          ) : null}

          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ gap: 14, paddingBottom: 4 }}
            style={{ maxHeight: 380 }}
          >
            {props.model.loading ? (
              <Text className="px-1 py-6 text-center text-sm text-foreground-muted">
                Loading models from the node…
              </Text>
            ) : props.model.groups.length === 0 ? (
              <Text className="px-1 py-6 text-center text-sm text-foreground-muted">
                {props.model.emptyForQuery
                  ? "No models match that search."
                  : "This node has no available models."}
              </Text>
            ) : (
              props.model.groups.map((group) => (
                <View key={group.providerKey} className="gap-1.5">
                  <View className="flex-row items-center gap-2 px-1">
                    <ProviderIcon provider={group.providerDriver} size={14} />
                    <Text className="text-xs font-ryco-bold uppercase tracking-wide text-foreground-tertiary">
                      {group.providerLabel}
                    </Text>
                  </View>
                  <View className="overflow-hidden rounded-2xl bg-subtle">
                    {group.entries.map((entry, index) => (
                      <Pressable
                        key={entry.key}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: entry.selected, disabled: entry.disabled }}
                        accessibilityLabel={
                          entry.disabled && entry.disabledReason
                            ? `${entry.label}. ${entry.disabledReason}`
                            : entry.label
                        }
                        disabled={entry.disabled}
                        onPress={() => props.onSelect(entry.key)}
                        className={cn(
                          "min-h-11 flex-row items-center justify-between gap-3 px-3.5 py-2.5 active:bg-card-alt",
                          index > 0 && "border-t border-border-subtle",
                          entry.disabled && "opacity-40",
                        )}
                      >
                        <Text
                          className={cn(
                            "shrink text-sm",
                            entry.selected
                              ? "font-ryco-bold text-foreground"
                              : "font-ryco-medium text-foreground",
                          )}
                          numberOfLines={1}
                        >
                          {entry.label}
                        </Text>
                        {entry.selected ? (
                          <SymbolView
                            name="checkmark"
                            size={14}
                            tintColor={iconColor as string}
                            type="monochrome"
                          />
                        ) : null}
                      </Pressable>
                    ))}
                  </View>
                </View>
              ))
            )}
          </ScrollView>
        </GlassSurface>
      </View>
    </OverlayPortal>
  );
}
