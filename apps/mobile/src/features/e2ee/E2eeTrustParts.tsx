import { Pressable, View } from "react-native";

import { SymbolView } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";
import { CopyTextButton } from "../../components/CopyTextButton";
import { cn } from "../../lib/cn";
import { useThemeColor } from "../../lib/useThemeColor";
import type { MobileE2eeIdentityDisplay } from "../../hostedHub/e2eeSession";
import { CLAIM_SYMBOLS } from "./e2eeTrustSymbols";
import type { E2eeChannelClaim, E2eeTrustAction } from "./e2eeTrustUiModel";

/**
 * Presentational atoms for the §13 trust surfaces.
 *
 * Every decision, string, and action lives in `e2eeTrustUiModel.ts`, and every
 * SF Symbol name in `e2eeTrustSymbols.ts`; these are layout. The names live
 * outside this file because an unmapped SF name renders nothing at all on
 * Android — no glyph, no error — and only a module the node runner can load is
 * assertable: `e2eeTrustUiSurface.test.ts` checks every name in those tables
 * against `AppSymbol.tsx`'s Android map, and refuses an SF-shaped literal in
 * this file that the tables do not carry.
 */

/**
 * The channel's §12.2 label, its icon, and the sentence that goes with it.
 *
 * The label and message both come from the model, so the glyph is the only thing
 * chosen here — and it is chosen from the same `claim` the label was, so it
 * cannot say `Encrypted` beside an open padlock.
 */
export function E2eeChannelCard(props: {
  readonly claim: E2eeChannelClaim;
  readonly label: string;
  readonly message: string;
}) {
  const verified = props.claim === "verified" || props.claim === "account-trusted";
  const iconColor = useThemeColor(verified ? "--color-success" : "--color-icon-muted");
  return (
    <View className="mx-5 mt-4 rounded-2xl border border-border bg-card p-4">
      <View className="flex-row items-center gap-2.5">
        <SymbolView
          name={CLAIM_SYMBOLS[props.claim]}
          size={18}
          tintColor={iconColor}
          type="monochrome"
        />
        <Text
          className={cn("text-base font-ryco-bold", verified ? "text-success" : "text-foreground")}
        >
          {props.label}
        </Text>
      </View>
      <Text className="mt-2 font-sans text-sm leading-relaxed text-foreground-muted">
        {props.message}
      </Text>
    </View>
  );
}

/**
 * §13.1.1's persistent indication.
 *
 * Modelled on `HostedDeliveryUnknownNotice`: an `accessibilityRole="alert"` card
 * with NO dismiss affordance and no timeout. §13.1.1 requires exactly that — it
 * "MUST NOT be presented as a transient banner that dismisses into a
 * verified-looking state", and there is no control here that could.
 */
export function E2eeUnverifiedHubNotice(props: {
  readonly title: string;
  readonly message: string;
  readonly pair: E2eeTrustAction | null;
}) {
  const iconColor = useThemeColor("--color-warning");
  return (
    <View
      accessibilityRole="alert"
      className="mx-5 mt-4 rounded-2xl border border-warning-border bg-warning-bg p-4"
    >
      <View className="flex-row items-start gap-2.5">
        <View className="pt-0.5">
          <SymbolView
            name="exclamationmark.triangle"
            size={16}
            tintColor={iconColor}
            type="monochrome"
          />
        </View>
        <View className="flex-1">
          <Text className="text-sm font-ryco-bold text-foreground">{props.title}</Text>
          <Text className="mt-1.5 font-sans text-sm leading-relaxed text-foreground">
            {props.message}
          </Text>
        </View>
      </View>
      {props.pair ? (
        <Pressable
          accessibilityRole="button"
          onPress={props.pair.run}
          className="mt-3 self-start rounded-full border border-warning-border px-4 py-2 active:opacity-70"
        >
          <Text className="text-xs font-ryco-bold text-warning">{props.pair.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * The §13.4 safety number, as a mono, selectable, copyable grid.
 *
 * Cloned from `HostedRecoveryCodes` because the job is the same: make a value
 * transcribable and comparable by eye. The groups come from the model already
 * split, so no re-grouping happens here — §13.4's fixed length and grouping ARE
 * the checksum, and a surface that reflowed them would be showing the owner a
 * different shape from the node CLI.
 */
export function E2eeSafetyNumberCard(props: {
  readonly groups: readonly string[];
  readonly caption: string;
  readonly value: string;
}) {
  const iconColor = useThemeColor("--color-icon-muted");
  const borderColor = useThemeColor("--color-border");
  if (props.groups.length === 0) return null;
  return (
    <View className="mx-5 mt-4">
      <View className="flex-row flex-wrap gap-2 rounded-2xl border border-border bg-card p-4">
        {props.groups.map((group, index) => (
          <Text
            key={`${index}:${group}`}
            className="font-mono text-base tracking-wider text-foreground"
            selectable
          >
            {group}
          </Text>
        ))}
      </View>
      <View className="mt-3 flex-row items-center gap-2.5">
        <CopyTextButton
          accessibilityLabel="Copy safety number"
          text={props.value}
          tintColor={iconColor}
          borderColor={borderColor}
        />
        <Text className="flex-1 font-sans text-xs leading-relaxed text-foreground-muted">
          {props.caption}
        </Text>
      </View>
    </View>
  );
}

/** One identity's §7.1 fingerprint and §13.4 number, for a side-by-side. */
export function E2eeIdentityColumn(props: {
  readonly title: string;
  readonly identity: MobileE2eeIdentityDisplay;
}) {
  return (
    <View className="flex-1 rounded-2xl border border-border bg-card p-3">
      <Text className="text-xs font-ryco-bold uppercase text-foreground-muted">{props.title}</Text>
      <Text className="mt-2 font-mono text-xs text-foreground" selectable>
        {props.identity.fingerprint}
      </Text>
      <Text className="mt-2 font-mono text-xs leading-relaxed text-foreground-muted" selectable>
        {props.identity.safetyNumber}
      </Text>
    </View>
  );
}

/** A destructive or primary action, with the model's confirmation if it has one. */
export function E2eeActionButton(props: {
  readonly action: E2eeTrustAction;
  readonly onConfirm: (action: E2eeTrustAction) => void;
  readonly variant?: "primary" | "quiet";
}) {
  const primary = (props.variant ?? "primary") === "primary";
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => (props.action.confirm ? props.onConfirm(props.action) : props.action.run())}
      className={cn(
        "mx-5 mt-3 items-center rounded-full px-5 py-3.5 active:opacity-80",
        props.action.destructive
          ? "border border-danger-border bg-transparent"
          : primary
            ? "bg-primary"
            : "border border-border bg-transparent",
      )}
    >
      <Text
        className={cn(
          "text-sm font-ryco-bold",
          props.action.destructive
            ? "text-danger-foreground"
            : primary
              ? "text-primary-foreground"
              : "text-foreground",
        )}
      >
        {props.action.label}
      </Text>
    </Pressable>
  );
}
