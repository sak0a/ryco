import {
  createPathConfigForStaticNavigation,
  getPathFromState,
  NavigationState,
  StackActions,
  useNavigation,
} from "@react-navigation/native";
import {
  createNativeStackNavigator,
  createNativeStackScreen,
  type NativeStackNavigationOptions,
} from "@react-navigation/native-stack";
import { DynamicColorIOS, Platform, Pressable, ScrollView, StyleSheet } from "react-native";
import { useResolveClassNames } from "uniwind";

import { AppText as Text } from "./components/AppText";
import { HardwareKeyboardCommandProvider } from "./features/keyboard/HardwareKeyboardCommandProvider";
import { ConnectionsRouteScreen } from "./features/connection/ConnectionsRouteScreen";
import { ConnectionsNewRouteScreen } from "./features/connection/ConnectionsNewRouteScreen";
import { HomeRouteScreen } from "./features/home/HomeRouteScreen";
import { OnboardingRouteScreen } from "./features/onboarding/OnboardingRouteScreen";
import { ReviewCommentComposerSheet } from "./features/review/ReviewCommentComposerSheet";
import { ReviewSheet } from "./features/review/ReviewSheet";
import { SettingsAppearanceRouteScreen } from "./features/settings/SettingsAppearanceRouteScreen";
import { SettingsClientStorageRouteScreen } from "./features/settings/SettingsClientStorageRouteScreen";
import { SettingsEnvironmentsRouteScreen } from "./features/settings/SettingsEnvironmentsRouteScreen";
import { SettingsRouteScreen } from "./features/settings/SettingsRouteScreen";
import { ThreadRouteScreen } from "./features/threads/ThreadRouteScreen";
import {
  MVP_ROOT_ROUTES,
  WORKSPACE_OVERLAY_ROUTE_NAMES,
  type HeaderPreset,
  type MvpRouteDescriptor,
} from "./navigation/mvpRouteConfig";
import { NATIVE_LIQUID_GLASS_SUPPORTED } from "./native/native-glass";
import { nativeHeaderScrollEdgeEffects } from "./native/StackHeader";
import { useThreadOutboxDrain } from "./state/use-thread-outbox-drain";

const HEADER_SCROLL_EDGE_EFFECTS = nativeHeaderScrollEdgeEffects(Platform.OS, Platform.Version);

// Matches --color-sheet in global.css (light/dark). DynamicColorIOS lets the header
// background stay STATIC config while still adapting to appearance changes.
const SHEET_BACKGROUND_COLOR =
  Platform.OS === "ios"
    ? DynamicColorIOS({ light: "rgba(242, 242, 247, 0.98)", dark: "rgba(14, 14, 14, 0.98)" })
    : undefined;

type AppScreenOptions = NativeStackNavigationOptions & {
  readonly unstable_navigationItemStyle?: "editor";
};

// Shared header presets. GLASS = transparent header over the screen's primary
// scroll view on supported iOS; SOLID = opaque sheet-colored header for surfaces
// whose content scrolls internally (review); SHEET_SOLID = solid header inside
// sheets (centered title, no editor style).
const GLASS_HEADER_OPTIONS: AppScreenOptions = {
  headerBackButtonDisplayMode: "minimal",
  headerBackTitle: "",
  headerLargeTitle: false,
  headerShadowVisible: false,
  headerShown: true,
  headerStyle: NATIVE_LIQUID_GLASS_SUPPORTED
    ? { backgroundColor: "transparent" }
    : SHEET_BACKGROUND_COLOR !== undefined
      ? { backgroundColor: SHEET_BACKGROUND_COLOR as unknown as string }
      : undefined,
  headerTitleStyle: { fontSize: 18, fontWeight: "800" },
  headerTransparent: NATIVE_LIQUID_GLASS_SUPPORTED,
  scrollEdgeEffects: NATIVE_LIQUID_GLASS_SUPPORTED ? HEADER_SCROLL_EDGE_EFFECTS : undefined,
  unstable_navigationItemStyle: NATIVE_LIQUID_GLASS_SUPPORTED ? "editor" : undefined,
};

const SOLID_HEADER_OPTIONS: AppScreenOptions = {
  headerBackButtonDisplayMode: "minimal",
  headerBackTitle: "",
  headerLargeTitle: false,
  headerShadowVisible: false,
  headerShown: true,
  headerStyle:
    SHEET_BACKGROUND_COLOR !== undefined
      ? { backgroundColor: SHEET_BACKGROUND_COLOR as unknown as string }
      : undefined,
  headerTitleStyle: { fontSize: 18, fontWeight: "800" },
  headerTransparent: false,
  unstable_navigationItemStyle: Platform.OS === "ios" ? "editor" : undefined,
};

