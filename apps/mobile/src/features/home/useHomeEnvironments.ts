import { useMemo, useSyncExternalStore } from "react";
import { useShallow } from "zustand/react/shallow";

import {
  getCachedHubNodeRoster,
  subscribeCachedHubNodeRoster,
} from "../../hostedHub/nodeRoster";
import { useHostedHubStore } from "../../hostedHub/state";
import { selectCacheHydratedEnvironmentIds, useStore } from "../../state/threadsRuntime";
import { useSavedEnvironments } from "../connection/useConnectionController";
import { buildHomeEnvironments } from "./homeEnvironmentModel";

export function useHomeEnvironments() {
  const { rows: directRows } = useSavedEnvironments();
  const hosted = useHostedHubStore(
    useShallow((state) => ({
      selectedNode: state.selectedNode,
      effectiveRole: state.effectiveRole,
      transportStatus: state.transportStatus,
      sessionStatus: state.sessionStatus,
    })),
  );
  // Wave 2: the persisted Hub node roster puts every known node in the list —
  // not just the selected one — so cached content always has a label to render
  // against; cache-provenance ids mark which environments are last-known state.
  const rosterNodes = useSyncExternalStore(subscribeCachedHubNodeRoster, getCachedHubNodeRoster);
  const cacheProvenanceEnvironmentIds = useStore(useShallow(selectCacheHydratedEnvironmentIds));

  return useMemo(
    () =>
      buildHomeEnvironments({
        direct: directRows.map((row) => ({
          environmentId: row.record.environmentId,
          label: row.record.label,
          connectionState: row.runtime.connectionState,
          role: row.runtime.role,
        })),
        hosted: hosted.selectedNode
          ? {
              environmentId: hosted.selectedNode.environmentId,
              label: hosted.selectedNode.label,
              transportStatus: hosted.transportStatus,
              sessionStatus: hosted.sessionStatus,
              role: hosted.effectiveRole,
            }
          : null,
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
      }),
    [cacheProvenanceEnvironmentIds, directRows, hosted, rosterNodes],
  );
}
