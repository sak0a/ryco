import type { HostedNodeLifecycle } from "@ryco/client-runtime/authorization";
import type { EnvironmentId } from "@ryco/contracts";

import { clearCheckpointDiffState } from "../rpc/checkpointDiffAtoms";
import { createMobileConnectionRegistry } from "../runtime/bootstrap";
import { useStore } from "../state/threadsRuntime";
import { writePrimaryEnvironmentDescriptor } from "./primaryEnvironment";

/**
 * The hosted plane's node lifecycle.
 *
 * The runtime owns teardown/turn-up ordering (`authorization/environment.ts`);
 * the app must not second-guess it. `activate`/`suspend`/`deactivate` are
 * intentionally no-ops, matching web: writing the descriptor and connecting the
 * primary environment is what actually does the work.
 */

function supervisor() {
  return createMobileConnectionRegistry().driver.supervisor;
}

/**
 * Clear only per-node UI/query caches.
 *
 * Two-plane isolation: this must never touch the direct plane's saved
 * -environment catalog, its registry/runtime stores, or its bearer tokens.
 * Those belong to the direct plane and survive a hosted node switch.
 */
function clearNodeScopedState(environmentId: EnvironmentId): void {
  supervisor().disposeThreadDetailSubscriptionsForEnvironment(environmentId);
  useStore.getState().removeEnvironmentState(environmentId);
  clearCheckpointDiffState();
}

export const mobileHostedNodeLifecycle: HostedNodeLifecycle = {
  activate: async () => undefined,
  suspend: async () => undefined,
  deactivate: async () => undefined,
  clearNodeScopedState,
  writePrimaryEnvironmentDescriptor,
  connectPrimaryEnvironment: () => {
    supervisor().connectPrimary();
  },
  disconnectPrimaryEnvironment: async () => {
    await supervisor().disconnectPrimary();
  },
  setActiveEnvironmentId: (environmentId) => {
    useStore.getState().setActiveEnvironmentId(environmentId);
  },
};
