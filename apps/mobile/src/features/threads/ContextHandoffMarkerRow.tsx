import type { ContextHandoffTimelineEntry } from "@ryco/client-runtime/state/session";
import { View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { SymbolView } from "../../components/AppSymbol";
import { useThemeColor } from "../../lib/useThemeColor";
import { ContextHandoffEndpointLabel } from "./ContextHandoffEndpointLabel";
import { contextHandoffMarkerAccessibilityLabel } from "./contextHandoffModel";

export function ContextHandoffMarkerRow(props: { readonly marker: ContextHandoffTimelineEntry }) {
  const { marker } = props;
  const failed = marker.status === "failed";
  const uncertain = marker.status === "delivery-uncertain";
  const iconColor = String(
    useThemeColor(
      failed ? "--color-danger-foreground" : uncertain ? "--color-warning" : "--color-icon-subtle",
    ),
  );
  const dividerClass = failed
    ? "bg-danger-foreground/40"
    : uncertain
      ? "bg-warning/40"
      : "bg-border";
  const textClass = failed
    ? "text-danger-foreground"
    : uncertain
      ? "text-warning"
      : "text-foreground-muted";

  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={contextHandoffMarkerAccessibilityLabel(marker)}
      className="my-3 flex-row items-center gap-2 px-4"
    >
      <View className={`h-px min-w-2 flex-1 ${dividerClass}`} />
      <View className="max-w-[82%] items-center gap-1">
        <View className="flex-row items-center gap-1">
          <SymbolView
            name="arrow.left.arrow.right"
            size={13}
            tintColor={iconColor}
            type="monochrome"
          />
          <Text className={`text-[11px] font-ryco-medium ${textClass}`}>Context handoff</Text>
          {failed || uncertain ? (
            <Text className={`text-[10px] font-ryco-medium ${textClass}`}>
              {failed ? "Failed" : "Delivery uncertain"}
            </Text>
          ) : null}
        </View>
        <View className="max-w-full flex-row items-center justify-center gap-1.5">
          {marker.sources.slice(0, 1).map((source) => (
            <ContextHandoffEndpointLabel
              key={`${source.providerInstanceId}:${source.modelSlug}`}
              endpoint={source}
            />
          ))}
          {marker.sources.length > 1 ? (
            <Text className={`text-[10px] font-ryco-medium ${textClass}`}>
              +{marker.sources.length - 1}
            </Text>
          ) : null}
          <SymbolView name="arrow.right" size={12} tintColor={iconColor} type="monochrome" />
          <ContextHandoffEndpointLabel endpoint={marker.target} emphasized />
        </View>
      </View>
      <View className={`h-px min-w-2 flex-1 ${dividerClass}`} />
    </View>
  );
}
