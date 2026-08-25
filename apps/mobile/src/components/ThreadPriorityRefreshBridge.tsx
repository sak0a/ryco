import { getWsConnectionStatusForEnvironment } from "@ryco/client-runtime/rpc";
import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { mobileAppLifecycle } from "../platform/appLifecycle";
import { useConnectionRegistry } from "../providers/ConnectionRegistryProvider";
import { useWsConnectionOpenedCount } from "../rpc/wsConnectionState";
import { useEnvironmentServerConfigs } from "../state/environmentServerConfigs";
import { usePreferences } from "../state/preferencesStore";
import { selectSidebarThreadsAcrossEnvironments, useStore } from "../state/threadsRuntime";
import {
  configureMobileThreadPriorityRefresh,
  notifyMobileThreadPriorityEnvironmentsChanged,
  notifyMobileThreadPriorityInputChanged,
  setMobileThreadPriorityForeground,
  setMobileThreadPriorityRefreshEnvironments,
} from "../threadPriorityRefreshRuntime";

export function ThreadPriorityRefreshBridge() {
  const { driver } = useConnectionRegistry();
  const [connections, setConnections] = useState(() => driver.supervisor.list());
  const connectionOpenedCount = useWsConnectionOpenedCount();
  const configs = useEnvironmentServerConfigs();
  const preferences = usePreferences();
  const threads = useStore(useShallow(selectSidebarThreadsAcrossEnvironments));

  useEffect(
    () =>
      driver.supervisor.subscribe(() => {
        setConnections(driver.supervisor.list());
      }),
    [driver],
  );

  const environments = useMemo(() => {
    void connectionOpenedCount;
    return connections.map((connection) => {
      const status = getWsConnectionStatusForEnvironment(connection.environmentId);
      return {
        environmentId: connection.environmentId,
        generation: status.attemptCount,
        connected: status.phase === "connected",
        supported:
          configs.get(connection.environmentId)?.environment.capabilities.threadPriorityRanking ===
          true,
      };
    });
  }, [configs, connectionOpenedCount, connections]);

  useEffect(() => {
    setMobileThreadPriorityRefreshEnvironments(environments);
    void notifyMobileThreadPriorityEnvironmentsChanged();
  }, [environments]);

  useEffect(() => {
    void configureMobileThreadPriorityRefresh({
      enabled: preferences.aiFocusEnabled ?? false,
      intervalMs: preferences.aiFocusRefreshIntervalMs ?? 600_000,
    });
  }, [preferences.aiFocusEnabled, preferences.aiFocusRefreshIntervalMs]);

  useEffect(() => {
    notifyMobileThreadPriorityInputChanged();
  }, [threads]);

  useEffect(() => {
    void setMobileThreadPriorityForeground(mobileAppLifecycle.isForeground());
    return mobileAppLifecycle.subscribe((event) => {
      if (event === "background") void setMobileThreadPriorityForeground(false);
      if (event === "foreground" || event === "resume") {
        void setMobileThreadPriorityForeground(true);
      }
    });
  }, []);

  return null;
}
