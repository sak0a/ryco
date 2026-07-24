import {
  createRemoteEnvironmentApi,
  isRemoteEnvironmentAuthHttpError,
  RemoteEnvironmentAuthHttpError,
  resolveRemotePairingTarget,
} from "@ryco/client-runtime/connection";

import { getMobileEndpoint, getMobileHttpClient } from "./runtimeConfig";

export {
  isRemoteEnvironmentAuthHttpError,
  RemoteEnvironmentAuthHttpError,
  resolveRemotePairingTarget,
};

/**
 * The direct-node bearer API (pairing bootstrap -> bearer token -> ws-token) is
 * platform-agnostic in the runtime; the mobile binding just hands it the RN
 * httpClient and the configured origin. This is the B1 primary auth path — no
 * forked auth logic.
 */
export function createMobileRemoteEnvironmentApi(): ReturnType<typeof createRemoteEnvironmentApi> {
  return createRemoteEnvironmentApi(getMobileHttpClient(), getMobileEndpoint().origin());
}

export type MobileRemoteEnvironmentApi = ReturnType<typeof createMobileRemoteEnvironmentApi>;
