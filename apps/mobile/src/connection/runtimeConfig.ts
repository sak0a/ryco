import type {
  ClientRuntimeConfigService,
  EndpointService,
  HttpClientService,
} from "@ryco/client-runtime/platform";

import { createMobileEndpoint, createMobileHttpClient, readMobileClientRuntimeConfig } from "../platform";

// Lazily-memoized runtime singletons. Reading the app config (expo-constants)
// and constructing the endpoint/httpClient is deferred to first use so importing
// this wiring module has no side effects.
let config: ClientRuntimeConfigService | null = null;
let endpoint: EndpointService | null = null;
let httpClient: HttpClientService | null = null;

export function getMobileClientRuntimeConfig(): ClientRuntimeConfigService {
  return (config ??= readMobileClientRuntimeConfig());
}

export function getMobileEndpoint(): EndpointService {
  return (endpoint ??= createMobileEndpoint(getMobileClientRuntimeConfig()));
}

export function getMobileHttpClient(): HttpClientService {
  return (httpClient ??= createMobileHttpClient(() => getMobileEndpoint().origin() || null));
}

/** Test seam: drop the memoized singletons so a fresh config is read. */
export function resetMobileRuntimeConfigForTests(): void {
  config = null;
  endpoint = null;
  httpClient = null;
}