const SHEET_SOLID_HEADER_OPTIONS: AppScreenOptions = {
  ...SOLID_HEADER_OPTIONS,
  unstable_navigationItemStyle: undefined,
};

// Nested settings navigator hosted inside the SettingsSheet form sheet (a plain
// formSheet cannot render a stack header — the header + in-sheet pushes come from
// this nested stack). MVP subset: Settings, environments (+ add), appearance,
// client storage. Deferred: archive, auth, waitlist, legal.
const SettingsSheetStack = createNativeStackNavigator({
  initialRouteName: "Settings",
  screenOptions: {
    ...GLASS_HEADER_OPTIONS,
    unstable_navigationItemStyle: undefined,
  },
  screens: {
    Settings: createNativeStackScreen({
      screen: SettingsRouteScreen,
      linking: "",
      options: { title: "Settings" },
    }),
    SettingsEnvironments: createNativeStackScreen({
      screen: SettingsEnvironmentsRouteScreen,
      linking: "environments",
      options: { title: "Environments" },
    }),
    SettingsEnvironmentNew: createNativeStackScreen({
      // Reuses the pair-a-device screen (add an environment from settings).
      screen: ConnectionsNewRouteScreen,
      linking: "environment-new",
      options: { title: "Add Environment" },
    }),
    SettingsAppearance: createNativeStackScreen({
      screen: SettingsAppearanceRouteScreen,
      linking: "appearance",
      options: { title: "Appearance" },
    }),
    SettingsClientStorage: createNativeStackScreen({
      screen: SettingsClientStorageRouteScreen,
      linking: "client-storage",
      options: { title: "Client Storage" },
    }),
  },
});

// Routes presented as sheets/overlays ON TOP of the workspace. They must not
// influence the adaptive workspace pathname: opening Settings/Connections over
// Home should not change the active thread. Derived from the pure route config.
export const WORKSPACE_OVERLAY_ROUTES = new Set<string>(WORKSPACE_OVERLAY_ROUTE_NAMES);

function headerPresetOptions(preset: HeaderPreset): AppScreenOptions {
  switch (preset) {
    case "glass":
      return GLASS_HEADER_OPTIONS;
    case "solid":
      return SOLID_HEADER_OPTIONS;
    case "sheet-solid":
      return SHEET_SOLID_HEADER_OPTIONS;
    case "none":
      return {};
  }
}

// Map a pure route descriptor to the active-platform native-stack options
// (presentation/detents/grabber/headerShown). `card` is the native default, so
// it is left unset.
function platformPresentationOptions(descriptor: MvpRouteDescriptor): NativeStackNavigationOptions {
  const platform = Platform.OS === "android" ? descriptor.android : descriptor.ios;
  const options: NativeStackNavigationOptions = {};
  if (platform.presentation !== "card") options.presentation = platform.presentation;
  if (platform.sheetAllowedDetents) options.sheetAllowedDetents = [...platform.sheetAllowedDetents];
  if (platform.sheetGrabberVisible !== undefined) {
    options.sheetGrabberVisible = platform.sheetGrabberVisible;
  }
  if (platform.headerShown !== undefined) options.headerShown = platform.headerShown;
  return options;
}

function routeOptions(
  name: keyof typeof MVP_ROOT_ROUTES,
  extras: AppScreenOptions = {},
): AppScreenOptions {
  const descriptor = MVP_ROOT_ROUTES[name];
  return {
    ...headerPresetOptions(descriptor.headerPreset),
    ...platformPresentationOptions(descriptor),
    ...extras,
  };
}

/**
 * Pathname of the topmost NON-overlay route — the screen the workspace is
 * actually "on", regardless of any sheets floating above it.
 */
export function workspacePathFromState(state: NavigationState): string {
  const routes = state.routes.filter((route) => !WORKSPACE_OVERLAY_ROUTES.has(route.name));
  const effectiveState =
    routes.length > 0 && routes.length !== state.routes.length
      ? ({ ...state, routes, index: routes.length - 1 } as NavigationState)
      : state;
  const path = getPathFromState(effectiveState, navigationPathConfig);
  return path.startsWith("/") ? path : `/${path}`;
}

