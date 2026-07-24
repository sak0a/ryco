import type { SavedEnvironmentConnectionState } from "@ryco/client-runtime/connection";
import type { WsConnectionUiState } from "@ryco/client-runtime/rpc";

import type { StatusTone } from "../../components/StatusPill";

// §3-26: status tone for a saved environment. Upstream keyed this on
// RemoteClientConnectionState (absent in runtime A); here it is keyed on the
// per-env SavedEnvironmentConnectionState with the single-socket WsConnectionUiState
// overlaid for the reconnecting/offline states that per-env state lacks.
export type ConnectionToneState =
  | "connected"
  | "connecting"
  | "reconnecting"
  | "error"
  | "offline"
  | "disconnected";

export function resolveConnectionTone(state: ConnectionToneState): StatusTone {
  switch (state) {
    case "connected":
      return {
        label: "Connected",
        pillClassName: "bg-emerald-500/12 dark:bg-emerald-500/16",
        textClassName: "text-emerald-700 dark:text-emerald-300",
      };
    case "reconnecting":
      return {
        label: "Reconnecting",
        pillClassName: "bg-amber-500/12 dark:bg-amber-500/16",
        textClassName: "text-amber-700 dark:text-amber-300",
      };
    case "connecting":
      return {
        label: "Connecting",
        pillClassName: "bg-sky-500/12 dark:bg-sky-500/16",
        textClassName: "text-sky-700 dark:text-sky-300",
      };
    case "error":
      return {
        label: "Connection failed",
        pillClassName: "bg-rose-500/12 dark:bg-rose-500/16",
        textClassName: "text-rose-700 dark:text-rose-300",
      };
    case "offline":
      return {
        label: "Offline",
        pillClassName: "bg-subtle",
        textClassName: "text-foreground-muted",
      };
    case "disconnected":
      return {
        label: "Disconnected",
        pillClassName: "bg-subtle",
        textClassName: "text-foreground-muted",
      };
  }
}

export function connectionToneForEnvironment(
  connectionState: SavedEnvironmentConnectionState,
  wsUiState: WsConnectionUiState,
): StatusTone {
  if (wsUiState === "offline") return resolveConnectionTone("offline");
  if (wsUiState === "reconnecting" && connectionState === "connected") {
    return resolveConnectionTone("reconnecting");
  }
  return resolveConnectionTone(connectionState);
}
