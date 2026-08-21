import type { EnvironmentId } from "@ryco/contracts";

// Mobile-local workspace model (§3-1). Upstream sourced these from the atom
// the atom `state/workspace` + upstream shell state; runtime A has no
// such object, so `useWorkspaceState` synthesizes this shape from the catalog
// stores + the single-socket ws UI state, and the pure helpers below are ported
// verbatim. `EnvironmentConnectionPhase`/`NetworkStatus`/`ShellSummary` are
// mobile-local presentation types (no `@ryco/client-runtime/connection` export).

export type NetworkStatus = "online" | "offline";
export type EnvironmentConnectionPhase =
  | "available"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "offline"
  | "error";

export interface WorkspaceEnvironment {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly connectionState: EnvironmentConnectionPhase;
  readonly connectionError: string | null;
}

export interface WorkspaceShellSummary {
  readonly hasSnapshot: boolean;
  readonly hasSynchronizingShell: boolean;
  readonly firstError: string | null;
  readonly latestSnapshotUpdatedAt: string | null;
}

export interface WorkspaceState {
  readonly isLoadingConnections: boolean;
  readonly hasConnections: boolean;
  readonly hasLoadedShellSnapshot: boolean;
  readonly hasPendingShellSnapshot: boolean;
  readonly hasReadyEnvironment: boolean;
  readonly hasConnectingEnvironment: boolean;
  readonly connectingEnvironments: ReadonlyArray<WorkspaceEnvironment>;
  readonly connectionState: EnvironmentConnectionPhase;
  readonly connectionError: string | null;
  readonly shellSnapshotError: string | null;
  readonly latestCachedSnapshotReceivedAt: string | null;
  readonly networkStatus: NetworkStatus;
}

function overallConnectionState(
  environments: ReadonlyArray<WorkspaceEnvironment>,
  networkStatus: NetworkStatus,
): EnvironmentConnectionPhase {
  if (environments.length === 0) return "available";
  if (networkStatus === "offline") return "offline";
  if (environments.some((environment) => environment.connectionState === "connected")) {
    return "connected";
  }
  if (environments.some((environment) => environment.connectionState === "reconnecting")) {
    return "reconnecting";
  }
  if (environments.some((environment) => environment.connectionState === "connecting")) {
    return "connecting";
  }
  if (environments.some((environment) => environment.connectionState === "error")) return "error";
  if (environments.some((environment) => environment.connectionState === "offline")) {
    return "offline";
  }
  return "available";
}

export function projectWorkspaceState(input: {
  readonly isReady: boolean;
  readonly networkStatus: NetworkStatus;
  readonly environments: ReadonlyArray<WorkspaceEnvironment>;
  readonly shellSummary: WorkspaceShellSummary;
}): WorkspaceState {
  const connectingEnvironments = input.environments.filter(
    (environment) =>
      environment.connectionState === "connecting" ||
      environment.connectionState === "reconnecting",
  );

  return {
    isLoadingConnections: !input.isReady,
    hasConnections: input.environments.length > 0,
    hasLoadedShellSnapshot: input.shellSummary.hasSnapshot,
    hasPendingShellSnapshot: input.shellSummary.hasSynchronizingShell,
    hasReadyEnvironment:
      input.networkStatus !== "offline" &&
      input.environments.some((environment) => environment.connectionState === "connected"),
    hasConnectingEnvironment: connectingEnvironments.length > 0,
    connectingEnvironments,
    connectionState: overallConnectionState(input.environments, input.networkStatus),
    connectionError:
      input.environments.find((environment) => environment.connectionError !== null)
        ?.connectionError ?? null,
    shellSnapshotError: input.shellSummary.firstError,
    latestCachedSnapshotReceivedAt: input.shellSummary.latestSnapshotUpdatedAt,
    networkStatus: input.networkStatus,
  };
}

// ─── Hosted plane ────────────────────────────────────────────────────────────
//
// `useWorkspaceState` builds its environment list from the DIRECT plane's
// saved-environment catalog, and the hosted plane never writes to those stores —
// that isolation is deliberate (hostedHub/nodeLifecycle.ts). The consequence was
// a lie on screen: with a Hub-relay-only node selected and serving data, the
// workspace saw zero environments and the Inbox header said "Not connected"
// while the thread it linked to said "Ready".
//
// The fix projects the hosted node into the workspace vocabulary at the read
// boundary. Nothing is written back into the direct stores, so the two planes
// stay isolated; they only meet in this derivation.

/** What `hostedState` in homeEnvironmentModel produces. */
export type HostedConnectionState = "connected" | "reconnecting" | "offline" | "read-only";

export function hostedWorkspacePhase(state: HostedConnectionState): EnvironmentConnectionPhase {
  switch (state) {
    case "connected":
    // `read-only` is a REACHABLE node. This banner answers "can I reach a
    // node", not "may I write to it" — a viewer-role device that can see its
    // threads is connected, and saying otherwise is the same lie in a
    // narrower case.
    case "read-only":
      return "connected";
    case "reconnecting":
      return "reconnecting";
    case "offline":
      return "offline";
  }
}

/**
 * Merge the hosted environments into the direct list.
 *
 * A node can be reachable on BOTH planes at once — paired directly and also
 * enrolled in the Hub — and the Hub descriptor reuses the same environment id.
 * Hosted wins, matching how `buildHomeEnvironments` already resolves the same
 * collision, so the two derivations cannot disagree about one node.
 */
export function mergeWorkspaceEnvironments(
  direct: ReadonlyArray<WorkspaceEnvironment>,
  hosted: ReadonlyArray<WorkspaceEnvironment>,
): ReadonlyArray<WorkspaceEnvironment> {
  if (hosted.length === 0) return direct;
  const hostedIds = new Set(hosted.map((environment) => environment.environmentId));
  const merged = direct.filter((environment) => !hostedIds.has(environment.environmentId));
  return [...merged, ...hosted];
}
