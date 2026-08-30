import type { EnvironmentId } from "@ryco/contracts";
import {
  fenceActiveKeyedQueriesForEnvironment,
  refreshActiveKeyedQueriesForEnvironment,
} from "@ryco/client-runtime/rpc";
import type { HostedHubState } from "@ryco/client-runtime/authorization";

import { defaultQueryClient } from "./queryClient";

export interface EnvironmentQueryRefreshBackend {
  readonly fence: (environmentId: EnvironmentId) => void;
  readonly refresh: (environmentId: EnvironmentId) => Promise<void>;
}

export interface EnvironmentQueryRefreshCoordinator {
  readonly begin: (environmentId: EnvironmentId) => number;
  readonly ready: (
    environmentId: EnvironmentId,
    generation: number,
    isAuthoritativelyReady?: () => boolean,
  ) => Promise<boolean>;
  readonly resetForTests: () => void;
}

export interface HostedEnvironmentQueryRefreshState {
  readonly generation: number;
  readonly selectedNode: { readonly environmentId: EnvironmentId } | null;
  readonly directoryStatus: HostedHubState["directoryStatus"];
  readonly selectionStatus: HostedHubState["selectionStatus"];
  readonly transportStatus: HostedHubState["transportStatus"];
  readonly sessionStatus: HostedHubState["sessionStatus"];
  readonly sessionEstablished: boolean;
  readonly browserStatus: HostedHubState["browserStatus"];
}

export function isHostedEnvironmentQueryRefreshReady(
  state: HostedEnvironmentQueryRefreshState,
  environmentId: EnvironmentId,
  generation: number,
): boolean {
  return (
    state.generation === generation &&
    state.selectedNode?.environmentId === environmentId &&
    state.directoryStatus === "ready" &&
    state.selectionStatus === "online" &&
    state.transportStatus === "online" &&
    state.sessionStatus === "ready" &&
    state.sessionEstablished &&
    state.browserStatus === "current"
  );
}

export function createEnvironmentQueryRefreshCoordinator(
  backend: EnvironmentQueryRefreshBackend,
): EnvironmentQueryRefreshCoordinator {
  const generations = new Map<EnvironmentId, number>();
  const completed = new Map<EnvironmentId, number>();
  const refreshes = new Map<EnvironmentId, { generation: number; promise: Promise<boolean> }>();

  return {
    begin(environmentId) {
      const generation = (generations.get(environmentId) ?? 0) + 1;
      generations.set(environmentId, generation);
      refreshes.delete(environmentId);
      backend.fence(environmentId);
      return generation;
    },
    ready(environmentId, generation, isAuthoritativelyReady = () => true) {
      if (generations.get(environmentId) !== generation || !isAuthoritativelyReady()) {
        return Promise.resolve(false);
      }
      const active = refreshes.get(environmentId);
      if (active?.generation === generation) return active.promise;
      if (completed.get(environmentId) === generation) return Promise.resolve(true);

      const promise = backend.refresh(environmentId).then(() => {
        if (generations.get(environmentId) !== generation) return false;
        completed.set(environmentId, generation);
        return true;
      });
      refreshes.set(environmentId, { generation, promise });
      const clearRefresh = () => {
        if (refreshes.get(environmentId)?.promise === promise) refreshes.delete(environmentId);
      };
      void promise.then(clearRefresh, clearRefresh);
      return promise;
    },
    resetForTests() {
      generations.clear();
      completed.clear();
      refreshes.clear();
    },
  };
}

export const environmentQueryRefresh = createEnvironmentQueryRefreshCoordinator({
  fence: (environmentId) => {
    defaultQueryClient.fenceActiveQueriesForEnvironment(environmentId);
    fenceActiveKeyedQueriesForEnvironment(environmentId);
  },
  refresh: async (environmentId) => {
    await Promise.all([
      defaultQueryClient.refreshActiveQueriesForEnvironment(environmentId),
      refreshActiveKeyedQueriesForEnvironment(environmentId),
    ]);
  },
});
