import {
  resolveHostedRpcCapability,
  type HostedRpcCapability,
} from "@ryco/client-runtime/authorization";

import { isHostedHubMode } from "../env";
import { useHostedHubStore } from "./state";

export { resolveHostedRpcCapability };
export type { HostedRpcCapability };

/** React binding only; capability policy is package-owned. */
export function useHostedRpcCapability(method: string): HostedRpcCapability {
  const state = useHostedHubStore((value) => value);
  return resolveHostedRpcCapability({
    hosted: isHostedHubMode(),
    role: state.effectiveRole,
    fresh: state.directoryStatus === "ready" && state.transportStatus === "online",
    browserCurrent: state.browserStatus === "current",
    sessionReady: state.sessionStatus === "ready",
    method,
  });
}
