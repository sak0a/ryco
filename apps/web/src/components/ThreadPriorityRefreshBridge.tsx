import { getWsConnectionStatusForEnvironment } from "@ryco/client-runtime/rpc";
import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import {
  listEnvironmentConnections,
  subscribeEnvironmentConnections,
  useSavedEnvironmentRuntimeStore,
} from "../environments/runtime";
import { getPrimaryKnownEnvironment } from "../environments/primary";
import { useSettings } from "../hooks/useSettings";
import { webAppLifecycle } from "../platform/appLifecycle";
import { useServerConfig } from "../rpc/serverState";
import { useWsConnectionOpenedCount } from "../rpc/wsConnectionState";
import { selectSidebarThreadsAcrossEnvironments, useStore } from "../store";
import {
  configureWebThreadPriorityRefresh,
  notifyWebThreadPriorityEnvironmentsChanged,
  notifyWebThreadPriorityInputChanged,
  setWebThreadPriorityForeground,
  setWebThreadPriorityRefreshEnvironments,
} from "../threadPriorityRefreshRuntime";

function useConnections() {
  const [connections, setConnections] = useState(() => listEnvironmentConnections());
  useEffect(
    () =>
      subscribeEnvironmentConnections(() => {
        setConnections(listEnvironmentConnections());
      }),
    [],
  );
  return connections;
}

/** Connects the platform-neutral ranking coordinator to browser lifecycle and live nodes. */
export function ThreadPriorityRefreshBridge() {
  const enabled = useSettings((settings) => settings.aiFocusEnabled);
  const intervalMs = useSettings((settings) => settings.aiFocusRefreshIntervalMs);
  const connections = useConnections();
  const connectionOpenedCount = useWsConnectionOpenedCount();
  const primaryConfig = useServerConfig();
  const savedRuntimeById = useSavedEnvironmentRuntimeStore((state) => state.byId);
  const threads = useStore(useShallow(selectSidebarThreadsAcrossEnvironments));

  const environments = useMemo(() => {
    // The opened counter is the cross-environment edge signal. Reading it here
    // recomputes keyed status even when the supervisor's connection list is unchanged.
    void connectionOpenedCount;
    return connections.map((connection) => {
      const environmentId = connection.environmentId;
      const status = getWsConnectionStatusForEnvironment(environmentId);
      const config =
        getPrimaryKnownEnvironment()?.environmentId === environmentId
          ? primaryConfig
          : (savedRuntimeById[environmentId]?.serverConfig ?? null);
      return {
        environmentId,
        generation: status.attemptCount,
        connected: status.phase === "connected",
        supported: config?.environment.capabilities.threadPriorityRanking === true,
      };
    });
  }, [connections, connectionOpenedCount, primaryConfig, savedRuntimeById]);

  useEffect(() => {
    setWebThreadPriorityRefreshEnvironments(environments);
    void notifyWebThreadPriorityEnvironmentsChanged();
  }, [environments]);

  useEffect(() => {
    void configureWebThreadPriorityRefresh({ enabled, intervalMs });
  }, [enabled, intervalMs]);

  useEffect(() => {
    notifyWebThreadPriorityInputChanged();
  }, [threads]);

  useEffect(() => {
    void setWebThreadPriorityForeground(webAppLifecycle.isForeground());
    return webAppLifecycle.subscribe((event) => {
      if (event === "background") void setWebThreadPriorityForeground(false);
      if (event === "foreground" || event === "resume") {
        void setWebThreadPriorityForeground(true);
      }
    });
  }, []);

  return null;
}
