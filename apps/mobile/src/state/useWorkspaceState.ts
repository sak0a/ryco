import { useSyncExternalStore } from "react";
import { useShallow } from "zustand/react/shallow";

import { getWsConnectionUiState } from "@ryco/client-runtime/rpc";
import type { SavedEnvironmentConnectionState } from "@ryco/client-runtime/connection";

import { useConnectionRegistry } from "../providers/ConnectionRegistryProvider";
import { useWsConnectionStatus } from "../rpc/wsConnectionState";
import { hostedState } from "../features/home/homeEnvironmentModel";
import { useHostedHubStore } from "../hostedHub/state";
import {
  hostedWorkspacePhase,
  mergeWorkspaceEnvironments,
  projectWorkspaceState,
  type EnvironmentConnectionPhase,
  type NetworkStatus,
  type WorkspaceEnvironment,
  type WorkspaceState,
} from "./workspaceModel";
import { selectBootstrapCompleteForActiveEnvironment, useStore } from "./threadsRuntime";

// §3-1: synthesize the WorkspaceState upstream read from the atom `state/workspace`
// from runtime A's building blocks — the saved-environment catalog stores, the
// single-socket ws UI state, and the active-environment bootstrap flag. Mobile is
// single-socket/single-active-env, so the ws overlay drives reconnecting/offline.

function mapConnectionPhase(state: SavedEnvironmentConnectionState): EnvironmentConnectionPhase {
  switch (state) {
    case "connected":
      return "connected";
    case "connecting":
      return "connecting";
    case "error":
      return "error";
    case "disconnected":
      return "offline";
  }
}

export function useWorkspaceState(): WorkspaceState {
  const { catalog } = useConnectionRegistry();
  const registryState = useSyncExternalStore(
    catalog.registryStore.subscribe,
    catalog.registryStore.getState,
    catalog.registryStore.getState,
  );
  const runtimeState = useSyncExternalStore(
    catalog.runtimeStore.subscribe,
    catalog.runtimeStore.getState,
    catalog.runtimeStore.getState,
  );
  const wsStatus = useWsConnectionStatus();
  const bootstrapComplete = useStore(selectBootstrapCompleteForActiveEnvironment);
  const hostedSnapshot = useHostedHubStore(
    useShallow((state) => ({
      selectedNode: state.selectedNode,
      effectiveRole: state.effectiveRole,
      transportStatus: state.transportStatus,
      sessionStatus: state.sessionStatus,
    })),
  );
  const hosted = hostedSnapshot.selectedNode
    ? {
        environmentId: hostedSnapshot.selectedNode.environmentId,
        label: hostedSnapshot.selectedNode.label,
        transportStatus: hostedSnapshot.transportStatus,
        sessionStatus: hostedSnapshot.sessionStatus,
        role: hostedSnapshot.effectiveRole,
      }
    : null;

  const wsUiState = getWsConnectionUiState(wsStatus);
  const networkStatus: NetworkStatus = wsUiState === "offline" ? "offline" : "online";
  const isReady = catalog.hasHydrated();

  const environments: WorkspaceEnvironment[] = Object.values(registryState.byId).map((record) => {
    const runtime = runtimeState.byId[record.environmentId];
    const basePhase: EnvironmentConnectionPhase = runtime
      ? mapConnectionPhase(runtime.connectionState)
      : "available";
    // The single socket's reconnecting/offline overlay wins for the active env.
    const phase: EnvironmentConnectionPhase =
      wsUiState === "reconnecting" && basePhase !== "connected" ? "reconnecting" : basePhase;
    return {
      environmentId: record.environmentId,
      environmentLabel: record.label,
      connectionState: phase,
      connectionError: runtime?.lastError ?? null,
    };
  });

  // The hosted plane keeps its own stores and never writes to the catalog above,
  // so without this the workspace sees no environments at all on a Hub-relay-only
  // setup and reports "Not connected" over a live relay.
  const hostedEnvironment: WorkspaceEnvironment | null = hosted
    ? {
        environmentId: hosted.environmentId,
        environmentLabel: hosted.label,
        connectionState: hostedWorkspacePhase(hostedState(hosted)),
        connectionError: null,
      }
    : null;
  const allEnvironments = mergeWorkspaceEnvironments(environments, hostedEnvironment);

  return projectWorkspaceState({
    isReady,
    networkStatus,
    environments: allEnvironments,
    shellSummary: {
      hasSnapshot: bootstrapComplete,
      hasSynchronizingShell:
        allEnvironments.some((environment) => environment.connectionState === "connected") &&
        !bootstrapComplete,
      firstError: null,
      latestSnapshotUpdatedAt: null,
    },
  });
}
