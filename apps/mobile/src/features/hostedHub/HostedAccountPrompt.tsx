import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  View,
} from "react-native";

import { SymbolView } from "../../components/AppSymbol";
import { AppText as Text, AppTextInput } from "../../components/AppText";
import { ErrorBanner } from "../../components/ErrorBanner";
import { cn } from "../../lib/cn";
import { useThemeColor } from "../../lib/useThemeColor";
import type { HostedAccountButton, HostedAccountPromptView } from "./hostedAccountModel";
import { HostedTotpEnrollmentCard } from "./HostedTotpEnrollmentCard";

/**
 * The one modal every account mutation runs through.
 *
 * Presentation only: the title, the copy, which fields exist, whether submit is
 * allowed, and which controller call fires all come from
 * `deriveHostedAccountManagementView` and are asserted in
 * `hostedAccountModel.test.ts`. Nothing is decided here.
 *
 * Content stays opaque `bg-card` — glass is floating chrome, and this is a
 * content surface. Only `exclamationmark.triangle`, which already resolves
 * through `ANDROID_ICON_BY_SF_SYMBOL`, is used, so no glyph silently renders as
 * nothing on Android.
 */
function PromptButton(props: {
  readonly action: HostedAccountButton;
  readonly variant: "primary" | "quiet";
}) {
  const { action, variant } = props;
  if (variant === "quiet") {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: action.disabled }}
        disabled={action.disabled}
        onPress={action.run}
        className="items-center rounded-full border border-border px-5 py-3 active:opacity-70"
      >
        <Text
          className={cn(
            "text-sm font-ryco-bold",
            action.disabled ? "text-foreground-muted" : "text-foreground",
          )}
        >
          {action.label}
        </Text>
      </Pressable>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: action.disabled }}
      disabled={action.disabled}
      onPress={action.run}
      className={cn(
        "items-center rounded-full px-5 py-3.5 active:opacity-80",
        action.disabled ? "bg-subtle-strong" : action.destructive ? "bg-danger" : "bg-primary",
      )}
    >
      <Text
        className={cn(
          "text-base font-ryco-bold",
          action.disabled
            ? "text-foreground-muted"
            : action.destructive
              ? "text-danger-foreground"
              : "text-primary-foreground",
        )}
      >
        {action.label}
      </Text>
    </Pressable>
  );
}

export function HostedAccountPrompt(props: { readonly view: HostedAccountPromptView | null }) {
  const { view } = props;
  const warningColor = useThemeColor("--color-warning");

  return (
    <Modal
      visible={view !== null}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={() => view?.dismiss.run()}
    >
      {view === null ? null : (
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          className="flex-1 items-center justify-center bg-backdrop px-5"
        >
          <View className="max-h-[86%] w-full overflow-hidden rounded-[24px] bg-card">
            <ScrollView
              contentContainerStyle={{ padding: 20 }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <Text className="text-xl font-ryco-bold text-foreground">{view.title}</Text>
              <Text className="mt-2 font-sans text-sm leading-relaxed text-foreground-muted">
                {view.message}
              </Text>

              {view.notice ? (
                <View className="mt-3.5 flex-row items-start gap-2.5 rounded-2xl border border-warning-border bg-warning-bg p-3.5">
                  <View className="pt-0.5">
                    <SymbolView
                      name="exclamationmark.triangle"
                      size={15}
                      tintColor={warningColor}
                      type="monochrome"
                    />
                  </View>
                  <Text className="flex-1 font-sans text-xs leading-relaxed text-foreground">
                    {view.notice}
                  </Text>
                </View>
              ) : null}

              {view.enrollment ? <HostedTotpEnrollmentCard enrollment={view.enrollment} /> : null}

              {view.fields.map((field) => (
                <View key={field.key} className="mt-4">
                  <Text className="text-xs font-ryco-medium text-foreground-muted">
                    {field.label}
                  </Text>
                  <AppTextInput
                    className="mt-1.5"
                    accessibilityLabel={field.label}
                    value={field.value}
                    onChangeText={field.onChangeText}
                    placeholder={field.placeholder}
                    secureTextEntry={field.secureTextEntry}
                    keyboardType={field.keyboardType}
                    autoCapitalize={field.autoCapitalize}
                    autoCorrect={false}
                    maxLength={field.maxLength}
                    editable={!view.busy}
                  />
                </View>
              ))}

              {view.errorMessage ? (
                <View className="mt-4">
                  <ErrorBanner message={view.errorMessage} />
                </View>
              ) : null}

              {view.busy ? (
                <View className="mt-5 items-center">
                  <ActivityIndicator />
                </View>
              ) : null}

              <View className="mt-6 gap-2.5">
                {view.submit ? <PromptButton action={view.submit} variant="primary" /> : null}
                {view.cancel ? <PromptButton action={view.cancel} variant="quiet" /> : null}
                <PromptButton action={view.dismiss} variant="quiet" />
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      )}
    </Modal>
  );
}
