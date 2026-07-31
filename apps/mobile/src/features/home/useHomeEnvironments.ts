import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import { useHostedHubStore } from "../../hostedHub/state";
import { usePrimaryEnvironmentDescriptor } from "../../hostedHub/primaryEnvironment";
import { readEnvironmentApi } from "../../connection/environmentApi";
import { useStore } from "../../state/threadsRuntime";
import { useSavedEnvironments } from "../connection/useConnectionController";
import { buildHomeEnvironments } from "./homeEnvironmentModel";

export function useHomeEnvironments() {
  const { rows: directRows } = useSavedEnvironments();
  const environmentStateById = useStore((state) => state.environmentStateById);
  const primaryDescriptor = usePrimaryEnvironmentDescriptor();
  const hosted = useHostedHubStore(
    useShallow((state) => ({
      selectedNode: state.selectedNode,
      effectiveRole: state.effectiveRole,
      transportStatus: state.transportStatus,
      sessionStatus: state.sessionStatus,
    })),
  );

  return useMemo(
    () =>
      buildHomeEnvironments({
        direct: directRows.map((row) => ({
          environmentId: row.record.environmentId,
          label: row.record.label,
          connectionState: row.runtime.connectionState,
          role: row.runtime.role,
          threadSettlementSupported: row.runtime.descriptor?.capabilities.threadSettlement ?? false,
          shellCurrent: environmentStateById[row.record.environmentId]?.bootstrapComplete === true,
          apiAvailable: readEnvironmentApi(row.record.environmentId) !== undefined,
        })),
        hosted: hosted.selectedNode
          ? {
              environmentId: hosted.selectedNode.environmentId,
              label: hosted.selectedNode.label,
              transportStatus: hosted.transportStatus,
              sessionStatus: hosted.sessionStatus,
              role: hosted.effectiveRole,
              threadSettlementSupported: primaryDescriptor?.capabilities.threadSettlement ?? false,
              shellCurrent:
                environmentStateById[hosted.selectedNode.environmentId]?.bootstrapComplete === true,
              apiAvailable: readEnvironmentApi(hosted.selectedNode.environmentId) !== undefined,
            }
          : null,
      }),
    [directRows, environmentStateById, hosted, primaryDescriptor],
  );
}
