import type { EndpointService, HttpClientService } from "@ryco/client-runtime/platform";

import { createMobileEndpoint } from "../platform/endpoint";
import { createMobileHttpClient } from "../platform/httpClient";
import { readMobileHostedConfig, type MobileHostedConfig } from "../platform/config";
import { readCachedMobileHubProfile } from "./hubProfile";

/**
 * The hosted plane's endpoint and HTTP client.
 *
 * These are deliberately **separate instances** from the direct plane's
 * (`../connection/runtimeConfig.ts`). Two-plane isolation is a security
 * invariant: enabling hosted mode must not disturb the direct plane's stores,
 * catalog, or bearer tokens, and no direct bearer token may ever reach a hosted
 * request.
 *
 * The hosted endpoint's `origin()` must return the Hub **public origin**, since
 * `HostedHubApi` builds every bearer request URL from it and the DPoP signer
 * signs that exact origin into `htu`. The Hub compares `htu` against its own
 * configured public origin, so pointing this at the RP-ID host instead would
 * fail every proof.
 *
 * Everything is lazily memoized so importing this module has no side effects.
 */

let hostedConfig: MobileHostedConfig | null | undefined;
let endpoint: EndpointService | null = null;
let httpClient: HttpClientService | null = null;

/** `null` when hosted mode is not configured or the origin failed validation. */
export function getMobileHostedConfig(): MobileHostedConfig | null {
  if (hostedConfig === undefined) {
    const buildConfig = readMobileHostedConfig();
    const profile = readCachedMobileHubProfile();
    // Profile hydration happens before hosted bootstrap. A custom domain uses
    // the system-browser handoff contract and must never fall through to the
    // build's native-passkey runtime; until that handoff is implemented, it
    // intentionally leaves hosted mode unavailable while direct nodes continue.
    hostedConfig =
      profile !== undefined && profile !== null && profile.origin !== buildConfig?.hubOrigin
        ? null
        : buildConfig;
  }
  return hostedConfig;
}

export function isMobileHostedModeConfigured(): boolean {
  return getMobileHostedConfig() !== null;
}

export function getMobileHostedEndpoint(): EndpointService | null {
  const config = getMobileHostedConfig();
  if (config === null) return null;
  return (endpoint ??= createMobileEndpoint({
    clientMode: "hosted-hub",
    httpBaseUrl: config.hubOrigin,
    wsBaseUrl: toWebSocketOrigin(config.hubOrigin),
  }));
}

export function getMobileHostedHttpClient(): HttpClientService | null {
  const hostedEndpoint = getMobileHostedEndpoint();
  if (hostedEndpoint === null) return null;
  return (httpClient ??= createMobileHttpClient(() => hostedEndpoint.origin() || null));
}

function toWebSocketOrigin(origin: string): string {
  const url = new URL(origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.origin;
}

/** Drop memoized hosted singletons after a deliberate profile-domain change. */
export function invalidateMobileHostedRuntimeConfig(): void {
  hostedConfig = undefined;
  endpoint = null;
  httpClient = null;
}

/** Test alias kept explicit at call sites. */
export function resetMobileHostedRuntimeConfigForTests(): void {
  invalidateMobileHostedRuntimeConfig();
}
