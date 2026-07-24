import { useAtomValue } from "@effect/atom-react";
import {
  seedWsConnectionOnlineStatus,
  wsConnectionStatusAtom,
  type WsConnectionStatus,
} from "@ryco/client-runtime/rpc";

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
