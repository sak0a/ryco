import { useNavigation } from "@react-navigation/native";
import { ScrollView, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { showConfirmDialog } from "../../components/ConfirmDialogHost";
import { EmptyState } from "../../components/EmptyState";
import { ErrorBanner } from "../../components/ErrorBanner";
import { useHostedHubStore } from "../../hostedHub/state";
import { SettingsRow } from "../settings/components/SettingsRow";
import { SettingsSection } from "../settings/components/SettingsSection";
import { deriveHostedAccountView, type HostedAccountRow } from "./hostedAuthModel";
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
 */
export function HostedAccountRouteScreen() {
  const navigation = useNavigation();
  const hostedModeAvailable = useHostedModeAvailable();
  const state = useHostedHubStore((value) => value);

  const view = deriveHostedAccountView({
    state,
    hostedModeAvailable,
    onSignIn: () => navigation.navigate("Onboarding"),
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
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      className="flex-1 bg-screen"
      contentContainerStyle={{ paddingVertical: 12 }}
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

          {view.deliveryUnknown ? (
            <HostedDeliveryUnknownNotice view={view.deliveryUnknown} />
          ) : null}

          {view.capabilityNotice ? <HostedCapabilityNotice reason={view.capabilityNotice} /> : null}

          <HostedRecoveryCodes codes={view.recoveryCodes} />

          {view.signInAction ? <HostedPrimaryButton action={view.signInAction} /> : null}

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
  );
}
