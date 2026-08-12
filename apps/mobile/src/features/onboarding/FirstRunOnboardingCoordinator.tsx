import { useNavigation, type NavigationState } from "@react-navigation/native";
import * as Linking from "expo-linking";
import { useEffect, useRef, useState } from "react";

import { hydrateMobileHubProfile } from "../../hostedHub/hubProfile";
import { ensureMobileHostedSession, hostedHubStore } from "../../hostedHub/state";
import { mobileKV } from "../../platform/kv";
import { useSavedEnvironmentCatalog } from "../../providers/ConnectionRegistryProvider";
import {
  deriveFirstRunLaunchDisposition,
  hasActionableInitialDeepLink,
  resolveFirstRunStartup,
  type FirstRunLaunchDisposition,
} from "./firstRunCoordinatorModel";
import {
  hydrateOnboardingProgress,
  saveOnboardingProgress,
  type OnboardingProgressStatus,
} from "./onboardingProgress";

/**
 * Owns the one automatic presentation decision for a process launch.
 *
 * It renders nothing and never changes an active deep-linked route. All inputs
 * are hydrated before the decision so an existing user cannot see a transient
 * first-run sheet while their saved catalog or Hub session is still loading.
 */
export function FirstRunOnboardingCoordinator(props: {
  readonly navigationState: NavigationState;
}) {
  const navigation = useNavigation();
  const catalog = useSavedEnvironmentCatalog();
  const [status, setStatus] = useState<OnboardingProgressStatus | null>(null);
  const [hasInitialDeepLink, setHasInitialDeepLink] = useState<boolean | null>(null);
  const launchDisposition = useRef<FirstRunLaunchDisposition | null>(null);
  const presentationRequested = useRef(false);

  useEffect(() => {
    let active = true;
    void Promise.all([
      hydrateOnboardingProgress(mobileKV),
      hydrateMobileHubProfile(mobileKV),
      catalog.waitForHydration().then(() => catalog.list().length),
      ensureMobileHostedSession(),
      Linking.getInitialURL(),
    ]).then(async ([progress, profile, directEnvironmentCount, _session, initialUrl]) => {
      const startup = resolveFirstRunStartup({
        progress,
        hasStoredHub: profile !== null,
        directEnvironmentCount,
        hostedAuthenticated: hostedHubStore.getState().accountStatus === "authenticated",
      });
      if (startup.persist) {
        try {
          await saveOnboardingProgress(mobileKV, { version: 1, status: startup.status });
        } catch {
          // The in-memory decision remains safe: existing users are not
          // interrupted, and a fresh install retries persistence on completion.
        }
      }
      if (active) {
        setHasInitialDeepLink(hasActionableInitialDeepLink(initialUrl));
        setStatus(startup.status);
      }
    });
    return () => {
      active = false;
    };
  }, [catalog]);

  useEffect(() => {
    if (status === null || hasInitialDeepLink === null || launchDisposition.current !== null)
      return;
    const disposition = deriveFirstRunLaunchDisposition({
      status,
      routeNames: props.navigationState.routes.map((route) => route.name),
      presentationRequested: presentationRequested.current,
      hasInitialDeepLink,
    });
    launchDisposition.current = disposition;
    if (disposition !== "present") return;
    presentationRequested.current = true;
    navigation.navigate("Onboarding");
  }, [hasInitialDeepLink, navigation, props.navigationState, status]);

  return null;
}
