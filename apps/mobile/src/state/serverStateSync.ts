import { useEffect, useSyncExternalStore } from "react";

import { clearServerState, startServerStateSync } from "@ryco/client-runtime/rpc";
import type { EnvironmentConnection } from "@ryco/client-runtime/connection";

import { useConnectionRegistry } from "../providers/ConnectionRegistryProvider";
import { useStore } from "./threadsRuntime";

// §3-20 (ratified single-active-env): the mobile analogue of the web
// ServerStateBootstrap. serverConfigAtom is a single global atom fed for one
// environment; mobile has no primary, so we sync the ACTIVE environment's server
// state. startServerStateSync is a bound wrapper started/stopped with the
// connection; clearServerState runs on switch/teardown. No import-time side effect.
export function useServerStateSync(): void {
  const { driver } = useConnectionRegistry();
  const activeEnvironmentId = useStore((state) => state.activeEnvironmentId);

  const readConnection = (): EnvironmentConnection | null =>
    activeEnvironmentId ? driver.supervisor.read(activeEnvironmentId) : null;

  const connection = useSyncExternalStore(
    driver.supervisor.subscribe,
    readConnection,
    readConnection,
  );

  useEffect(() => {
    if (!connection) return;
    const stop = startServerStateSync(connection.client.server);
    return () => {
      stop();
      clearServerState();
    };
  }, [connection]);
}

/** Mountable form (App root): drives the active-environment server-state sync. */
export function ServerStateBootstrap(): null {
  useServerStateSync();
  return null;
}
