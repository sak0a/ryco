import type { EnvironmentId } from "@ryco/contracts";

import type { InboxEnvironment } from "../inbox/inboxModel";

export interface DirectHomeEnvironmentInput {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly connectionState: "connecting" | "connected" | "disconnected" | "error";
  readonly role: "client" | "owner" | null;
}

export interface HostedHomeEnvironmentInput {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly transportStatus:
    | "idle"
    | "requesting-ticket"
    | "connecting"
    | "authenticating"
    | "opening-channel"
    | "online"
    | "reconnecting"
    | "draining"
    | "terminal-failure";
  readonly sessionStatus:
    | "synchronizing"
    | "ready"
    | "stale"
    | "replaying"
    | "delivery-unknown"
    | "closed";
  readonly role: "viewer" | "operator" | "owner" | null;
}

/**
 * A Hub node known from the persisted roster (wave 2 amendment A): rendered
 * even with zero sockets open so cached content has a label, role and
 * last-known presence to hang off. Liveness here is Hub directory presence,
 * never relay-socket state — wave 1 proved the socket does not track node
 * reachability.
 */
export interface CachedHubNodeHomeEnvironmentInput {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly role: "viewer" | "operator" | "owner";
  readonly revokedAt: number | null;
  readonly presenceOnline: boolean;
  readonly lastHeartbeatAt: number | null;
  readonly lastAuthenticatedAt: number | null;
}

function directState(input: DirectHomeEnvironmentInput): InboxEnvironment["connectionState"] {
  if (input.connectionState === "connected") return "connected";
  if (input.connectionState === "connecting") return "reconnecting";
  return "offline";
}

export function hostedState(
  input: HostedHomeEnvironmentInput,
): InboxEnvironment["connectionState"] {
  if (input.transportStatus === "online" && input.sessionStatus === "ready") {
    return input.role === "viewer" ? "read-only" : "connected";
  }
  if (
    input.transportStatus === "requesting-ticket" ||
    input.transportStatus === "connecting" ||
    input.transportStatus === "authenticating" ||
    input.transportStatus === "opening-channel" ||
    input.transportStatus === "reconnecting" ||
    input.sessionStatus === "synchronizing" ||
    input.sessionStatus === "replaying"
  ) {
    return "reconnecting";
  }
  return "offline";
}

function relativeLastSeen(timestamp: number, now: number): string {
  const deltaMinutes = Math.floor((now - timestamp) / 60_000);
  if (deltaMinutes < 2) return "just now";
  if (deltaMinutes < 60) return `${deltaMinutes}m ago`;
  const deltaHours = Math.floor(deltaMinutes / 60);
  if (deltaHours < 24) return `${deltaHours}h ago`;
  return `${Math.floor(deltaHours / 24)}d ago`;
}

/**
 * The stale row treatment for a cached Hub node, from directory presence.
 * `lastHeartbeatAt === null` does not mean never — only a null
 * `lastAuthenticatedAt` does (same contract caveat the web display documents).
 */
export function cachedHubNodeStaleDetail(
  node: Pick<
    CachedHubNodeHomeEnvironmentInput,
    "presenceOnline" | "lastHeartbeatAt" | "lastAuthenticatedAt"
  >,
  now: number,
): string {
  if (node.presenceOnline) return "Online · cached";
  const lastSeenAt = node.lastHeartbeatAt ?? node.lastAuthenticatedAt;
  if (lastSeenAt === null) return "Offline · cached";
  return `Offline · last seen ${relativeLastSeen(lastSeenAt, now)}`;
}

export function buildHomeEnvironments(input: {
  readonly direct: ReadonlyArray<DirectHomeEnvironmentInput>;
  readonly hosted: HostedHomeEnvironmentInput | null;
  readonly cachedHubNodes?: ReadonlyArray<CachedHubNodeHomeEnvironmentInput>;
  /** Environments whose store rows are cache-provenance (no live snapshot yet). */
  readonly cacheProvenanceEnvironmentIds?: ReadonlyArray<EnvironmentId>;
  readonly now?: number;
}): ReadonlyArray<InboxEnvironment> {
  const now = input.now ?? Date.now();
  const cachedIds = new Set(input.cacheProvenanceEnvironmentIds ?? []);
  // Staleness is cache provenance alone — never gated on the transport state.
  // Amendment B: relay-socket state provably does not track node reachability,
  // and a dead node's transport can sit in "reconnecting" indefinitely. Rows
  // stay marked until a live snapshot clears the provenance stamp, however
  // hopeful the socket looks.
  const staleFields = (
    environmentId: EnvironmentId,
    detail: string,
  ): Pick<InboxEnvironment, "stale" | "staleDetail"> =>
    cachedIds.has(environmentId) ? { stale: true, staleDetail: detail } : {};

  const environments = new Map<EnvironmentId, InboxEnvironment>();
  for (const direct of input.direct) {
    environments.set(direct.environmentId, {
      environmentId: direct.environmentId,
      label: direct.label,
      connectionState: directState(direct),
      ...staleFields(direct.environmentId, "Offline · cached"),
    });
  }
  for (const node of input.cachedHubNodes ?? []) {
    if (node.revokedAt !== null) continue;
    if (environments.has(node.environmentId)) continue;
    environments.set(node.environmentId, {
      environmentId: node.environmentId,
      label: node.label,
      connectionState: "offline",
      ...staleFields(node.environmentId, cachedHubNodeStaleDetail(node, now)),
    });
  }
  if (input.hosted) {
    const rosterNode = (input.cachedHubNodes ?? []).find(
      (node) => node.environmentId === input.hosted?.environmentId,
    );
    environments.set(input.hosted.environmentId, {
      environmentId: input.hosted.environmentId,
      label: input.hosted.label,
      connectionState: hostedState(input.hosted),
      ...staleFields(
        input.hosted.environmentId,
        rosterNode ? cachedHubNodeStaleDetail(rosterNode, now) : "Offline · cached",
      ),
    });
  }
  return [...environments.values()];
}
