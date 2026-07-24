import type { ExpoConfig } from "expo/config";

import { loadMobileEnv, resolveAppVariant, type AppVariant } from "./config/env.ts";

// Ryco public mobile scaffold (B1). The upstream hosted-auth vendor plane and
// managed-cloud plane, its EAS project/owner, upstream bundle IDs/schemes, brand
// assets, the default telemetry endpoint, widgets, share extension, quick
// actions, and the camera-showcase rig are all stripped per the design spec's
// strip list. Direct-node bearer pairing is the B1 auth plane; hosted passkeys
// (associated domains below) are inert until workstream C.
const repoEnv = loadMobileEnv();
Object.assign(process.env, repoEnv);

const APP_VARIANT = resolveAppVariant(repoEnv.APP_VARIANT);

// Local, capability-reduced device builds (free Apple Personal Team) can only
// sign their own bundle id; expose an override so `expo run:ios` on a device
// does not fail signing. Optional and off by default.
const isIosPersonalTeamBuild = repoEnv.RYCO_IOS_PERSONAL_TEAM === "1";
const personalTeamBundleIdentifier = repoEnv.RYCO_IOS_PERSONAL_TEAM_BUNDLE_ID?.trim();
const IOS_BUNDLE_IDENTIFIER_PATTERN = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;

if (
  isIosPersonalTeamBuild &&
  (!personalTeamBundleIdentifier ||
    !IOS_BUNDLE_IDENTIFIER_PATTERN.test(personalTeamBundleIdentifier))
) {
  throw new Error(
    "RYCO_IOS_PERSONAL_TEAM_BUNDLE_ID must be a reverse-DNS identifier such as dev.ryco.app.local when RYCO_IOS_PERSONAL_TEAM=1.",
  );
}

// Reverse-DNS of the canonical hosted origin app.ryco.dev.
const VARIANT_CONFIG: Record<
  AppVariant,
  {
    readonly appName: string;
    readonly scheme: string;
    readonly iosBundleIdentifier: string;
    readonly androidPackage: string;
    readonly relyingParty: string;
    readonly androidNotificationColor: string;
    readonly splashDark: string;
  }
> = {
  development: {
    appName: "Ryco Dev",
    scheme: "ryco-dev",
    iosBundleIdentifier: "dev.ryco.app.dev",
    androidPackage: "dev.ryco.app.dev",
    relyingParty: "app.ryco.dev",
    androidNotificationColor: "#00639B",
    splashDark: "#0a0a0a",
  },
  preview: {
    appName: "Ryco Preview",
    scheme: "ryco-preview",
    iosBundleIdentifier: "dev.ryco.app.preview",
    androidPackage: "dev.ryco.app.preview",
    relyingParty: "app.ryco.dev",
    androidNotificationColor: "#7565C7",
    splashDark: "#0a0a0a",
  },
  production: {
    appName: "Ryco",
    scheme: "ryco",
    iosBundleIdentifier: "dev.ryco.app",
    androidPackage: "dev.ryco.app",
    relyingParty: "app.ryco.dev",
    androidNotificationColor: "#FFFFFF",
    splashDark: "#0a0a0a",
  },
};

const variant = VARIANT_CONFIG[APP_VARIANT];
const iosBundleIdentifier = isIosPersonalTeamBuild
  ? personalTeamBundleIdentifier!
  : variant.iosBundleIdentifier;

// Aliases match the fonts' PostScript names on iOS; register the same names on
// Android so RN and the native composer share one family-name set.
const dmSansFonts = {
  regular: "@expo-google-fonts/dm-sans/400Regular/DMSans_400Regular.ttf",
  medium: "@expo-google-fonts/dm-sans/500Medium/DMSans_500Medium.ttf",
  bold: "@expo-google-fonts/dm-sans/700Bold/DMSans_700Bold.ttf",
} as const;

// Apple Developer Team id is deployment metadata (owner-supplied via env);
// never hardcode a team id in the public scaffold.
const appleTeamId = repoEnv.RYCO_IOS_APPLE_TEAM_ID?.trim();

