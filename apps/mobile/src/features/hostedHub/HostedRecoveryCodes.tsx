import { View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { CopyTextButton } from "../../components/CopyTextButton";
import { useThemeColor } from "../../lib/useThemeColor";

/**
 * Recovery codes, shown exactly once.
 *
 * The Hub returns these on the registration that mints them and never again, so
 * the surface's whole job is to make them transcribable before they are gone:
 * an opaque card, a monospace row per code, per-code and copy-all affordances,
 * and selectable text. They are account recovery material rather than session
 * material — they never enter `SecretKV`, the bearer-token holder, or any
 * persisted store, and this component keeps them only for as long as the hosted
 * store holds them (`dismissRecoveryCodes()` clears both).
 */
export function HostedRecoveryCodes(props: { readonly codes: ReadonlyArray<string> }) {
  const iconColor = useThemeColor("--color-icon-muted");
  const borderColor = useThemeColor("--color-border");

  if (props.codes.length === 0) return null;

  return (
    <View className="mx-5 mt-4">
      <View className="overflow-hidden rounded-2xl border border-border bg-card">
        {props.codes.map((code, index) => (
          <View
            key={code}
            className={`flex-row items-center gap-3 px-4 py-3 ${index > 0 ? "border-t border-border-subtle" : ""}`}
          >
            <Text className="flex-1 font-mono text-sm text-foreground" selectable>
              {code}
            </Text>
            <CopyTextButton
              accessibilityLabel="Copy recovery code"
              text={code}
              tintColor={iconColor}
              borderColor={borderColor}
            />
          </View>
        ))}
      </View>
      <View className="mt-3 flex-row items-center gap-2.5">
        <CopyTextButton
          accessibilityLabel="Copy all recovery codes"
          text={props.codes.join("\n")}
          tintColor={iconColor}
          borderColor={borderColor}
        />
        <Text className="font-sans text-xs text-foreground-muted">Copy all codes</Text>
      </View>
    </View>
  );
}
