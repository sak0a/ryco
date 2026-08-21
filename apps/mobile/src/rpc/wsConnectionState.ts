import { useAtomValue } from "@effect/atom-react";
import {
  getWsConnectionStatus,
  getWsConnectionUiState,
  seedWsConnectionOnlineStatus,
  wsConnectionOpenedCountAtom,
  wsConnectionStatusAtom,
  wsConnectionStatusForEnvironmentAtom,
  type WsConnectionStatus,
  type WsConnectionUiState,
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

/**
 * UI state for one environment's slot with the device-level online signal
 * overlaid. A keyed slot's `online: false` is inert in getWsConnectionUiState
 * unless that socket also recorded a disconnect, so an environment that never
 * attempted a connection (or whose slot was cleared on dispose) would read
 * "connecting" in airplane mode. Device-level connectivity outranks per-socket
 * phase for everything except a live socket. Reading the global imperatively is
 * safe for reactivity: every caller already re-renders on status writes, and
 * setBrowserOnlineStatus writes every known keyed slot too.
 */
export function wsUiStateForEnvironment(status: WsConnectionStatus): WsConnectionUiState {
  const uiState = getWsConnectionUiState(status);
  if (uiState === "connected") return uiState;
  return getWsConnectionStatus().online ? uiState : "offline";
}
