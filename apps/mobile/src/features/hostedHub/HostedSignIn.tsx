import { useNavigation } from "@react-navigation/native";
import { ActivityIndicator, ScrollView, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { ErrorBanner } from "../../components/ErrorBanner";
import { useHostedHubStore } from "../../hostedHub/state";
import { deriveHostedSignInView } from "./hostedAuthModel";
import { HostedRecoveryCodes } from "./HostedRecoveryCodes";
import {
  HostedDeliveryUnknownNotice,
  HostedPrimaryButton,
  HostedSecondaryButton,
  HostedStatusRow,
} from "./HostedSurfaceParts";
import { useHostedModeAvailable } from "./useHostedMode";

/**
 * The hosted sign-in sheet — the whole hosted authentication surface, rendered
 * inside the existing `Onboarding` form sheet.
 *
 * Every state it can be in, the copy for each, and the controller call behind
 * every affordance live in `hostedAuthModel.ts` and are asserted there. This
 * file is presentation: it reads the store, hands the snapshot to the
 * derivation, and lays the result out.
 *
 * There is deliberately no owner-bootstrap or invitation form here. Those
 * registrations are browser-transport-only on the Hub — a native socket cannot
 * satisfy the browser `Origin`/`Sec-Fetch-Site` conditions they require — so
 * the first-run state routes through the reviewed system-browser handoff and
 * comes back with a one-time PKCE code. Sign-in and recovery-code display are
 * the whole native surface.
 */
export function HostedSignIn() {
  const navigation = useNavigation();
  const hostedModeAvailable = useHostedModeAvailable();
  const state = useHostedHubStore((value) => value);

  const view = deriveHostedSignInView({
    state,
    hostedModeAvailable,
    // The direct plane is always reachable, hosted mode or not: pairing a node
    // over the local network is a different plane with its own transport.
    onPairDevice: () => navigation.navigate("ConnectionsNew"),
    onDone: () => navigation.goBack(),
  });

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      className="flex-1 bg-screen"
      contentContainerStyle={{ paddingVertical: 12 }}
    >
      <View className="px-5 pb-1 pt-2">
        <Text className="text-2xl font-ryco-bold text-foreground">{view.title}</Text>
        <Text className="mt-2 font-sans text-sm leading-relaxed text-foreground-muted">
          {view.detail}
        </Text>
        {view.statusIndicator ? (
          <View className="mt-3.5">
            <HostedStatusRow indicator={view.statusIndicator} />
          </View>
        ) : null}
      </View>

      {view.busy ? (
        <View className="mt-5 items-center">
          <ActivityIndicator />
        </View>
      ) : null}

      {view.errorMessage ? (
        <View className="mx-5 mt-4">
          <ErrorBanner message={view.errorMessage} />
        </View>
      ) : null}

      {view.deliveryUnknown ? <HostedDeliveryUnknownNotice view={view.deliveryUnknown} /> : null}

      <HostedRecoveryCodes codes={view.recoveryCodes} />

      {view.primaryAction ? <HostedPrimaryButton action={view.primaryAction} /> : null}
      {view.secondaryAction ? <HostedSecondaryButton action={view.secondaryAction} /> : null}
    </ScrollView>
  );
}
