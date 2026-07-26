import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import { useHostedHubStore } from "../../hostedHub/state";
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
      }),
    [directRows, hosted],
  );
}
