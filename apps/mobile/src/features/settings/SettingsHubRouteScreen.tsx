import { useNavigation } from "@react-navigation/native";
import { useEffect, useMemo, useState } from "react";
import { ScrollView, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { showConfirmDialog } from "../../components/ConfirmDialogHost";
import { ErrorBanner } from "../../components/ErrorBanner";
import {
  buildHubDomainResetPlan,
  clearMobileHubProfile,
  createHubProfile,
  executeHubDomainResetPlan,
  hydrateMobileHubProfile,
  readCachedMobileHubProfile,
  saveMobileHubProfile,
  type HubProfile,
} from "../../hostedHub/hubProfile";
import {
  ensureMobileHostedSession,
  hostedHubController,
  hostedHubStore,
  isMobileHostedModeAvailable,
} from "../../hostedHub/state";
import { invalidateMobileHostedRuntime } from "../../hostedHub/runtime";
import { isMobileDevelopmentBuild, readMobileHostedConfig } from "../../platform/config";
import { mobileKV } from "../../platform/kv";
import { useHostedModeAvailable } from "../hostedHub/useHostedMode";
import { SettingsRow } from "./components/SettingsRow";
import { SettingsSection } from "./components/SettingsSection";
import { HubDomainEditor } from "./HubDomainEditor";

function compatibilityLabel(profile: HubProfile | null, usesBuildDefault: boolean): string {
  if (profile?.compatibility.status === "compatible") return "Compatible";
  if (profile?.compatibility.status === "incompatible") return "Needs attention";
  return usesBuildDefault ? "Build configured" : "Not checked";
}

function accountLabel(
  profile: HubProfile | null,
  usesBuildRuntime: boolean,
  hostedAvailable: boolean,
): string | undefined {
  if (profile === null) return "Not configured";
  if (!usesBuildRuntime) return "Browser handoff pending";
  return hostedAvailable ? undefined : "Unavailable";
}

export function SettingsHubRouteScreen() {
  const navigation = useNavigation();
  const hostedAvailable = useHostedModeAvailable();
  const buildConfig = useMemo(readMobileHostedConfig, []);
  const development = isMobileDevelopmentBuild();
  const [storedProfile, setStoredProfile] = useState<HubProfile | null>(
    () => readCachedMobileHubProfile() ?? null,
  );
  const [editorVisible, setEditorVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootNavigation = navigation.getParent();

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
  const profile = storedProfile ?? buildProfile;
  const usesBuildRuntime =
    buildConfig !== null &&
    (storedProfile === null || storedProfile.origin === buildConfig.hubOrigin);

  useEffect(() => {
    let active = true;
    void hydrateMobileHubProfile(mobileKV).then((next) => {
      if (active) setStoredProfile(next);
    });
    return () => {
      active = false;
    };
  }, []);

  const persistReplacement = async (nextProfile: HubProfile | null) => {
    if (nextProfile) await saveMobileHubProfile(mobileKV, nextProfile);
    else await clearMobileHubProfile(mobileKV);
    setStoredProfile(nextProfile);
    invalidateMobileHostedRuntime();
    if (
      nextProfile === null ||
      (buildConfig !== null && nextProfile.origin === buildConfig.hubOrigin)
    ) {
      void ensureMobileHostedSession();
    }
  };

  const replaceProfile = (nextProfile: HubProfile | null) => {
    const plan = buildHubDomainResetPlan(profile?.origin ?? null, nextProfile?.origin ?? null);
    const run = async () => {
      setBusy(true);
      setError(null);
      try {
        if (!plan) {
          await persistReplacement(nextProfile);
        } else {
          await executeHubDomainResetPlan(plan, {
            attemptRemoteSignOut: async () => {
              if (
                !isMobileHostedModeAvailable() ||
                hostedHubStore.getState().accountStatus !== "authenticated"
              ) {
                return;
              }
              await hostedHubController.signOut();
              if (hostedHubStore.getState().accountStatus === "authenticated") {
                throw new Error("remote sign-out unavailable");
              }
            },
            clearLocalHubState: async () => {
              if (
                isMobileHostedModeAvailable() &&
                hostedHubStore.getState().accountStatus !== "signed-out"
              ) {
                await hostedHubController.expireSession();
              }
            },
            replaceProfile: () => persistReplacement(nextProfile),
          });
        }
        setEditorVisible(false);
      } catch {
        setError("Ryco could not change the Hub safely. The current profile remains active.");
      } finally {
        setBusy(false);
      }
    };

    if (!plan) {
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

  return (
    <>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        className="flex-1 bg-screen"
        contentContainerStyle={{ paddingTop: 4, paddingBottom: 40 }}
      >
        {error ? (
          <View className="mx-5 mt-4">
            <ErrorBanner message={error} />
          </View>
        ) : null}

        <SettingsSection title="Hub">
          <SettingsRow
            first
            label="Domain"
            value={profile?.origin ?? "Not configured"}
            disabled={busy}
            onPress={development ? () => setEditorVisible(true) : undefined}
          />
          <SettingsRow
            label="Compatibility"
            value={compatibilityLabel(profile, storedProfile === null && buildConfig !== null)}
          />
          <SettingsRow
            label="Nodes"
            value="Hub relay and direct"
            onPress={() => rootNavigation?.navigate("Connections" as never)}
          />
        </SettingsSection>

        {!development ? (
          <Text className="mt-2 px-5 font-sans text-xs leading-relaxed text-foreground-muted">
            Custom Hub editing is development-gated until the public system-browser handoff is
            available on a compatible Hub.
          </Text>
        ) : null}

        <SettingsSection title="Account and security">
          <SettingsRow
            first
            label="Account"
            value={accountLabel(profile, usesBuildRuntime, hostedAvailable)}
            disabled={!usesBuildRuntime || !hostedAvailable || busy}
            onPress={() => navigation.navigate("SettingsAccount" as never)}
          />
        </SettingsSection>

        {!usesBuildRuntime && profile?.compatibility.status === "compatible" ? (
          <Text className="mt-2 px-5 font-sans text-xs leading-relaxed text-foreground-muted">
            This self-hosted profile is compatible, but native browser handoff remains unavailable
            until the separately reviewed Hub endpoint is deployed. Direct nodes keep working.
          </Text>
        ) : null}
      </ScrollView>

      <HubDomainEditor
        visible={editorVisible}
        currentProfile={profile}
        buildOrigin={buildConfig?.hubOrigin ?? null}
        allowInsecure={development}
        onDismiss={() => setEditorVisible(false)}
        onSave={replaceProfile}
        onUseBuildDefault={storedProfile && buildConfig ? () => replaceProfile(null) : null}
      />
    </>
  );
}
