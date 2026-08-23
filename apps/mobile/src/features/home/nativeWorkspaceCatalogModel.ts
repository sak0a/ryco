import {
  reconcileWorkspaceMachineCatalog,
  type WorkspaceMachineCatalogEntry,
  type WorkspaceNativeTrustState,
} from "@ryco/client-runtime/state/workspace";
import type { EnvironmentConnectionState, EnvironmentId } from "@ryco/contracts";

import type { CachedHubNodeRecord } from "../../hostedHub/nodeRoster";
import type { MobileHostedConnectionState } from "../../connection/hostedConnectionCoordinator";

function connectionState(
  connection: MobileHostedConnectionState | undefined,
): EnvironmentConnectionState {
  if (connection?.transportStatus === "online" && connection.sessionStatus === "ready") {
    return "connected";
  }
  if (
    connection &&
    (connection.transportStatus === "requesting-ticket" ||
      connection.transportStatus === "connecting" ||
      connection.transportStatus === "authenticating" ||
      connection.transportStatus === "opening-channel" ||
      connection.transportStatus === "reconnecting" ||
      connection.sessionStatus === "synchronizing" ||
      connection.sessionStatus === "replaying")
  ) {
    return "connecting";
  }
  return "disconnected";
}

/** Mobile adapter into the shared machine-catalog policy. */
export function buildMobileNativeWorkspaceCatalog(input: {
  readonly nodes: ReadonlyArray<CachedHubNodeRecord>;
  readonly connections: ReadonlyArray<MobileHostedConnectionState>;
  readonly trustByEnvironmentId: ReadonlyMap<string, WorkspaceNativeTrustState>;
  readonly deliveryUnknownEnvironmentIds?: ReadonlyArray<EnvironmentId>;
}): ReadonlyArray<WorkspaceMachineCatalogEntry> {
  const connections = new Map(
    input.connections.map((connection) => [connection.environmentId, connection] as const),
  );
  const deliveryUnknown = new Set(input.deliveryUnknownEnvironmentIds ?? []);
  return reconcileWorkspaceMachineCatalog(
    input.nodes.map((node) => {
      const connection = connections.get(node.environmentId);
      return {
        environmentId: node.environmentId,
        nodeId: node.nodeId,
        label: node.label,
        clientTier: "native" as const,
        nativeTrust: input.trustByEnvironmentId.get(node.environmentId) ?? "unknown",
        requiresNativeVerification: true,
        effectiveRole: connection?.effectiveRole ?? node.effectiveRole,
        // Directory presence is independent of relay connection state.
        online: node.presenceOnline,
        lastSeenAt: node.lastHeartbeatAt ?? node.lastAuthenticatedAt,
        observedAt: node.observedAt,
        connectionState: connectionState(connection),
        deliveryUnknown:
          connection?.sessionStatus === "delivery-unknown" ||
          deliveryUnknown.has(node.environmentId),
        revokedAt: node.revokedAt,
        removed: false,
      };
    }),
  );
}
