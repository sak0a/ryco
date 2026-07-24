import type { PairingCredentialSourceService } from "@ryco/client-runtime/platform";
import * as Linking from "expo-linking";

const PAIRING_TOKEN_PARAM = "token";

/**
 * Extract a pairing token from a deep-link/QR URL. The token is carried in the
 * URL fragment (`#token=...`), matching the web take-once invariant, and falls
 * back to the query string.
 */
export function extractPairingToken(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  const hash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
  const hashToken = new URLSearchParams(hash).get(PAIRING_TOKEN_PARAM)?.trim();
  if (hashToken) return hashToken;
  const searchToken = url.searchParams.get(PAIRING_TOKEN_PARAM)?.trim();
  return searchToken ? searchToken : null;
}

/**
 * Reads a pairing credential once and never surfaces it again. The OS cannot
 * "delete" a launch deep link, so consumption is tracked in memory: once a token
 * is returned, subsequent `take()` calls return null. Runtime deep links (links
 * opened while the app is running) can be fed in via `providePairingUrl` before
 * `take()` is called.
 */
export interface MobilePairingCredentialSource extends PairingCredentialSourceService {
  readonly providePairingUrl: (url: string) => void;
}

export function createMobilePairingCredentialSource(
  getInitialUrl: () => Promise<string | null> = Linking.getInitialURL,
): MobilePairingCredentialSource {
  let consumed = false;
  let pendingUrl: string | null = null;

  return {
    providePairingUrl: (url) => {
      pendingUrl = url;
    },
    take: async () => {
      if (consumed) return null;
      const rawUrl = pendingUrl ?? (await getInitialUrl());
      pendingUrl = null;
      if (!rawUrl) return null;
      const token = extractPairingToken(rawUrl);
      if (token) consumed = true;
      return token;
    },
  };
}

export const mobilePairingCredentialSource = createMobilePairingCredentialSource();