function RootStackLayout(props: {
  readonly children: React.ReactNode;
  readonly state: NavigationState;
}) {
  // Drain the offline outbox on reconnect (real drain lands with the send task).
  useThreadOutboxDrain();
  // Full pathname (sheets included) for keyboard-command scoping.
  const path = getPathFromState(props.state, navigationPathConfig);
  const pathname = path.startsWith("/") ? path : `/${path}`;

  // NOTE (divergence, recorded): upstream wraps children in AdaptiveWorkspaceLayout
  // (the tablet split view). B2 is phone-first; the adaptive layout + thread
  // sidebar land with the Home data wave (Task 3). The nav shell is fully
  // functional on phone without it.
  return (
    <HardwareKeyboardCommandProvider pathname={pathname}>
      {props.children}
    </HardwareKeyboardCommandProvider>
  );
}

function NotFoundScreen() {
  const navigation = useNavigation();
  const screenBgStyle = StyleSheet.flatten(useResolveClassNames("bg-screen"));
  const primaryBgStyle = StyleSheet.flatten(useResolveClassNames("bg-primary"));
  const returnHomeButtonStyle = StyleSheet.flatten([
    { borderRadius: 999, paddingHorizontal: 20, paddingVertical: 14 },
    primaryBgStyle,
  ]);

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        flexGrow: 1,
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        paddingHorizontal: 24,
        paddingVertical: 32,
      }}
      style={[{ flex: 1 }, screenBgStyle]}
    >
      <Text className="text-3xl font-ryco-bold text-foreground" selectable>
        Route not found
      </Text>
      <Pressable
        style={returnHomeButtonStyle}
        onPress={() => navigation.dispatch(StackActions.replace("Home"))}
      >
        <Text className="text-base font-ryco-bold text-primary-foreground">Return home</Text>
      </Pressable>
    </ScrollView>
  );
}

// The MVP static route tree, built from the pure route config so linking and
// presentation/detents cannot drift from what the route-config test asserts.
// Per-route cosmetic extras (titles, transparent content) stay inline.
export const ROOT_STACK_SCREENS = {
  Home: createNativeStackScreen({
    screen: HomeRouteScreen,
    linking: MVP_ROOT_ROUTES.Home.linking,
    options: routeOptions("Home", {
      contentStyle: { backgroundColor: "transparent" },
      headerBackVisible: false,
      title: "Threads",
    }),
  }),
  Thread: createNativeStackScreen({
    screen: ThreadRouteScreen,
    linking: MVP_ROOT_ROUTES.Thread.linking,
    options: routeOptions("Thread"),
  }),
  ThreadReview: createNativeStackScreen({
    screen: ReviewSheet,
    linking: MVP_ROOT_ROUTES.ThreadReview.linking,
    options: routeOptions("ThreadReview"),
  }),
  ThreadReviewComment: createNativeStackScreen({
    screen: ReviewCommentComposerSheet,
    linking: MVP_ROOT_ROUTES.ThreadReviewComment.linking,
    options: routeOptions("ThreadReviewComment"),
  }),
  Connections: createNativeStackScreen({
    screen: ConnectionsRouteScreen,
    linking: MVP_ROOT_ROUTES.Connections.linking,
    options: routeOptions("Connections", { title: "Environments" }),
  }),
  ConnectionsNew: createNativeStackScreen({
    screen: ConnectionsNewRouteScreen,
    linking: MVP_ROOT_ROUTES.ConnectionsNew.linking,
    options: routeOptions("ConnectionsNew", { title: "Pair a device" }),
  }),
  SettingsSheet: createNativeStackScreen({
    screen: SettingsSheetStack,
    linking: MVP_ROOT_ROUTES.SettingsSheet.linking,
    options: routeOptions("SettingsSheet", { gestureEnabled: true, headerShown: false }),
  }),
  Onboarding: createNativeStackScreen({
    screen: OnboardingRouteScreen,
    linking: MVP_ROOT_ROUTES.Onboarding.linking,
    options: routeOptions("Onboarding", { title: "Connect", gestureEnabled: true }),
  }),
  NotFound: createNativeStackScreen({
    screen: NotFoundScreen,
    linking: MVP_ROOT_ROUTES.NotFound.linking,
  }),
} as const;

export const RootStack = createNativeStackNavigator({
  initialRouteName: "Home",
  layout: RootStackLayout,
  screenOptions: {
    headerShown: false,
  },
  screens: ROOT_STACK_SCREENS,
});
type RootStackType = typeof RootStack;

const navigationPathConfig = {
  screens: createPathConfigForStaticNavigation(RootStack) ?? {},
};

declare module "@react-navigation/native" {
  interface RootNavigator extends RootStackType {}
}
