import { createStaticNavigation } from "@react-navigation/native";
import {
  createNativeStackNavigator,
  createNativeStackScreen,
} from "@react-navigation/native-stack";
import { Image } from "expo-image";
import * as Linking from "expo-linking";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";

import { ConnectionsNewRouteScreen } from "../connection/ConnectionsNewRouteScreen";
import { NativeIdentityScreen } from "../identity/NativeIdentityScreen";
import { useHostedHubStore, ensureMobileHostedSession } from "../../hostedHub/state";
import { useThemeColor } from "../../lib/useThemeColor";
import { useConnectionRegistry } from "../../providers/ConnectionRegistryProvider";
import { RootStack } from "../../Stack";
import { ServerStateBootstrap } from "../../state/serverStateSync";
import { deriveAppAccess, isWorkspaceDeepLink } from "./appAccessModel";

const logo = require("../../../../../assets/logo_letter_only.svg");

const LockedStack = createNativeStackNavigator({
  initialRouteName: "Access",
  screenOptions: { headerShown: false },
  screens: {
    Access: createNativeStackScreen({ screen: NativeIdentityScreen }),
    ConnectionsNew: createNativeStackScreen({
      screen: ConnectionsNewRouteScreen,
      options: { headerShown: true, title: "Pair a device", gestureEnabled: true },
    }),
  },
});

const LockedNavigation = createStaticNavigation(LockedStack);
const WorkspaceNavigation = createStaticNavigation(RootStack);

function LaunchSurface() {
  const foreground = useThemeColor("--color-foreground");
  return (
    <View className="flex-1 items-center justify-center bg-screen">
      <Image
        source={logo}
        contentFit="contain"
        tintColor={foreground as string}
        accessibilityLabel="Ryco is loading"
        style={{ width: 128, height: 128 }}
      />
    </View>
  );
}

export function AppAccessGate(props: {
  readonly linking: Parameters<typeof WorkspaceNavigation>[0]["linking"];
  readonly theme: Parameters<typeof WorkspaceNavigation>[0]["theme"];
}) {
  const { catalog } = useConnectionRegistry();
  const hostedAuthenticated = useHostedHubStore((state) => state.accountStatus === "authenticated");
  const [hostedHydrated, setHostedHydrated] = useState(false);
  const [directHydrated, setDirectHydrated] = useState(false);
  const [directCredentialReadable, setDirectCredentialReadable] = useState(false);
  const pendingWorkspaceLink = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    void ensureMobileHostedSession().finally(() => {
      if (active) setHostedHydrated(true);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    let generation = 0;
    const evaluate = async () => {
      const issued = ++generation;
      await catalog.waitForHydration();
      let readable = false;
      for (const environment of catalog.list()) {
        try {
          const token = await catalog.readBearerToken(environment.environmentId);
          if (typeof token === "string" && token.length > 0) {
            readable = true;
            break;
          }
        } catch {
          // An unreadable credential is not authority.
        }
      }
      if (!active || issued !== generation) return;
      setDirectCredentialReadable(readable);
      setDirectHydrated(true);
    };
    const unsubscribe = catalog.registryStore.subscribe(() => void evaluate());
    void evaluate();
    return () => {
      active = false;
      generation += 1;
      unsubscribe();
    };
  }, [catalog]);

  const access = deriveAppAccess({
    hostedHydrated,
    hostedSessionRevalidated: hostedAuthenticated,
    directHydrated,
    directCredentialReadable,
  });

  useEffect(() => {
    let active = true;
    const capture = (url: string | null) => {
      if (
        active &&
        access.status !== "unlocked" &&
        url !== null &&
        isWorkspaceDeepLink(url) &&
        pendingWorkspaceLink.current === null
      ) {
        pendingWorkspaceLink.current = url;
      }
    };
    void Linking.getInitialURL().then(capture);
    const subscription = Linking.addEventListener("url", (event) => capture(event.url));
    return () => {
      active = false;
      subscription.remove();
    };
  }, [access.status]);

  useEffect(() => {
    if (access.status !== "unlocked" || pendingWorkspaceLink.current === null) return;
    const url = pendingWorkspaceLink.current;
    pendingWorkspaceLink.current = null;
    const frame = requestAnimationFrame(() => {
      void Linking.openURL(url);
    });
    return () => cancelAnimationFrame(frame);
  }, [access.status]);

  if (access.status === "hydrating") return <LaunchSurface />;
  if (access.status === "locked") {
    return <LockedNavigation linking={props.linking} theme={props.theme} />;
  }
  return (
    <>
      <ServerStateBootstrap />
      <WorkspaceNavigation linking={props.linking} theme={props.theme} />
    </>
  );
}
