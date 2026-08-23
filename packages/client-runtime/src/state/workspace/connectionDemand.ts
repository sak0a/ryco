import type { EnvironmentId, ThreadId } from "@ryco/contracts";

/**
 * docs/relay-capacity-assessment-3b.md qualifies no more than three simultaneous
 * unified node connections. Platforms may choose a lower bound, never a higher one.
 */
export const UNIFIED_WORKSPACE_MAX_CONNECTIONS = 3;
export const UNIFIED_WORKSPACE_SCOPE_LEASE_TTL_MS = 45_000;

export type WorkspaceConnectionScope =
  | { readonly type: "thread-detail"; readonly threadId: ThreadId }
  | { readonly type: "vcs-status"; readonly cwd: string }
  | { readonly type: "provider-status"; readonly instanceId?: string };

export interface WorkspaceConnectionScopeLease {
  readonly leaseId: string;
  readonly environmentId: EnvironmentId;
  readonly scope: WorkspaceConnectionScope;
  readonly retainedAt: number;
  readonly expiresAt: number;
}

export interface WorkspaceDemandConnection {
  readonly environmentId: EnvironmentId;
  readonly connected: boolean;
  readonly lastAccessedAt: number;
}

export interface WorkspaceConnectionDemandState {
  readonly platformMaxConnections: number;
  readonly backgrounded: boolean;
  readonly leases: ReadonlyArray<WorkspaceConnectionScopeLease>;
  readonly connections: ReadonlyArray<WorkspaceDemandConnection>;
}

export interface WorkspaceConnectionDemandPlan {
  readonly state: WorkspaceConnectionDemandState;
  readonly retain: ReadonlyArray<EnvironmentId>;
  readonly release: ReadonlyArray<EnvironmentId>;
  readonly connect: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly delayMs: number;
  }>;
  readonly queued: ReadonlyArray<EnvironmentId>;
}

export function createWorkspaceConnectionDemandState(
  platformMaxConnections: number,
): WorkspaceConnectionDemandState {
  if (
    !Number.isInteger(platformMaxConnections) ||
    platformMaxConnections < 1 ||
    platformMaxConnections > UNIFIED_WORKSPACE_MAX_CONNECTIONS
  ) {
    throw new RangeError(
      `platformMaxConnections must be between 1 and ${UNIFIED_WORKSPACE_MAX_CONNECTIONS}`,
    );
  }
  return { platformMaxConnections, backgrounded: false, leases: [], connections: [] };
}

function upsertConnection(
  state: WorkspaceConnectionDemandState,
  environmentId: EnvironmentId,
  update: (current: WorkspaceDemandConnection) => WorkspaceDemandConnection,
): WorkspaceConnectionDemandState {
  const current = state.connections.find((entry) => entry.environmentId === environmentId) ?? {
    environmentId,
    connected: false,
    lastAccessedAt: 0,
  };
  return {
    ...state,
    connections: [
      ...state.connections.filter((entry) => entry.environmentId !== environmentId),
      update(current),
    ],
  };
}

export function touchWorkspaceEnvironment(
  state: WorkspaceConnectionDemandState,
  environmentId: EnvironmentId,
  now: number,
): WorkspaceConnectionDemandState {
  return upsertConnection(state, environmentId, (current) => ({
    ...current,
    lastAccessedAt: Math.max(current.lastAccessedAt, now),
  }));
}

export function setWorkspaceEnvironmentConnected(
  state: WorkspaceConnectionDemandState,
  environmentId: EnvironmentId,
  connected: boolean,
  now: number,
): WorkspaceConnectionDemandState {
  return upsertConnection(state, environmentId, (current) => ({
    ...current,
    connected,
    lastAccessedAt: Math.max(current.lastAccessedAt, now),
  }));
}

export function retainWorkspaceConnectionScope(
  state: WorkspaceConnectionDemandState,
  input: {
    readonly leaseId: string;
    readonly environmentId: EnvironmentId;
    readonly scope: WorkspaceConnectionScope;
    readonly now: number;
    readonly ttlMs?: number;
  },
): WorkspaceConnectionDemandState {
  if (input.leaseId.length === 0) throw new TypeError("leaseId must not be empty");
  if (state.leases.some((lease) => lease.leaseId === input.leaseId)) {
    throw new Error(`Duplicate workspace connection lease: ${input.leaseId}`);
  }
  const ttlMs = input.ttlMs ?? UNIFIED_WORKSPACE_SCOPE_LEASE_TTL_MS;
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new RangeError("ttlMs must be positive");
  return touchWorkspaceEnvironment(
    {
      ...state,
      leases: [
        ...state.leases,
        {
          leaseId: input.leaseId,
          environmentId: input.environmentId,
          scope: input.scope,
          retainedAt: input.now,
          expiresAt: input.now + ttlMs,
        },
      ],
    },
    input.environmentId,
    input.now,
  );
}

