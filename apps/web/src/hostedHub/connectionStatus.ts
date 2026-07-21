import type {
  HostedBrowserStatus,
  HostedRelayTransportStatus,
  HostedRycoSessionStatus,
  HostedSelectionStatus,
} from "./types";

/**
 * The bounded inputs of the hosted connection status derivation. A subset of
 * the hosted hub store state so the selector stays pure and callable from the
 * phone pill, the connection sheet, and the desktop menu alike.
 */
export interface HostedConnectionStatusInput {
  readonly browserStatus: HostedBrowserStatus;
  readonly sessionStatus: HostedRycoSessionStatus;
  readonly selectionStatus: HostedSelectionStatus;
  readonly transportStatus: HostedRelayTransportStatus;
}

/**
 * Derive the single bounded connection status text rendered everywhere the
 * hosted connection state appears (extracted unchanged from the node menu so
 * every presentation renders identical state). The vocabulary is the approved
 * bounded set; no raw errors or identifiers ever pass through here.
 */
export function deriveHostedConnectionStatusText(input: HostedConnectionStatusInput): string {
  const { browserStatus, sessionStatus, selectionStatus, transportStatus } = input;
  return browserStatus === "offline"
    ? "Offline"
    : browserStatus === "checking-access"
      ? "Checking access"
      : browserStatus === "synchronizing"
        ? "Synchronizing"
        : browserStatus === "suspended" || browserStatus === "stale"
          ? "Stale"
          : sessionStatus === "delivery-unknown"
            ? "Delivery unknown"
            : selectionStatus === "authorization-removed"
              ? "Authorization removed"
              : selectionStatus === "revoked"
                ? "Revoked"
                : selectionStatus === "incompatible"
                  ? "Incompatible"
                  : transportStatus === "online" && sessionStatus === "ready"
                    ? "Online"
                    : transportStatus === "reconnecting"
                      ? "Reconnecting"
                      : selectionStatus === "offline"
                        ? "Offline"
                        : transportStatus.replaceAll("-", " ");
}
