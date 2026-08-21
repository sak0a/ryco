import { useMemo, useSyncExternalStore } from "react";
import { useShallow } from "zustand/react/shallow";

import { getCachedHubNodeRoster, subscribeCachedHubNodeRoster } from "../../hostedHub/nodeRoster";
import { useMobileHostedConnectionsStore } from "../../hostedHub/state";
import { selectCacheHydratedEnvironmentIds, useStore } from "../../state/threadsRuntime";
import { useSavedEnvironments } from "../connection/useConnectionController";
import { buildHomeEnvironments } from "./homeEnvironmentModel";
import { useNodeTrust } from "./useNodeTrust";

export function useHomeEnvironments() {
  const { rows: directRows } = useSavedEnvironments();
  const hosted = useMobileHostedConnectionsStore(
    useShallow((state) => ({
      selectedNodes: state.selectedNodes,
      deliveryUnknownEnvironmentIds: state.deliveryUnknownEnvironmentIds,
    })),
  );
  // Wave 2: the persisted Hub node roster puts every known node in the list —
  // not just the selected one — so cached content always has a label to render
  // against; cache-provenance ids mark which environments are last-known state.
  const rosterNodes = useSyncExternalStore(subscribeCachedHubNodeRoster, getCachedHubNodeRoster);
  const cacheProvenanceEnvironmentIds = useStore(useShallow(selectCacheHydratedEnvironmentIds));
  // Wave 4: trust is keyed by the roster's Hub-minted node id, which is why the
  // roster records go in whole rather than the environment ids alone. The store
  // snapshot is a stable reference between commits, so this does not re-derive
  // per render.
  const trustByEnvironmentId = useNodeTrust(rosterNodes);

  return useMemo(
    () =>
      buildHomeEnvironments({
        direct: directRows.map((row) => ({
          environmentId: row.record.environmentId,
          label: row.record.label,
          connectionState: row.runtime.connectionState,
          role: row.runtime.role,
        })),
        hosted: hosted.selectedNodes.map((connection) => ({
          environmentId: connection.environmentId,
          label: connection.label,
          transportStatus: connection.transportStatus,
          sessionStatus: connection.sessionStatus,
          role: connection.effectiveRole,
        })),
        cachedHubNodes: rosterNodes.map((node) => ({
          environmentId: node.environmentId,
          label: node.label,
          role: node.effectiveRole,
          revokedAt: node.revokedAt,
          presenceOnline: node.presenceOnline,
          lastHeartbeatAt: node.lastHeartbeatAt,
          lastAuthenticatedAt: node.lastAuthenticatedAt,
        })),
        cacheProvenanceEnvironmentIds,
        deliveryUnknownEnvironmentIds: hosted.deliveryUnknownEnvironmentIds,
        trustByEnvironmentId,
      }),
    [cacheProvenanceEnvironmentIds, directRows, hosted, rosterNodes, trustByEnvironmentId],
  );
}
