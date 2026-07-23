import { HostedHubApi as RuntimeHostedHubApi } from "@ryco/client-runtime/authorization";

import { webEndpoint } from "../platform/endpoint";
import { webHttpClient } from "../platform/httpClient";
import { webPasskeyCeremony } from "../platform/passkeyCeremony";
import { webSessionCredentials } from "../platform/sessionCredentials";

export { HostedHubApiError } from "@ryco/client-runtime/authorization";

export class HostedHubApi extends RuntimeHostedHubApi {
  constructor() {
    super({
      endpoint: webEndpoint,
      httpClient: webHttpClient,
      passkeyCeremony: webPasskeyCeremony,
      sessionCredentials: webSessionCredentials,
    });
  }
}

/** The web binding owns browser fetch/cookie/passkey primitives, never the API policy. */
/** Browser binding used only by legacy app call sites during the transition. */
export const hostedHubApi = new HostedHubApi();
