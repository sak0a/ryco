import { Pressable, View } from "react-native";

import { SymbolView } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";
import { StatusPill } from "../../components/StatusPill";
import { cn } from "../../lib/cn";
import { useThemeColor } from "../../lib/useThemeColor";
import type { HostedPasskeyRow } from "./hostedAccountModel";

/**
 * The account's registered passkeys, as rows for a `SettingsSection` card —
 * hence no surface of its own, so the list and the "add" row read as one group
 * rather than two stacked cards.
 *
 * Presentation only. Which rows exist, how each is labelled, whether a revoke
 * is offered, and what the revoke opens are decided in `hostedAccountModel.ts`.
 *
 * A revoked credential is listed rather than hidden: the runtime reports
 * `revokedAt`, and a user who remembers enrolling a device needs to see why it
 * stopped working. `row.id` is the Hub's public credential handle and is used
 * only as a list key — it is never rendered.
 *
 * `trash` already resolves through `ANDROID_ICON_BY_SF_SYMBOL`, so no new
 * mapping is required for Android.
 */
export function HostedPasskeyList(props: {
  readonly rows: ReadonlyArray<HostedPasskeyRow>;
  readonly emptyDetail: string | null;
}) {
  const dangerColor = useThemeColor("--color-danger-foreground");

  if (props.rows.length === 0) {
    return props.emptyDetail === null ? null : (
      <View className="px-5 py-3.5">
        <Text className="font-sans text-sm leading-relaxed text-foreground-muted">
          {props.emptyDetail}
        </Text>
      </View>
    );
  }

  return (
    <>
      {props.rows.map((row, index) => (
        <View
          key={row.id}
          className={cn(
            "flex-row items-center gap-3 px-5 py-3.5",
            index > 0 && "border-t border-border-subtle",
            row.revoked && "opacity-60",
          )}
        >
          <View className="flex-1 gap-1">
            <Text className="font-sans text-base text-foreground" numberOfLines={1}>
              {row.label}
            </Text>
            <Text className="text-xs font-ryco-medium text-foreground-muted">{row.detail}</Text>
          </View>
          {row.tone ? (
            <StatusPill
              size="compact"
              label={row.tone.label}
              pillClassName={row.tone.pillClassName}
              textClassName={row.tone.textClassName}
            />
          ) : null}
          {row.revoke ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove ${row.label}`}
              hitSlop={8}
              onPress={row.revoke}
              className="h-9 w-9 items-center justify-center rounded-full active:bg-subtle"
            >
              <SymbolView name="trash" size={16} tintColor={dangerColor} type="monochrome" />
            </Pressable>
          ) : null}
        </View>
      ))}
    </>
  );
}
