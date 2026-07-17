import { useEffect, useSyncExternalStore } from "react";

import {
  readEnvironmentConnection,
  subscribeEnvironmentConnections,
} from "../environments/runtime";
import { getPrimaryKnownEnvironment } from "../environments/primary";
import { startServerStateSync } from "../rpc/serverState";

function readPrimaryEnvironmentConnection() {
  const environmentId = getPrimaryKnownEnvironment()?.environmentId;
  return environmentId ? readEnvironmentConnection(environmentId) : null;
}

export function ServerStateBootstrap() {
  const connection = useSyncExternalStore(
    subscribeEnvironmentConnections,
    readPrimaryEnvironmentConnection,
    readPrimaryEnvironmentConnection,
  );

  useEffect(() => {
    if (!connection) return;
    return startServerStateSync(connection.client.server);
  }, [connection]);

  return null;
}
