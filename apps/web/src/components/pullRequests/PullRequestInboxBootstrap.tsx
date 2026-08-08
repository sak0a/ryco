import {
  applyPullRequestSnapshot,
  markPullRequestEnvironmentStale,
} from "@ryco/client-runtime/state/pullRequests";
import { useEffect } from "react";

import {
  listEnvironmentConnections,
  subscribeEnvironmentConnections,
} from "~/environments/runtime";

/**
 * Keeps the repository-aware PR projection warm for contextual badges even
 * when the dedicated inbox route has never been opened.
 */
export function PullRequestInboxBootstrap() {
  useEffect(() => {
    const active = new Map<
      string,
      {
        readonly connection: ReturnType<typeof listEnvironmentConnections>[number];
        readonly unsubscribe: () => void;
      }
    >();

    const sync = () => {
      const connections = listEnvironmentConnections();

      for (const [environmentId, subscription] of active) {
        const connection = connections.find(
          (candidate) => candidate.environmentId === environmentId,
        );
        if (connection === subscription.connection) continue;
        subscription.unsubscribe();
        active.delete(environmentId);
        markPullRequestEnvironmentStale(subscription.connection.environmentId);
      }

      for (const connection of connections) {
        if (active.has(connection.environmentId)) continue;
        const environmentId = connection.environmentId;
        const unsubscribe = connection.client.pullRequests.subscribeInbox(
          (snapshot) => applyPullRequestSnapshot(environmentId, snapshot),
          {
            onResubscribe: () => markPullRequestEnvironmentStale(environmentId),
            onError: () => markPullRequestEnvironmentStale(environmentId),
          },
        );
        active.set(environmentId, { connection, unsubscribe });
      }
    };

    sync();
    const unsubscribeConnections = subscribeEnvironmentConnections(sync);
    return () => {
      unsubscribeConnections();
      for (const subscription of active.values()) subscription.unsubscribe();
      active.clear();
    };
  }, []);

  return null;
}
