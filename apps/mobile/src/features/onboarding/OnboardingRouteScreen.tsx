import { StackActions, useNavigation } from "@react-navigation/native";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";

import { AppText as Text } from "../../components/AppText";
import { showConfirmDialog } from "../../components/ConfirmDialogHost";
import { ErrorBanner } from "../../components/ErrorBanner";
import { cn } from "../../lib/cn";
import { useThemeColor } from "../../lib/useThemeColor";
import { createHubCapabilityClient } from "../../hostedHub/hubCapability";
import {
  createHubProfile,
  hydrateMobileHubProfile,
  readCachedMobileHubProfile,
  type HubProfile,
} from "../../hostedHub/hubProfile";
import {
  createHubProfileEditor,
  hubProfileEditorFailureText,
} from "../../hostedHub/hubProfileEditor";
import { createMobileHubProfileReplacementService } from "../../hostedHub/mobileHubProfileReplacement";
import {
  ensureMobileHostedSession,
  hostedHubController,
  useHostedHubStore,
} from "../../hostedHub/state";
import { isMobileDevelopmentBuild, readMobileHostedConfig } from "../../platform/config";
import { createMobileHttpClient } from "../../platform/httpClient";
import { mobileKV } from "../../platform/kv";
import { useMobileE2eeChannelStatus } from "../e2ee/useMobileE2eeSession";
import { deriveHubNodeSectionModel, HubNodeSectionView } from "../hostedHub/HubNodeSection";
import { HostedRecoveryCodes } from "../hostedHub/HostedRecoveryCodes";
import { useHostedModeAvailable } from "../hostedHub/useHostedMode";
import { mobileNativeAuthorizationPhaseStore } from "./nativeAuthorizationState";
import {
  deriveOnboardingView,
  initialHubOrigin,
  type HubSetupStatus,
  type OnboardingAccountIntent,
  type OnboardingAction,
  type OnboardingActionId,
  type OnboardingCompletionStatus,
  type PublicSignupStatus,
} from "./onboardingModel";
import { saveOnboardingProgress } from "./onboardingProgress";
import {
  createPublicSignupCapabilityClient,
  createPublicSignupCapabilityProbe,
} from "./publicSignupCapability";

type CompletionDestination = "inbox" | "nodes" | "pair-device";

function OnboardingButton(props: {
  readonly action: OnboardingAction;
  readonly primary: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.action.accessibilityLabel}
      accessibilityState={{ disabled: props.action.disabled }}
      disabled={props.action.disabled}
      onPress={props.onPress}
      className={cn(
        "mx-5 mt-3 min-h-12 items-center justify-center rounded-full border px-5 py-3 active:opacity-75",
        props.primary ? "border-primary bg-primary" : "border-border bg-card",
        props.action.disabled && "opacity-40",
      )}
    >
      <Text
        className={cn(
          "text-base font-ryco-bold",
          props.primary ? "text-primary-foreground" : "text-foreground",
        )}
      >
        {props.action.label}
      </Text>
    </Pressable>
  );
}

function HubIdentityCard(props: { readonly profile: HubProfile }) {
  return (
    <View className="mx-5 mt-5 rounded-2xl border border-border bg-card px-4 py-4">
      <Text className="font-ryco-bold text-foreground">{props.profile.label}</Text>
      <Text className="mt-1 font-mono text-xs text-foreground-muted" numberOfLines={1}>
        {props.profile.origin}
      </Text>
    </View>
  );
}

function isPrimaryAction(action: OnboardingAction, signupStatus: PublicSignupStatus): boolean {
  if (action.id === "check-hub" || action.id === "save-hub") return true;
  if (action.id === "create-account") return signupStatus === "enabled";
  if (action.id === "sign-in") return signupStatus !== "enabled";
  return (
    action.id === "retry-authentication" ||
    action.id === "acknowledge-recovery-codes" ||
    action.id === "go-inbox"
  );
}

