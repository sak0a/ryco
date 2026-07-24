import { useMemo, useSyncExternalStore } from "react";

import { getWsConnectionUiState } from "@ryco/client-runtime/rpc";
import type {
  SavedEnvironmentRecord,
  SavedEnvironmentRuntimeState,
} from "@ryco/client-runtime/connection";

import {
  createEnvironmentActions,
  type EnvironmentActions,
} from "../../connection/environmentActions";
import { useConnectionRegistry } from "../../providers/ConnectionRegistryProvider";
import { useWsConnectionStatus } from "../../rpc/wsConnectionState";
import { connectionToneForEnvironment } from "./connectionTone";
import { resolveAppPairingTarget } from "./pairingTarget";
import type { StatusTone } from "../../components/StatusPill";

// Registry-hook rewrite (§2 Connections D / §3-24): reads the catalog stores via
// useSyncExternalStore and composes the tested environmentActions. Never surfaces
// a bearer token — rows carry label/url/state only (§3-25 secret boundary).
export interface ConnectionRow {
  readonly record: SavedEnvironmentRecord;
  readonly runtime: SavedEnvironmentRuntimeState;
  readonly tone: StatusTone;
  readonly statusLabel: string;
}

export function useConnectionActions(): EnvironmentActions {
  const registry = useConnectionRegistry();
  return useMemo(
    () => createEnvironmentActions({ registry, resolvePairingTarget: resolveAppPairingTarget }),
    [registry],
  );
}

export function useSavedEnvironments(): {
  readonly rows: ReadonlyArray<ConnectionRow>;
  readonly isLoading: boolean;
} {
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
  const wsUiState = getWsConnectionUiState(wsStatus);

  const rows = Object.values(registryState.byId).map((record): ConnectionRow => {
    const runtime = catalog.getRuntime(record.environmentId);
    const tone = connectionToneForEnvironment(runtime.connectionState, wsUiState);
    const statusLabel = runtime.authState === "requires-auth" ? "Needs pairing" : tone.label;
    return { record, runtime, tone, statusLabel };
  });
  // runtimeState referenced so the store subscription re-renders on runtime change.
  void runtimeState;

  return { rows, isLoading: !catalog.hasHydrated() };
}
