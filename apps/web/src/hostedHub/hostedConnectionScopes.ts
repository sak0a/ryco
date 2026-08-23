import type { EnvironmentId, ThreadId } from "@ryco/contracts";
import {
  UNIFIED_WORKSPACE_SCOPE_LEASE_TTL_MS,
  type WorkspaceConnectionScope,
} from "@ryco/client-runtime/state/workspace";

export const HOSTED_WEB_SCOPE_REPORT_INTERVAL_MS = 25_000;
export const HOSTED_WEB_SCOPE_LEASE_TTL_MS = UNIFIED_WORKSPACE_SCOPE_LEASE_TTL_MS;

export interface RetainedHostedWebScope {
  readonly key: string;
  readonly environmentId: EnvironmentId;
  readonly scope: WorkspaceConnectionScope;
  readonly refCount: number;
}

function scopeKey(environmentId: EnvironmentId, scope: WorkspaceConnectionScope): string {
  switch (scope.type) {
    case "thread-detail":
      return JSON.stringify([environmentId, scope.type, scope.threadId]);
    case "vcs-status":
      return JSON.stringify([environmentId, scope.type, scope.cwd]);
    case "provider-status":
      return JSON.stringify([environmentId, scope.type, scope.instanceId ?? null]);
  }
}

export interface HostedWebScopeStore {
  readonly retain: (environmentId: EnvironmentId, scope: WorkspaceConnectionScope) => () => void;
  readonly list: () => ReadonlyArray<RetainedHostedWebScope>;
  readonly subscribe: (listener: () => void) => () => void;
  readonly reset: () => void;
}

export function createHostedWebScopeStore(): HostedWebScopeStore {
  const entries = new Map<string, RetainedHostedWebScope>();
  const listeners = new Set<() => void>();
  const publish = () => {
    for (const listener of Array.from(listeners)) listener();
  };
  return {
    retain(environmentId, scope) {
      const key = scopeKey(environmentId, scope);
      const current = entries.get(key);
      entries.set(key, {
        key,
        environmentId,
        scope,
        refCount: (current?.refCount ?? 0) + 1,
      });
      if (!current) publish();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const active = entries.get(key);
        if (!active) return;
        if (active.refCount > 1) {
          entries.set(key, { ...active, refCount: active.refCount - 1 });
          return;
        }
        entries.delete(key);
        publish();
      };
    },
    list: () => Array.from(entries.values()),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reset() {
      if (entries.size === 0) return;
      entries.clear();
      publish();
    },
  };
}

export const hostedWebConnectionScopes = createHostedWebScopeStore();

export function retainHostedWorkspaceThreadScope(
  environmentId: EnvironmentId,
  threadId: ThreadId,
): () => void {
  return hostedWebConnectionScopes.retain(environmentId, { type: "thread-detail", threadId });
}

export function retainHostedWorkspaceVcsScope(
  environmentId: EnvironmentId,
  cwd: string,
): () => void {
  return hostedWebConnectionScopes.retain(environmentId, { type: "vcs-status", cwd });
}

export function retainHostedWorkspaceProviderScope(
  environmentId: EnvironmentId,
  instanceId?: string,
): () => void {
  return hostedWebConnectionScopes.retain(environmentId, {
    type: "provider-status",
    ...(instanceId ? { instanceId } : {}),
  });
}