export function OnboardingRouteScreen() {
  const navigation = useNavigation();
  const placeholderColor = useThemeColor("--color-placeholder");
  const textColor = useThemeColor("--color-foreground");
  const hostedState = useHostedHubStore((state) => state);
  const hostedAvailable = useHostedModeAvailable();
  const e2eeStatus = useMobileE2eeChannelStatus();
  const phase = useSyncExternalStore(
    mobileNativeAuthorizationPhaseStore.subscribe,
    mobileNativeAuthorizationPhaseStore.getSnapshot,
  ).phase;
  const buildConfig = useMemo(readMobileHostedConfig, []);
  const development = isMobileDevelopmentBuild();
  const cachedProfile = readCachedMobileHubProfile();
  const buildProfile = useMemo(
    () =>
      buildConfig
        ? createHubProfile({
            origin: buildConfig.hubOrigin,
            label: "Ryco Hub",
            allowInsecure: development,
          })
        : null,
    [buildConfig, development],
  );
  const [profileReady, setProfileReady] = useState(cachedProfile !== undefined);
  const [storedProfile, setStoredProfile] = useState<HubProfile | null>(cachedProfile ?? null);
  const [hubDraftOrigin, setHubDraftOrigin] = useState(() =>
    initialHubOrigin({
      storedHubOrigin: cachedProfile?.origin ?? null,
      buildDefaultOrigin: buildConfig?.hubOrigin ?? null,
    }),
  );
  const [hubDraftLabel, setHubDraftLabel] = useState(cachedProfile?.label ?? "");
  const [hubEditorActive, setHubEditorActive] = useState(
    cachedProfile?.compatibility.status !== "compatible",
  );
  const [hubSetupStatus, setHubSetupStatus] = useState<HubSetupStatus>("editing");
  const [checkedProfile, setCheckedProfile] = useState<HubProfile | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [signupStatus, setSignupStatus] = useState<PublicSignupStatus>("idle");
  const [accountIntent, setAccountIntent] = useState<OnboardingAccountIntent>(null);
  const [completionStatus, setCompletionStatus] = useState<OnboardingCompletionStatus>("idle");
  const [completionDestination, setCompletionDestination] = useState<CompletionDestination | null>(
    null,
  );
  const [hostedPreparationPending, setHostedPreparationPending] = useState(
    cachedProfile?.compatibility.status === "compatible",
  );
  const draftTouched = useRef(false);

  const httpClient = useMemo(() => createMobileHttpClient(() => null), []);
  const capabilityClient = useMemo(() => createHubCapabilityClient(httpClient), [httpClient]);
  const profileEditor = useMemo(
    () =>
      createHubProfileEditor({
        check: capabilityClient.check,
        allowInsecure: development,
      }),
    [capabilityClient, development],
  );
  const replacementService = useMemo(createMobileHubProfileReplacementService, []);
  const signupClient = useMemo(() => createPublicSignupCapabilityClient(httpClient), [httpClient]);
  const signupProbe = useMemo(
    () => createPublicSignupCapabilityProbe({ check: signupClient.check }),
    [signupClient],
  );

  useEffect(() => {
    let active = true;
    void hydrateMobileHubProfile(mobileKV).then((profile) => {
      if (!active) return;
      setStoredProfile(profile);
      setProfileReady(true);
      if (!draftTouched.current) {
        setHubDraftOrigin(
          initialHubOrigin({
            storedHubOrigin: profile?.origin ?? null,
            buildDefaultOrigin: buildConfig?.hubOrigin ?? null,
          }),
        );
        setHubDraftLabel(profile?.label ?? "");
        setHubEditorActive(profile?.compatibility.status !== "compatible");
      }
    });
    return () => {
      active = false;
    };
  }, [buildConfig]);

  useEffect(() => {
    if (storedProfile?.compatibility.status !== "compatible") {
      setHostedPreparationPending(false);
      return;
    }
    let active = true;
    setHostedPreparationPending(true);
    void ensureMobileHostedSession().finally(() => {
      if (active) setHostedPreparationPending(false);
    });
    return () => {
      active = false;
    };
  }, [storedProfile?.origin, storedProfile?.compatibility.status]);

  const checkSignup = useCallback(
    async (profile: HubProfile) => {
      setSignupStatus("checking");
      const result = await signupProbe.check(profile.origin);
      if (result.status === "stale") return;
      setSignupStatus(result.status);
    },
    [signupProbe],
  );

  useEffect(() => {
    if (storedProfile?.compatibility.status !== "compatible" || hubEditorActive) {
      signupProbe.invalidate();
      setSignupStatus("idle");
      return;
    }
    void checkSignup(storedProfile);
    return () => signupProbe.invalidate();
  }, [checkSignup, hubEditorActive, signupProbe, storedProfile]);

  useEffect(() => {
    if (hostedState.recoveryCodes.length === 0) return;
    return hostedHubController.leaseRecoveryCodeDisplay();
  }, [hostedState.recoveryCodes.length]);

  useEffect(() => {
    if (
      (phase === "opening" || phase === "waiting") &&
      hostedState.accountStatus === "signed-out" &&
      hostedState.errorMessage
    ) {
      mobileNativeAuthorizationPhaseStore.cancelled();
    }
  }, [hostedState.accountStatus, hostedState.errorMessage, phase]);

  useEffect(
    () => () => {
      profileEditor.dispose();
      signupProbe.dispose();
    },
    [profileEditor, signupProbe],
  );

  const checkHub = async () => {
    setHubSetupStatus("checking");
    setCheckedProfile(null);
    setLocalError(null);
    const result = await profileEditor.check({ origin: hubDraftOrigin, label: hubDraftLabel });
    if (result.status === "stale") return;
    if (result.status === "invalid") {
      setHubSetupStatus("invalid");
      setLocalError(hubProfileEditorFailureText(result));
      return;
    }
    if (result.status === "incompatible") {
      setHubSetupStatus(result.reason === "unreachable" ? "unreachable" : "incompatible");
      setLocalError(hubProfileEditorFailureText(result));
      return;
    }
    setCheckedProfile(result.profile);
    setHubSetupStatus("compatible");
  };

  const saveCheckedHub = () => {
    if (checkedProfile === null) return;
    const currentProfile = storedProfile ?? buildProfile;
    const plan = replacementService.plan(currentProfile, checkedProfile);
    const run = async () => {
      setHubSetupStatus("saving");
      setLocalError(null);
      try {
        const result = await replacementService.replace(currentProfile, checkedProfile);
        setStoredProfile(result.profile);
        setHubDraftOrigin(checkedProfile.origin);
        setHubDraftLabel(checkedProfile.label);
        setCheckedProfile(null);
        setHubEditorActive(false);
        setHubSetupStatus("editing");
      } catch {
        setHubSetupStatus("save-failed");
      }
    };
    if (plan === null) {
      void run();
      return;
    }
    showConfirmDialog({
      title: plan.confirmation.title,
      message: plan.confirmation.message,
      confirmText: plan.confirmation.confirmText,
      destructive: true,
      onConfirm: () => void run(),
    });
  };

  const editHub = () => {
    hostedHubController.cancelAuthentication();
    mobileNativeAuthorizationPhaseStore.idle();
    signupProbe.invalidate();
    profileEditor.invalidate();
    setHubDraftOrigin(storedProfile?.origin ?? buildConfig?.hubOrigin ?? "");
    setHubDraftLabel(storedProfile?.label ?? "");
    setCheckedProfile(null);
    setHubSetupStatus("editing");
    setLocalError(null);
    setHubEditorActive(true);
  };

  const startAuthentication = (intent: Exclude<OnboardingAccountIntent, null>) => {
    setAccountIntent(intent);
    setLocalError(null);
    mobileNativeAuthorizationPhaseStore.opening();
    void hostedHubController.signIn();
  };

  const complete = async (destination: CompletionDestination) => {
    setCompletionDestination(destination);
    setCompletionStatus("saving");
    try {
      await saveOnboardingProgress(mobileKV, { version: 1, status: "completed" });
      setCompletionStatus("idle");
      mobileNativeAuthorizationPhaseStore.idle();
      if (destination === "inbox") {
        navigation.dispatch(StackActions.popTo("Home"));
      } else if (destination === "nodes") {
        navigation.dispatch(StackActions.replace("Connections"));
      } else {
        navigation.dispatch(StackActions.replace("ConnectionsNew"));
      }
    } catch {
      setCompletionStatus("error");
    }
  };

  const runAction = (id: OnboardingActionId) => {
    switch (id) {
      case "check-hub":
        void checkHub();
        return;
      case "save-hub":
        saveCheckedHub();
        return;
      case "pair-device":
        void complete("pair-device");
        return;
      case "create-account":
        startAuthentication("create-account");
        return;
      case "sign-in":
        startAuthentication("sign-in");
        return;
      case "retry-signup":
        if (storedProfile) void checkSignup(storedProfile);
        return;
      case "edit-hub":
        editHub();
        return;
      case "cancel-authentication":
        mobileNativeAuthorizationPhaseStore.cancelled();
        hostedHubController.cancelAuthentication();
        return;
      case "retry-authentication":
        startAuthentication(accountIntent ?? "sign-in");
        return;
      case "acknowledge-recovery-codes":
        hostedHubController.dismissRecoveryCodes();
        return;
      case "retry-directory":
        void hostedHubController.refreshDirectory();
        return;
      case "retry-completion":
        if (completionDestination) void complete(completionDestination);
        return;
      case "go-inbox":
        void complete("inbox");
        return;
      case "view-nodes":
        void complete("nodes");
        return;
    }
  };

  const compatibleStoredProfile =
    storedProfile?.compatibility.status === "compatible" ? storedProfile : null;
  const view = deriveOnboardingView({
    startupReady: profileReady,
    storedHub: compatibleStoredProfile
      ? { origin: compatibleStoredProfile.origin, label: compatibleStoredProfile.label }
      : null,
    buildDefaultOrigin: buildConfig?.hubOrigin ?? null,
    hubDraftOrigin,
    hubEditorActive,
    hubSetupStatus,
    hubError: hubSetupStatus === "save-failed" ? "hub-save-failed" : null,
    signupStatus,
    accountIntent,
    hostedAvailable,
    hostedPreparationPending,
    accountStatus: hostedState.accountStatus,
    browserPhase: phase,
    recoveryCodeCount: hostedState.recoveryCodes.length,
    accountDisplayName: hostedState.account?.displayName ?? null,
    directoryStatus:
      hostedState.directoryStatus === "stale" ? "error" : hostedState.directoryStatus,
    authorizedNodeCount: hostedState.nodes.length,
    runtimeErrorMessage: localError ?? hostedState.errorMessage,
    completionStatus,
  });
  const nodeModel =
    view.screen === "connected"
      ? deriveHubNodeSectionModel({
          state: hostedState,
          available: hostedAvailable,
          e2eeStatus,
          actions: hostedHubController,
          onSignIn: () => startAuthentication("sign-in"),
        })
      : null;
  const busy =
    view.screen === "loading" ||
    hubSetupStatus === "checking" ||
    hubSetupStatus === "saving" ||
    phase === "opening" ||
    phase === "waiting" ||
    hostedPreparationPending ||
    completionStatus === "saving";

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      className="flex-1 bg-screen"
    >
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        className="flex-1 bg-screen"
        contentContainerStyle={{ paddingTop: 8, paddingBottom: 44 }}
      >
        <View className="px-5 pb-1 pt-2">
          <Text className="text-xs font-ryco-bold tracking-widest text-foreground-muted">
            RYCO HUB
          </Text>
          <Text className="mt-3 text-3xl font-ryco-bold tracking-tight text-foreground">
            {view.title}
          </Text>
          <Text className="mt-2 font-sans text-sm leading-relaxed text-foreground-muted">
            {view.detail}
          </Text>
        </View>

        {view.screen === "hub-selection" ? (
          <View className="mx-5 mt-5 gap-4">
            <View className="gap-2">
              <Text className="px-1 text-sm font-ryco-medium text-foreground-muted">
                Hub domain
              </Text>
              <TextInput
                accessibilityLabel="Hub domain"
                value={hubDraftOrigin}
                onChangeText={(value) => {
                  draftTouched.current = true;
                  profileEditor.invalidate();
                  setHubDraftOrigin(value);
                  setHubSetupStatus("editing");
                  setCheckedProfile(null);
                  setLocalError(null);
                }}
                placeholder="https://hub.your-domain.com"
                placeholderTextColor={placeholderColor as string}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                returnKeyType="next"
                className="min-h-14 rounded-2xl border border-border bg-card px-4 py-3 font-mono text-sm"
                style={{ color: textColor as string }}
              />
            </View>
            <View className="gap-2">
              <Text className="px-1 text-sm font-ryco-medium text-foreground-muted">
                Hub name (optional)
              </Text>
              <TextInput
                accessibilityLabel="Hub name"
                value={hubDraftLabel}
                onChangeText={(value) => {
                  draftTouched.current = true;
                  profileEditor.invalidate();
                  setHubDraftLabel(value);
                  setHubSetupStatus("editing");
                  setCheckedProfile(null);
                  setLocalError(null);
                }}
                maxLength={64}
                placeholder="Studio Hub"
                placeholderTextColor={placeholderColor as string}
                autoCapitalize="words"
                className="min-h-14 rounded-2xl border border-border bg-card px-4 py-3 font-sans text-base"
                style={{ color: textColor as string }}
              />
            </View>
            {checkedProfile ? (
              <View className="rounded-2xl border border-success-border bg-success-bg p-4">
                <Text className="text-sm font-ryco-bold text-success">Compatible Hub</Text>
                <Text className="mt-1 font-sans text-xs leading-relaxed text-foreground-muted">
                  System-browser handoff v
                  {checkedProfile.compatibility.status === "compatible"
                    ? checkedProfile.compatibility.handoffVersion
                    : 1}{" "}
                  is ready. Saving stores only this bounded public profile.
                </Text>
              </View>
            ) : null}
          </View>
        ) : compatibleStoredProfile && view.screen !== "recovery-codes" ? (
          <HubIdentityCard profile={compatibleStoredProfile} />
        ) : null}

        {view.errorMessage ? (
          <View className="mx-5 mt-4">
            <ErrorBanner message={view.errorMessage} />
          </View>
        ) : null}

        {view.screen === "recovery-codes" ? (
          <HostedRecoveryCodes codes={hostedState.recoveryCodes} />
        ) : null}

        {nodeModel ? <HubNodeSectionView model={nodeModel} /> : null}

        {busy ? (
          <View className="mt-5 items-center" accessibilityLabel="Onboarding in progress">
            <ActivityIndicator />
          </View>
        ) : null}

        <View className="mt-3">
          {view.actions.map((action) => (
            <OnboardingButton
              key={action.id}
              action={action}
              primary={isPrimaryAction(action, signupStatus)}
              onPress={() => runAction(action.id)}
            />
          ))}
        </View>

        {view.screen === "account-choice" ? (
          <Text className="mx-7 mt-5 text-center font-sans text-xs leading-relaxed text-foreground-muted">
            Your Hub browser session stays in the system browser. Ryco receives only a reviewed
            one-time authorization result for this device.
          </Text>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
