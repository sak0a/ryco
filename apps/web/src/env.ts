/**
 * True when running inside the Electron preload bridge, false in a regular browser.
 * The preload script sets window.nativeApi via contextBridge before any web-app
 * code executes, so this is reliable at module load time.
 */
export const isElectron =
  typeof window !== "undefined" &&
  (window.desktopBridge !== undefined || window.nativeApi !== undefined);

export type RycoClientMode = "standard" | "hosted-hub";

export function readRycoClientMode(): RycoClientMode {
  return import.meta.env.VITE_RYCO_CLIENT_MODE === "hosted-hub" ? "hosted-hub" : "standard";
}

export function isHostedHubMode(): boolean {
  return readRycoClientMode() === "hosted-hub";
}

export function readMobileAppUrl(): string | null {
  try {
    const url = new URL(import.meta.env.VITE_RYCO_MOBILE_APP_URL);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function isPhoneAppInterstitialEnabled(): boolean {
  return (
    import.meta.env.VITE_RYCO_PHONE_APP_INTERSTITIAL === "enabled" && readMobileAppUrl() !== null
  );
}
