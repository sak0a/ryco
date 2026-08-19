import { useAtomValue } from "@effect/atom-react";
import {
  seedWsConnectionOnlineStatus,
  wsConnectionOpenedCountAtom,
  wsConnectionStatusAtom,
  wsConnectionStatusForEnvironmentAtom,
  type WsConnectionStatus,
} from "@ryco/client-runtime/rpc";
import type { EnvironmentId } from "@ryco/contracts";

import { mobileAppLifecycle } from "../platform";

export * from "@ryco/client-runtime/rpc";

// Seed the runtime's online-status atom from the RN AppLifecycle adapter. Called
// from the bootstrap, not at import time.
export function initializeWsConnectionState(): void {
  seedWsConnectionOnlineStatus(mobileAppLifecycle);
}

export function useWsConnectionStatus(): WsConnectionStatus {
  return useAtomValue(wsConnectionStatusAtom);
}

/** This environment's own socket status — never another node's last write. */
export function useWsConnectionStatusForEnvironment(
  environmentId: EnvironmentId,
): WsConnectionStatus {
  return useAtomValue(wsConnectionStatusForEnvironmentAtom(environmentId));
}

export function useWsConnectionOpenedCount(): number {
  return useAtomValue(wsConnectionOpenedCountAtom);
}
