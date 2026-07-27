import type { HubProfile } from "../hostedHub/hubProfile";
import { normalizeHubOrigin } from "../hostedHub/hubProfile";

type WebBrowserModule = typeof import("expo-web-browser");

export interface HostedSignInPreviewInput {
  readonly developmentBuild: boolean;
  readonly hostedModeAvailable: boolean;
  readonly profile: HubProfile | null;
}

export interface HostedSignInPreviewDependencies {
  readonly loadBrowser: () => Promise<WebBrowserModule>;
}

/**
 * Return the one URL the development-only browser preview may open.
 *
 * The compatible profile is the authority for a user-selected self-hosted
 * domain. Re-normalizing it here keeps the browser boundary fail-closed even if
 * a future caller bypasses the profile constructor.
 */
export function resolveHostedSignInPreviewUrl(input: HostedSignInPreviewInput): string | null {
  if (!input.developmentBuild || input.hostedModeAvailable) return null;
  if (input.profile?.compatibility.status !== "compatible") return null;

  const normalized = normalizeHubOrigin(input.profile.origin);
  return normalized.ok ? `${normalized.origin}/` : null;
}

/**
 * Open the Hub's ordinary web sign-in without creating or adopting a native
 * session.
 *
 * The result is intentionally discarded. A callback URL, browser cookie,
 * authorization code, or passkey transcript has no return path into the app.
 */
export async function openHostedSignInPreview(
  url: string,
  dependencies: HostedSignInPreviewDependencies = {
    loadBrowser: () => import("expo-web-browser"),
  },
): Promise<void> {
  const normalized = normalizeHubOrigin(url);
  if (!normalized.ok || `${normalized.origin}/` !== url) {
    throw new Error("Hub sign-in preview is unavailable.");
  }

  const browser = await dependencies.loadBrowser();
  await browser.openAuthSessionAsync(url, null, {
    preferEphemeralSession: true,
    preferUniversalLinks: false,
  });
}