const config: ExpoConfig = {
  name: variant.appName,
  slug: "ryco-mobile",
  platforms: ["ios", "android"],
  scheme: variant.scheme,
  version: "0.1.0",
  runtimeVersion: {
    // Fingerprint (not appVersion) so an OTA only reaches binaries whose native
    // project — native deps, config plugins, AND patches/ — matches the update.
    policy: process.env.MOBILE_VERSION_POLICY ?? "fingerprint",
  },
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic",
  // OTA updates are disabled in the public scaffold: no EAS project id is
  // baked in. B3 wires the Ryco EAS project + update URL.
  updates: {
    enabled: false,
  },
  ios: {
    icon: "./assets/icon.png",
    supportsTablet: true,
    bundleIdentifier: iosBundleIdentifier,
    ...(appleTeamId ? { appleTeamId } : {}),
    // Present but inert for B1: hosted passkeys land with workstream C.
    associatedDomains: [
      `applinks:${variant.relyingParty}`,
      `webcredentials:${variant.relyingParty}`,
    ],
    infoPlist: {
      NSAppTransportSecurity: {
        // Allow LAN/tailnet connections to a local or staging node over http.
        NSAllowsArbitraryLoads: true,
      },
      NSLocalNetworkUsageDescription:
        "Allow Ryco to connect to Ryco nodes on your local network or tailnet.",
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    icon: "./assets/icon.png",
    package: variant.androidPackage,
    adaptiveIcon: {
      backgroundColor: "#000000",
      foregroundImage: "./assets/adaptive-icon.png",
      monochromeImage: "./assets/android-icon-mark.png",
    },
    predictiveBackGestureEnabled: true,
  },
  web: {
    favicon: "./assets/icon.png",
  },
  plugins: [
    "expo-asset",
    [
      "expo-font",
      {
        ios: {
          fonts: [dmSansFonts.regular, dmSansFonts.medium, dmSansFonts.bold],
        },
        android: {
          fonts: [
            {
              fontFamily: "DMSans-Regular",
              fontDefinitions: [{ path: dmSansFonts.regular, weight: 400 }],
            },
            {
              fontFamily: "DMSans-Medium",
              fontDefinitions: [{ path: dmSansFonts.medium, weight: 500 }],
            },
            {
              fontFamily: "DMSans-Bold",
              fontDefinitions: [{ path: dmSansFonts.bold, weight: 700 }],
            },
          ],
        },
      },
    ],
    "expo-secure-store",
    "expo-sqlite",
    [
      "expo-notifications",
      {
        icon: "./assets/android-notification-icon.png",
        color: variant.androidNotificationColor,
        mode: APP_VARIANT === "development" ? "development" : "production",
      },
    ],
    "expo-web-browser",
    [
      "expo-camera",
      {
        cameraPermission: "Allow Ryco to access your camera so you can scan pairing QR codes.",
        barcodeScannerEnabled: true,
        recordAudioAndroid: false,
      },
    ],
    [
      "expo-splash-screen",
      {
        image: "./assets/splash-icon.png",
        resizeMode: "contain",
        backgroundColor: "#ffffff",
        imageWidth: 220,
        dark: {
          image: "./assets/splash-icon.png",
          backgroundColor: variant.splashDark,
        },
      },
    ],
    [
      "expo-build-properties",
      {
        ios: {
          deploymentTarget: "18.0",
        },
      },
    ],
    "./plugins/withIosCocoaPodsUuidCache.cjs",
    "./plugins/withIosSceneLifecycle.cjs",
    "./plugins/withAndroidCleartextTraffic.cjs",
    "./plugins/withAndroidGradleHeap.cjs",
    "./plugins/withAndroidModernPopupMenu.cjs",
    "./plugins/withAndroidModernAlertDialog.cjs",
    "./plugins/withAndroidPredictiveBackCompat.cjs",
  ],
  extra: {
    appVariant: APP_VARIANT,
    iosPersonalTeamBuild: isIosPersonalTeamBuild,
    // Optional default node origin for local testing; pairing overrides it.
    node: {
      httpBaseUrl: repoEnv.EXPO_PUBLIC_RYCO_HTTP_URL ?? null,
      wsBaseUrl: repoEnv.EXPO_PUBLIC_RYCO_WS_URL ?? null,
    },
  },
};

export default config;