export function renewWorkspaceConnectionScope(
  state: WorkspaceConnectionDemandState,
  leaseId: string,
  now: number,
  ttlMs = UNIFIED_WORKSPACE_SCOPE_LEASE_TTL_MS,
): WorkspaceConnectionDemandState {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new RangeError("ttlMs must be positive");
  return {
    ...state,
    leases: state.leases.map((lease) =>
      lease.leaseId === leaseId ? { ...lease, expiresAt: now + ttlMs } : lease,
    ),
  };
}

export function releaseWorkspaceConnectionScope(
  state: WorkspaceConnectionDemandState,
  leaseId: string,
): WorkspaceConnectionDemandState {
  return { ...state, leases: state.leases.filter((lease) => lease.leaseId !== leaseId) };
}

export function setWorkspaceConnectionBackgrounded(
  state: WorkspaceConnectionDemandState,
  backgrounded: boolean,
): WorkspaceConnectionDemandState {
  return state.backgrounded === backgrounded ? state : { ...state, backgrounded };
}

export function pruneExpiredWorkspaceConnectionScopes(
  state: WorkspaceConnectionDemandState,
  now: number,
): WorkspaceConnectionDemandState {
  const leases = state.leases.filter((lease) => lease.expiresAt > now);
  return leases.length === state.leases.length ? state : { ...state, leases };
}

export function workspaceConnectionScopeRefCounts(
  state: WorkspaceConnectionDemandState,
  now: number,
): ReadonlyArray<{
  readonly environmentId: EnvironmentId;
  readonly scope: WorkspaceConnectionScope;
  readonly refCount: number;
}> {
  const active = pruneExpiredWorkspaceConnectionScopes(state, now).leases;
  const counts = new Map<
    string,
    { environmentId: EnvironmentId; scope: WorkspaceConnectionScope; refCount: number }
  >();
  for (const lease of active) {
    const key = JSON.stringify([lease.environmentId, lease.scope]);
    const current = counts.get(key);
    counts.set(key, {
      environmentId: lease.environmentId,
      scope: lease.scope,
      refCount: (current?.refCount ?? 0) + 1,
    });
  }
  return Array.from(counts.values());
}

export function planWorkspaceConnectionDemand(
  source: WorkspaceConnectionDemandState,
  input: { readonly now: number; readonly wakeStaggerMs?: number },
): WorkspaceConnectionDemandPlan {
  const state = pruneExpiredWorkspaceConnectionScopes(source, input.now);
  const retainedAtByEnvironment = new Map<EnvironmentId, number>();
  for (const lease of state.leases) {
    retainedAtByEnvironment.set(
      lease.environmentId,
      Math.max(retainedAtByEnvironment.get(lease.environmentId) ?? 0, lease.retainedAt),
    );
  }
  const retained = Array.from(retainedAtByEnvironment.keys());
  const retainedSet = new Set(retained);
  const connected = state.connections.filter((entry) => entry.connected);
  const connectedSet = new Set(connected.map((entry) => entry.environmentId));
  const nonRetainedConnected = connected
    .filter((entry) => !retainedSet.has(entry.environmentId))
    .toSorted(
      (left, right) =>
        left.lastAccessedAt - right.lastAccessedAt ||
        String(left.environmentId).localeCompare(String(right.environmentId)),
    );
  const missingRetained = retained
    .filter((environmentId) => !connectedSet.has(environmentId))
    .toSorted((left, right) => {
      const recency =
        (retainedAtByEnvironment.get(right) ?? 0) - (retainedAtByEnvironment.get(left) ?? 0);
      return recency || String(left).localeCompare(String(right));
    });

  const release: EnvironmentId[] = [];
  if (state.backgrounded) {
    release.push(...nonRetainedConnected.map((entry) => entry.environmentId));
    return {
      state,
      retain: retained.filter((environmentId) => connectedSet.has(environmentId)),
      release,
      connect: [],
      queued: missingRetained,
    };
  }

  let projectedConnected = connected.length;
  const victims = [...nonRetainedConnected];
  while (
    victims.length > 0 &&
    (projectedConnected > state.platformMaxConnections ||
      projectedConnected + missingRetained.length > state.platformMaxConnections)
  ) {
    const victim = victims.shift()!;
    release.push(victim.environmentId);
    projectedConnected -= 1;
  }

  const available = Math.max(0, state.platformMaxConnections - projectedConnected);
  const connectNow = missingRetained.slice(0, available);
  const wakeStaggerMs = Math.max(0, input.wakeStaggerMs ?? 0);
  return {
    state,
    retain: retained.filter((environmentId) => connectedSet.has(environmentId)),
    release,
    connect: connectNow.map((environmentId, index) => ({
      environmentId,
      delayMs: index * wakeStaggerMs,
    })),
    queued: missingRetained.slice(connectNow.length),
  };
}
