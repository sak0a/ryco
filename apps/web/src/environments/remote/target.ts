import {
  resolveRemotePairingTarget as resolveRuntimeRemotePairingTarget,
  type ResolvedRemotePairingTarget,
} from "@ryco/client-runtime/connection";

import { webEndpoint } from "../../platform/endpoint";
import { readHostedPairingRequest } from "../../hostedPairing";
import { getPairingTokenFromUrl } from "../../pairingUrl";

export type { ResolvedRemotePairingTarget };

export function resolveRemotePairingTarget(input: {
  readonly pairingUrl?: string;
  readonly host?: string;
  readonly pairingCode?: string;
}): ResolvedRemotePairingTarget {
  return resolveRuntimeRemotePairingTarget(input, webEndpoint.origin(), {
    readPairingToken: getPairingTokenFromUrl,
    readHostedPairingRequest,
  });
}
