import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text, AppTextInput } from "../../components/AppText";
import { ErrorBanner } from "../../components/ErrorBanner";
import {
  checkHubCapabilityWithTimeout,
  createHubCapabilityClient,
  hubCapabilityFailureText,
} from "../../hostedHub/hubCapability";
import {
  createHubProfile,
  HUB_PROFILE_LABEL_MAX_LENGTH,
  normalizeHubOrigin,
  type HubOriginFailureReason,
  type HubProfile,
} from "../../hostedHub/hubProfile";
import { createMobileHttpClient } from "../../platform/httpClient";
import { useThemeColor } from "../../lib/useThemeColor";

function originFailureText(reason: HubOriginFailureReason): string {
  switch (reason) {
    case "required":
      return "Enter the full Hub domain.";
    case "invalid-url":
    case "invalid-host":
      return "Enter a valid absolute Hub URL.";
    case "https-required":
      return "Hub domains must use HTTPS.";
    case "credentials-not-allowed":
      return "The Hub URL cannot contain a username or password.";
    case "origin-only":
      return "Use only the Hub origin, without a path, query, or fragment.";
    case "placeholder-host":
      return "Replace the placeholder with your real Hub domain.";
  }
}

export function HubDomainEditor(props: {
  readonly visible: boolean;
  readonly currentProfile: HubProfile | null;
  readonly buildOrigin: string | null;
  readonly allowInsecure: boolean;
  readonly onDismiss: () => void;
  readonly onSave: (profile: HubProfile) => void;
  readonly onUseBuildDefault: (() => void) | null;
  readonly requireNativeIdentity?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const primaryForegroundColor = useThemeColor("--color-primary-foreground");
  const [origin, setOrigin] = useState("");
  const [label, setLabel] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkedProfile, setCheckedProfile] = useState<HubProfile | null>(null);
  const checkGeneration = useRef(0);
  const capabilityClient = useMemo(
    () => createHubCapabilityClient(createMobileHttpClient(() => null)),
    [],
  );

  useEffect(() => {
    checkGeneration.current += 1;
    if (!props.visible) return;
    setOrigin(props.currentProfile?.origin ?? props.buildOrigin ?? "");
    setLabel(props.currentProfile?.label ?? "");
    setChecking(false);
    setError(null);
    setCheckedProfile(null);
  }, [props.buildOrigin, props.currentProfile, props.visible]);

  const updateOrigin = (value: string) => {
    checkGeneration.current += 1;
    setChecking(false);
    setOrigin(value);
    setCheckedProfile(null);
    setError(null);
  };

  const check = async () => {
    const issued = ++checkGeneration.current;
    setChecking(true);
    setError(null);
    setCheckedProfile(null);
    const normalized = normalizeHubOrigin(origin, { allowInsecure: props.allowInsecure });
    if (!normalized.ok) {
      setError(originFailureText(normalized.reason));
      setChecking(false);
      return;
    }
    try {
      const result = await checkHubCapabilityWithTimeout(capabilityClient, normalized.origin);
      if (issued !== checkGeneration.current) return;
      if (result.status === "incompatible") {
        setError(hubCapabilityFailureText(result.reason));
        return;
      }
      if (props.requireNativeIdentity && result.capability.nativeIdentity === undefined) {
        setError("This Hub does not advertise native account access.");
        return;
      }
      const profile = createHubProfile({
        origin: normalized.origin,
        label: label || result.capability.relyingParty.displayName,
        allowInsecure: props.allowInsecure,
        compatibility: {
          status: "compatible",
          checkedAt: result.checkedAt,
          protocolVersion: result.capability.protocolVersion,
          handoffVersion: result.capability.nativeHandoff.version,
          relyingPartyId: result.capability.relyingParty.id,
        },
      });
      setCheckedProfile(profile);
    } catch {
      if (issued === checkGeneration.current) {
        setError("Ryco could not check this Hub. Try again.");
      }
    } finally {
      if (issued === checkGeneration.current) setChecking(false);
    }
  };

  const dismiss = () => {
    checkGeneration.current += 1;
    setChecking(false);
    props.onDismiss();
  };

  return (
    <Modal
      visible={props.visible}
      animationType="slide"
      presentationStyle={props.requireNativeIdentity ? "fullScreen" : "pageSheet"}
      onRequestClose={dismiss}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1 bg-screen"
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingTop: props.requireNativeIdentity ? insets.top + 8 : 20,
            paddingBottom: props.requireNativeIdentity ? Math.max(40, insets.bottom + 20) : 40,
            gap: 18,
          }}
        >
          <View className="flex-row items-center">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel Hub domain"
              onPress={dismiss}
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
            <AppTextInput
              accessibilityLabel="Hub domain"
              value={origin}
              onChangeText={updateOrigin}
              placeholder="https://hub.your-domain.com"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              className="min-h-14 px-4"
            />
          </View>

          <View className="gap-2">
            <Text className="px-1 text-sm font-ryco-medium text-foreground-muted">
              Name (optional)
            </Text>
            <AppTextInput
              accessibilityLabel="Hub name"
              value={label}
              onChangeText={(value) => {
                checkGeneration.current += 1;
                setChecking(false);
                setLabel(value);
                setCheckedProfile(null);
                setError(null);
              }}
              maxLength={HUB_PROFILE_LABEL_MAX_LENGTH}
              placeholder="Studio Hub"
              autoCapitalize="words"
              className="min-h-14 px-4"
            />
          </View>

          {error ? <ErrorBanner message={error} /> : null}
          {checkedProfile ? (
            <View className="rounded-2xl border border-success-border bg-success-bg p-4">
              <Text className="text-sm font-ryco-bold text-success">Compatible Hub</Text>
              <Text className="mt-1 font-sans text-xs leading-relaxed text-foreground-muted">
                {props.requireNativeIdentity
                  ? "Native account access v2 and handoff v"
                  : "System-browser handoff v"}
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
              if (checkedProfile) {
                checkGeneration.current += 1;
                props.onSave(checkedProfile);
              }
            }}
            className="h-12 items-center justify-center rounded-full border border-border bg-card px-5 active:bg-card-alt disabled:opacity-40"
          >
            <Text className="text-base font-ryco-bold text-foreground">Save Hub</Text>
          </Pressable>

          {props.onUseBuildDefault ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Use build default Hub"
              onPress={() => {
                checkGeneration.current += 1;
                setChecking(false);
                props.onUseBuildDefault?.();
              }}
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
