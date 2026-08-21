import type { EnvironmentId } from "@ryco/contracts";

import { clearCheckpointDiffState } from "../rpc/checkpointDiffAtoms";
import { useStore } from "../state/threadsRuntime";

/** Demote one disconnected hosted environment without touching another plane. */
export function demoteMobileHostedEnvironmentState(environmentId: EnvironmentId): void {
  useStore.getState().demoteEnvironmentStateToCachedSnapshot(environmentId, Date.now());
  clearCheckpointDiffState();
}
