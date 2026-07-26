// Pure, react-native-free description of the MVP navigation tree. This is the
// single source of truth the native `Stack.tsx` builds its screen options from
// AND the route-config test asserts over — kept import-clean so it stays
// node-testable (react-native / react-navigation ship untranspiled Flow syntax
// and cannot load in the vp/node test env).

export type RoutePresentation = "card" | "formSheet" | "fullScreenModal";
export type HeaderPreset = "glass" | "solid" | "sheet-solid" | "none";

export interface RoutePlatformPresentation {
  readonly presentation: RoutePresentation;
  readonly sheetAllowedDetents?: readonly number[];
  readonly sheetGrabberVisible?: boolean;
  readonly headerShown?: boolean;
}

export interface MvpRouteDescriptor {
  /** Linking path relative to the app root (the flat deep-link URL). */
  readonly linking: string;
  /** True when the route floats over the workspace and must not enter the
   *  adaptive-layout pathname (WORKSPACE_OVERLAY_ROUTES). */
  readonly overlay: boolean;
  readonly headerPreset: HeaderPreset;
  readonly ios: RoutePlatformPresentation;
  readonly android: RoutePlatformPresentation;
}

const THREAD = "threads/:environmentId/:threadId";

// Flat root routes (Thread lives here, NOT in a nested navigator — required for
// the iOS-26 shared-header morph). Order is the source order for the tree.
export const MVP_ROOT_ROUTES = {
  Home: {
    linking: "",
    overlay: false,
    headerPreset: "glass",
    ios: { presentation: "card" },
    android: { presentation: "card" },
  },
  Thread: {
    linking: THREAD,
    overlay: false,
    headerPreset: "glass",
    ios: { presentation: "card" },
    android: { presentation: "card" },
  },
  ThreadReview: {
    linking: `${THREAD}/review`,
    overlay: false,
    headerPreset: "solid",
    ios: { presentation: "card" },
    android: { presentation: "card" },
  },
  ThreadReviewComment: {
    linking: `${THREAD}/review-comment`,
    overlay: true,
    headerPreset: "none",
    // Android cannot host the keyboard-driven comment composer inside a formSheet.
    ios: {
      presentation: "formSheet",
      sheetAllowedDetents: [0.55, 0.92],
      sheetGrabberVisible: true,
    },
    android: { presentation: "fullScreenModal", sheetGrabberVisible: false },
  },
  Connections: {
    linking: "connections",
    overlay: true,
    headerPreset: "none",
    // Widened from [0.55, 0.7]: the sheet now carries two labeled sections —
    // direct saved devices and hosted Hub nodes — rather than one list.
    ios: { presentation: "formSheet", sheetAllowedDetents: [0.6, 0.95], sheetGrabberVisible: true },
    android: { presentation: "card", headerShown: false },
  },
  ConnectionsNew: {
    // Deliberate divergence from upstream's formSheet: a card per the spec table.
    linking: "connections/new",
    overlay: true,
    headerPreset: "sheet-solid",
    ios: { presentation: "card" },
    android: { presentation: "card" },
  },
  SettingsSheet: {
    linking: "settings",
    overlay: false,
    headerPreset: "none",
    ios: { presentation: "card" },
    android: { presentation: "card" },
  },
  Onboarding: {
    linking: "onboarding",
    overlay: true,
    headerPreset: "sheet-solid",
    ios: { presentation: "formSheet", sheetAllowedDetents: [0.6, 0.95], sheetGrabberVisible: true },
    android: {
      presentation: "formSheet",
      sheetAllowedDetents: [0.6, 0.95],
      sheetGrabberVisible: true,
    },
  },
  NotFound: {
    // Deep-link catch-all — the one sanctioned route not in the spec's table.
    linking: "*",
    overlay: false,
    headerPreset: "none",
    ios: { presentation: "card" },
    android: { presentation: "card" },
  },
} as const satisfies Record<string, MvpRouteDescriptor>;

export type MvpRootRouteName = keyof typeof MVP_ROOT_ROUTES;

// Nested routes inside the full-screen Settings stack.
export const MVP_SETTINGS_SHEET_ROUTES = {
  Settings: { linking: "" },
  SettingsHub: { linking: "hub" },
  SettingsWorkspace: { linking: "workspace" },
  // Hosted Hub account. Nested rather than a root route so the hosted plane
  // adds no root-route churn: sign-in lives inside the existing `Onboarding`
  // sheet, and this is the only route the hosted surfaces add anywhere.
  SettingsAccount: { linking: "account" },
  SettingsAppearance: { linking: "appearance" },
  SettingsClientStorage: { linking: "client-storage" },
  SettingsAbout: { linking: "about" },
} as const satisfies Record<string, { readonly linking: string }>;

export const WORKSPACE_OVERLAY_ROUTE_NAMES: readonly MvpRootRouteName[] = (
  Object.keys(MVP_ROOT_ROUTES) as MvpRootRouteName[]
).filter((name) => MVP_ROOT_ROUTES[name].overlay);
