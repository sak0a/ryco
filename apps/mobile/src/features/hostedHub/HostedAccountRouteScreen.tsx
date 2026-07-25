import { useNavigation } from "@react-navigation/native";
import { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { showConfirmDialog } from "../../components/ConfirmDialogHost";
import { EmptyState } from "../../components/EmptyState";
import { ErrorBanner } from "../../components/ErrorBanner";
import {
  hostedAccountStore,
  hostedHubController,
  useHostedAccountStore,
  useHostedHubStore,
} from "../../hostedHub/state";
import { SettingsRow } from "../settings/components/SettingsRow";
import { SettingsSection } from "../settings/components/SettingsSection";
import {
  deriveHostedAccountManagementView,
  type HostedAccountPromptDraft,
} from "./hostedAccountModel";
import { HostedAccountPrompt } from "./HostedAccountPrompt";
import { deriveHostedAccountView, type HostedAccountRow } from "./hostedAuthModel";
import { HostedPasskeyList } from "./HostedPasskeyList";
import { HostedRecoveryCodes } from "./HostedRecoveryCodes";
import {
  HostedCapabilityNotice,
  HostedDeliveryUnknownNotice,
  HostedPrimaryButton,
  HostedStatusRow,
} from "./HostedSurfaceParts";
import { useHostedModeAvailable } from "./useHostedMode";

/**
 * The hosted account surface, nested inside the Settings sheet.
 *
 * Reachable only when hosted mode is available — `SettingsRouteScreen` does not
 * render its row otherwise, and this screen still fails closed on its own so a
 * deep link cannot land on a hosted surface a direct-only build cannot serve.
 *
 * Every credential action below is a native, DPoP-bound controller call.
 * Nothing on this screen opens a browser: `/api/account/*` authorizes an
 * `Authorization: DPoP` request without a same-origin check, so the webview is
 * needed only for the no-passkey *login* fallback on the sign-in sheet.
 */
export function HostedAccountRouteScreen() {
  const navigation = useNavigation();
  const hostedModeAvailable = useHostedModeAvailable();
  const state = useHostedHubStore((value) => value);
  const accountState = useHostedAccountStore((value) => value);
  const [draft, setDraft] = useState<HostedAccountPromptDraft | null>(null);

  const signedIn = state.accountStatus === "authenticated";

  // A read, not a mutation: `refreshPasskeys` deduplicates, no-ops while signed
  // out, and touches nothing. Regenerating recovery codes deliberately has no
  // equivalent here — that rotates, so it only ever runs from an explicit,
  // confirmed submit.
  useEffect(() => {
    if (!hostedModeAvailable || !signedIn) return;
    void hostedHubController.refreshPasskeys();
  }, [hostedModeAvailable, signedIn]);

  // Leaving the screen must not leave the account's shared TOTP key in the
  // runtime's transient slot. The prompt's own close path drops it; this covers
  // a back-swipe, a sheet dismissal, and a sign-out that unmounts underneath.
  useEffect(
    () => () => {
      hostedHubController.dismissTotpEnrollment();
    },
    [],
  );

  const view = deriveHostedAccountView({
    state,
    hostedModeAvailable,
    onSignIn: () => navigation.navigate("Onboarding"),
  });

  const management = deriveHostedAccountManagementView({
    state,
    accountState,
    draft,
    actions: hostedHubController,
    // Read through the store rather than the subscribed snapshot: a submit
    // needs the state as it is *after* its own action settled, and the value
    // captured at render time is by definition the one from before.
    readAccountState: () => hostedAccountStore.getState(),
    onDraftChange: setDraft,
  });

  const runRow = (row: HostedAccountRow) => {
    if (!row.confirm) {
      row.run();
      return;
    }
    showConfirmDialog({
      title: row.confirm.title,
      message: row.confirm.message,
      confirmText: row.confirm.confirmText,
      destructive: row.confirm.destructive,
      onConfirm: row.run,
    });
  };

  return (
    <>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        className="flex-1 bg-screen"
        contentContainerStyle={{ paddingVertical: 12, paddingBottom: 40 }}
      >
        {!view.available ? (
          <View className="px-5 py-16">
            <EmptyState variant="plain" title={view.title} detail={view.detail} />
          </View>
        ) : (
          <>
            <View className="px-5 pb-1 pt-2">
              <Text className="text-2xl font-ryco-bold text-foreground">{view.title}</Text>
              <Text className="mt-2 font-sans text-sm leading-relaxed text-foreground-muted">
                {view.detail}
              </Text>
              {view.statusIndicator ? (
                <View className="mt-3.5">
                  <HostedStatusRow indicator={view.statusIndicator} roleLabel={view.roleLabel} />
                </View>
              ) : null}
            </View>

            {view.errorMessage ? (
              <View className="mx-5 mt-4">
                <ErrorBanner message={view.errorMessage} />
              </View>
            ) : null}

            {management.errorMessage ? (
              <View className="mx-5 mt-4">
                <ErrorBanner message={management.errorMessage} />
              </View>
            ) : null}

            {view.deliveryUnknown ? (
              <HostedDeliveryUnknownNotice view={view.deliveryUnknown} />
            ) : null}

            {view.capabilityNotice ? (
              <HostedCapabilityNotice reason={view.capabilityNotice} />
            ) : null}

            <HostedRecoveryCodes codes={view.recoveryCodes} />
            {view.dismissRecoveryCodes ? (
              <HostedPrimaryButton action={view.dismissRecoveryCodes} />
            ) : null}

            {view.signInAction ? <HostedPrimaryButton action={view.signInAction} /> : null}

            {management.available
              ? management.sections.map((section) => (
                  <View key={section.id}>
                    <SettingsSection title={section.title}>
                      {section.id === "passkeys" ? (
                        <HostedPasskeyList
                          rows={management.passkeyRows}
                          emptyDetail={management.passkeysEmptyDetail}
                        />
                      ) : null}
                      {section.rows.map((row, index) => (
                        <SettingsRow
                          key={row.id}
                          // The passkey list occupies the top of its own card,
                          // so the action beneath it always keeps a separator.
                          first={section.id !== "passkeys" && index === 0}
                          label={row.label}
                          destructive={row.destructive}
                          disabled={row.disabled}
                          onPress={row.run}
                        />
                      ))}
                    </SettingsSection>
                    <Text className="mt-2 px-5 font-sans text-xs leading-relaxed text-foreground-muted">
                      {section.footnote}
                    </Text>
                  </View>
                ))
              : null}

            {view.rows.length > 0 ? (
              <SettingsSection title="This device">
                {view.rows.map((row, index) => (
                  <SettingsRow
                    key={row.id}
                    first={index === 0}
                    label={row.label}
                    {...(row.value === null ? {} : { value: row.value })}
                    destructive={row.destructive}
                    onPress={() => runRow(row)}
                  />
                ))}
              </SettingsSection>
            ) : null}
          </>
        )}
      </ScrollView>

      <HostedAccountPrompt view={management.prompt} />
    </>
  );
}
