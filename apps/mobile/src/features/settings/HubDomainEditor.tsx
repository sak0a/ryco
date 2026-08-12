import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";

import { AppText as Text } from "../../components/AppText";
import { ErrorBanner } from "../../components/ErrorBanner";
import { createHubCapabilityClient } from "../../hostedHub/hubCapability";
import { HUB_PROFILE_LABEL_MAX_LENGTH, type HubProfile } from "../../hostedHub/hubProfile";
import {
  createHubProfileEditor,
  hubProfileEditorFailureText,
} from "../../hostedHub/hubProfileEditor";
import { createMobileHttpClient } from "../../platform/httpClient";
import { useThemeColor } from "../../lib/useThemeColor";

export function HubDomainEditor(props: {
  readonly visible: boolean;
  readonly currentProfile: HubProfile | null;
  readonly buildOrigin: string | null;
  readonly allowInsecure: boolean;
  readonly onDismiss: () => void;
  readonly onSave: (profile: HubProfile) => void;
  readonly onUseBuildDefault: (() => void) | null;
}) {
  const placeholderColor = useThemeColor("--color-placeholder");
  const textColor = useThemeColor("--color-foreground");
  const primaryForegroundColor = useThemeColor("--color-primary-foreground");
  const [origin, setOrigin] = useState("");
  const [label, setLabel] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkedProfile, setCheckedProfile] = useState<HubProfile | null>(null);
  const capabilityClient = useMemo(
    () => createHubCapabilityClient(createMobileHttpClient(() => null)),
    [],
  );
  const profileEditor = useMemo(
    () =>
      createHubProfileEditor({
        check: capabilityClient.check,
        allowInsecure: props.allowInsecure,
      }),
    [capabilityClient, props.allowInsecure],
  );

  useEffect(() => {
    profileEditor.invalidate();
    if (!props.visible) return;
    setOrigin(props.currentProfile?.origin ?? props.buildOrigin ?? "");
    setLabel(props.currentProfile?.label ?? "");
    setChecking(false);
    setError(null);
    setCheckedProfile(null);
  }, [profileEditor, props.buildOrigin, props.currentProfile, props.visible]);

  useEffect(() => () => profileEditor.dispose(), [profileEditor]);

  const updateOrigin = (value: string) => {
    profileEditor.invalidate();
    setOrigin(value);
    setChecking(false);
    setCheckedProfile(null);
    setError(null);
  };

  const check = async () => {
    setChecking(true);
    setError(null);
    setCheckedProfile(null);
    const result = await profileEditor.check({ origin, label });
    if (result.status === "stale") return;
    if (result.status === "invalid" || result.status === "incompatible") {
      setError(hubProfileEditorFailureText(result));
      setChecking(false);
      return;
    }
    setCheckedProfile(result.profile);
    setChecking(false);
  };

  return (
    <Modal
      visible={props.visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={props.onDismiss}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1 bg-screen"
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 18 }}
        >
          <View className="flex-row items-center">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel Hub domain"
              onPress={props.onDismiss}
              className="h-11 min-w-16 items-center justify-center rounded-full active:bg-subtle"
            >
              <Text className="text-base font-ryco-medium text-foreground">Cancel</Text>
            </Pressable>
            <Text className="flex-1 text-center text-lg font-ryco-bold text-foreground">
              Hub domain
            </Text>
            <View className="h-11 min-w-16" />
          </View>

          <Text className="font-sans text-sm leading-relaxed text-foreground-muted">
            Enter the public origin of one Ryco Hub. Ryco checks its bounded mobile capability
            document before saving it. Credentials are never stored in this profile.
          </Text>

          <View className="gap-2">
            <Text className="px-1 text-sm font-ryco-medium text-foreground-muted">Domain</Text>
            <TextInput
              accessibilityLabel="Hub domain"
              value={origin}
              onChangeText={updateOrigin}
              placeholder="https://hub.your-domain.com"
              placeholderTextColor={placeholderColor as string}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              className="min-h-14 rounded-2xl border border-border bg-card px-4 py-3 font-mono text-sm"
              style={{ color: textColor as string }}
            />
          </View>

          <View className="gap-2">
            <Text className="px-1 text-sm font-ryco-medium text-foreground-muted">
              Name (optional)
            </Text>
            <TextInput
              accessibilityLabel="Hub name"
              value={label}
              onChangeText={(value) => {
                profileEditor.invalidate();
                setLabel(value);
                setChecking(false);
                setCheckedProfile(null);
                setError(null);
              }}
              maxLength={HUB_PROFILE_LABEL_MAX_LENGTH}
              placeholder="Studio Hub"
              placeholderTextColor={placeholderColor as string}
              autoCapitalize="words"
              className="min-h-14 rounded-2xl border border-border bg-card px-4 py-3 font-sans text-base"
              style={{ color: textColor as string }}
            />
          </View>

          {error ? <ErrorBanner message={error} /> : null}
          {checkedProfile ? (
            <View className="rounded-2xl border border-success-border bg-success-bg p-4">
              <Text className="text-sm font-ryco-bold text-success">Compatible Hub</Text>
              <Text className="mt-1 font-sans text-xs leading-relaxed text-foreground-muted">
                System-browser handoff v
                {checkedProfile.compatibility.status === "compatible"
                  ? checkedProfile.compatibility.handoffVersion
                  : 1}{" "}
                is advertised. Saving the profile does not store a session or handoff secret.
              </Text>
            </View>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Check Hub compatibility"
            disabled={checking}
            onPress={() => void check()}
            className="h-12 items-center justify-center rounded-full bg-primary px-5 active:opacity-80 disabled:opacity-40"
          >
            {checking ? (
              <ActivityIndicator color={primaryForegroundColor as string} />
            ) : (
              <Text className="text-base font-ryco-bold text-primary-foreground">
                Check compatibility
              </Text>
            )}
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Save Hub profile"
            disabled={!checkedProfile || checking}
            onPress={() => {
              if (checkedProfile) props.onSave(checkedProfile);
            }}
            className="h-12 items-center justify-center rounded-full border border-border bg-card px-5 active:bg-card-alt disabled:opacity-40"
          >
            <Text className="text-base font-ryco-bold text-foreground">Save Hub</Text>
          </Pressable>

          {props.onUseBuildDefault ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Use build default Hub"
              onPress={props.onUseBuildDefault}
              className="h-11 items-center justify-center rounded-full active:bg-subtle"
            >
              <Text className="text-sm font-ryco-bold text-foreground-muted">
                Use build default
              </Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}
