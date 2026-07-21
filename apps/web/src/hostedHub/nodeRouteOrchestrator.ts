import { useEffect, useSyncExternalStore } from "react";

import {
  adoptRoutedHostedNode,
  clearHostedNodeRoute,
  enterHostedNodeRoute,
  getInstalledHostedNodeHistory,
  getRoutedHostedNode,
  subscribeRoutedHostedNode,
  type RoutedHostedNode,
} from "./nodeRoutes";
import { hostedHubController, useHostedHubStore } from "./state";

/**
 * Orchestrates the routed node segment against the hosted lifecycle owner.
 *
 * This module adds no second activation or readiness path: it only decides
 * *when* to invoke the existing controller primitives. A routed node is
 * restored strictly through the ordered fail-closed pipeline — restore Hub
 * session and refresh the authorized directory (existing bootstrap), validate
 * the routed id against the directory, then `selectNode`, which runs the
 * existing activation path (fresh one-use ticket → relay channel → canonical
 * state sync → mutation readiness gates). Routes that cannot be validated
 * fail closed to the node directory with a bounded notice.
 */

export type HostedNodeRouteNoticeKind = "unavailable" | "revoked" | "offline" | "invalid-link";

const HOSTED_NODE_ROUTE_NOTICE_COPY: Record<HostedNodeRouteNoticeKind, string> = {
  unavailable:
    "The node from this link is not in your authorized node directory. Choose a node to continue.",
  revoked: "Access to the node from this link was revoked. Choose a node to continue.",
  offline: "The node from this link is offline. Choose a node to continue.",
  "invalid-link": "This node link is not valid. Choose a node to continue.",
};

let notice: HostedNodeRouteNoticeKind | null = null;
const noticeSubscribers = new Set<() => void>();

function setNotice(next: HostedNodeRouteNoticeKind | null): void {
  if (notice === next) return;
  notice = next;
  // Snapshot so notification survives subscribe/unsubscribe during dispatch.
  for (const subscriber of Array.from(noticeSubscribers)) subscriber();
}

function subscribeNotice(subscriber: () => void): () => void {
  noticeSubscribers.add(subscriber);
  return () => {
    noticeSubscribers.delete(subscriber);
  };
}

export function getHostedNodeRouteNotice(): string | null {
  return notice === null ? null : HOSTED_NODE_ROUTE_NOTICE_COPY[notice];
}

export function useHostedNodeRouteNotice(): string | null {
  return useSyncExternalStore(subscribeNotice, getHostedNodeRouteNotice);
}

export function useRoutedHostedNode(): RoutedHostedNode {
  return useSyncExternalStore(subscribeRoutedHostedNode, getRoutedHostedNode);
}

/** Route segments that can never be a legacy `/$environmentId/$threadId` pair. */
const RESERVED_TOP_SEGMENTS = new Set(["node", "draft", "pair", "diagnostics"]);

function readLegacyThreadEnvironmentId(pathname: string): string | null {
  const match = /^\/([^/]+)\/([^/]+)\/?$/.exec(pathname);
  if (!match) return null;
  const raw = match[1] ?? "";
  if (RESERVED_TOP_SEGMENTS.has(raw)) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function isLegacyDraftPathname(pathname: string): boolean {
  return pathname.startsWith("/draft/");
}

/** Node id whose `selectNode` dispatch is currently in flight. */
let restoreRequestedNodeId: string | null = null;
/** Node id whose current selection was initiated by URL restore (not a click). */
let restoreOriginNodeId: string | null = null;
/** Node id the user just picked interactively (skips the presence fail-fast). */
let interactiveNodeId: string | null = null;
/** Guards compound transitions so reconcile observes only their final state. */
let reconcileSuspended = false;
/** Last observed account status, for clearing stale notices on sign-out. */
let lastAccountStatus: string | null = null;
/** Active orchestrator subscriptions; scheduled runs no-op at zero. */
let activeOrchestratorCount = 0;
let reconcilePending = false;

/**
 * Reconcile runs deferred on a microtask. Route publications fire as a side
 * effect of `parseLocation` inside the history's popstate handler, before the
 * history updates its own location closure and notifies subscribers; deferring
 * guarantees every reconcile observes post-notify history state and post-patch
 * store state, and coalesces the bursts a single navigation produces.
 */
function scheduleReconcile(): void {
  if (reconcilePending) return;
  reconcilePending = true;
  queueMicrotask(() => {
    reconcilePending = false;
    if (activeOrchestratorCount === 0) return;
    reconcile();
  });
}

function runExclusive(transition: () => void): void {
  reconcileSuspended = true;
  try {
    transition();
  } finally {
    reconcileSuspended = false;
  }
  scheduleReconcile();
}

function failClosed(
  selectionStatus: ReturnType<typeof useHostedHubStore.getState>["selectionStatus"],
  kind: HostedNodeRouteNoticeKind,
): void {
  restoreRequestedNodeId = null;
  restoreOriginNodeId = null;
  interactiveNodeId = null;
  // When the store already reports a terminal selection state the directory
  // renders its own bounded alert; avoid duplicate messaging.
  if (selectionStatus === "none" || selectionStatus === "online" || selectionStatus === "offline") {
    setNotice(kind);
  }
  clearHostedNodeRoute();
}

function reconcile(): void {
  if (reconcileSuspended) return;
  const history = getInstalledHostedNodeHistory();
  if (!history) return;
  const routed = getRoutedHostedNode();
  const state = useHostedHubStore.getState();

  if (routed.malformed) {
    // A malformed segment can never validate; normalize the URL immediately
    // and explain on the directory once it renders.
    setNotice("invalid-link");
    clearHostedNodeRoute();
    return;
  }

  if (state.accountStatus !== "authenticated") {
    // Authentication surfaces own the screen. The routed segment stays in the
    // URL so a re-authenticated session resumes it through this same
    // validation pipeline. A notice from the previous authenticated session
    // is stale once the account leaves it; keep only notices produced while
    // signed out (for example a normalized malformed link).
    if (lastAccountStatus === "authenticated") setNotice(null);
    lastAccountStatus = state.accountStatus;
    return;
  }
  lastAccountStatus = state.accountStatus;

  const nodeId = routed.nodeId;

  if (nodeId === null) {
    interactiveNodeId = null;
    if (state.selectedNode) {
      // The URL returned to the directory (history Back or a fail-closed
      // rewrite): tear the selection down through the lifecycle owner. A
      // terminal selection keeps its bounded explanation for the directory.
      restoreRequestedNodeId = null;
      restoreOriginNodeId = null;
      const terminalSelection =
        state.selectionStatus === "revoked" ||
        state.selectionStatus === "authorization-removed" ||
        state.selectionStatus === "incompatible";
      void hostedHubController.returnToDirectory(
        terminalSelection ? { preserveTerminalSelection: true } : undefined,
      );
      return;
    }
    // Use the logical pathname published together with the segment. Never
    // read history.location here: reconcile can run between a popstate parse
    // and the history's own location update, and a stale thread pathname
    // would be mapped straight back to the node that was just left.
    maybeRedirectLegacyLocation(routed.logicalPathname, state);
    return;
  }

  if (state.selectedNode?.id === nodeId) {
    restoreRequestedNodeId = null;
    interactiveNodeId = null;
    if (state.sessionEstablished) {
      restoreOriginNodeId = null;
      setNotice(null);
      return;
    }
    if (
      restoreOriginNodeId === nodeId &&
      state.transportStatus === "terminal-failure" &&
      (state.selectionStatus === "revoked" ||
        state.selectionStatus === "authorization-removed" ||
        state.selectionStatus === "incompatible")
    ) {
      // A URL-initiated restore ended in a terminal authorization or
      // compatibility failure before the session was established: fail closed
      // to the directory, keeping the existing bounded selection alert.
      restoreOriginNodeId = null;
      runExclusive(() => {
        clearHostedNodeRoute();
        void hostedHubController.returnToDirectory({ preserveTerminalSelection: true });
      });
    }
    return;
  }

  if (state.directoryStatus === "stale") {
    failClosed(state.selectionStatus, "unavailable");
    return;
  }
  if (state.directoryStatus !== "ready") return;
  // Known bounded transient: while the browser is suspended, a Back/Forward
  // segment change waits here, so a resume may first reconnect the previously
  // selected node before this reconcile switches to the routed one. The resume
  // path always ends in a store update that re-runs reconcile, and generation
  // guards serialize the switch, so the transient cannot publish stale
  // readiness or strand the UI.
  if (state.browserStatus !== "current") return;

  const node = state.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) {
    failClosed(state.selectionStatus, "unavailable");
    return;
  }
  if (node.revokedAt !== null) {
    failClosed(state.selectionStatus, "revoked");
    return;
  }
  const interactive = interactiveNodeId === nodeId;
  if (!node.presence.online && !interactive) {
    failClosed(state.selectionStatus, "offline");
    return;
  }
  if (restoreRequestedNodeId === nodeId) return;
  restoreRequestedNodeId = nodeId;
  restoreOriginNodeId = interactive ? null : nodeId;
  interactiveNodeId = null;
  setNotice(null);
  void hostedHubController.selectNode(node.id).finally(() => {
    if (restoreRequestedNodeId === nodeId) restoreRequestedNodeId = null;
  });
}

function maybeRedirectLegacyLocation(
  pathname: string,
  state: ReturnType<typeof useHostedHubStore.getState>,
): void {
  if (isLegacyDraftPathname(pathname)) {
    // Hosted drafts are memory-only and identify no node; the directory is
    // the only restorable surface for this legacy shape.
    clearHostedNodeRoute();
    return;
  }
  const environmentId = readLegacyThreadEnvironmentId(pathname);
  if (environmentId === null) return;
  if (state.directoryStatus === "stale") {
    setNotice("unavailable");
    clearHostedNodeRoute();
    return;
  }
  if (state.directoryStatus !== "ready") return;
  const node = state.nodes.find(
    (candidate) => candidate.environmentId === environmentId && candidate.revokedAt === null,
  );
  if (!node) {
    setNotice("unavailable");
    clearHostedNodeRoute();
    return;
  }
  // Upgrade the legacy URL in place; the next reconcile runs the restore
  // pipeline for the adopted segment.
  adoptRoutedHostedNode(node.id);
}

/**
 * Select a node from the directory or node menu by navigating into its
 * node-scoped route. Returns false when no hosted history is installed.
 */
export function selectHostedNodeRoute(nodeId: string): boolean {
  if (!getInstalledHostedNodeHistory()) return false;
  interactiveNodeId = nodeId;
  setNotice(null);
  return enterHostedNodeRoute(nodeId);
}

export function startHostedNodeRouteOrchestrator(): () => void {
  activeOrchestratorCount += 1;
  const unsubscribeRouted = subscribeRoutedHostedNode(scheduleReconcile);
  const unsubscribeStore = useHostedHubStore.subscribe(scheduleReconcile);
  const history = getInstalledHostedNodeHistory();
  const unsubscribeHistory = history?.subscribe(() => scheduleReconcile());
  scheduleReconcile();
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    activeOrchestratorCount -= 1;
    unsubscribeRouted();
    unsubscribeStore();
    unsubscribeHistory?.();
  };
}

export function useHostedNodeRouteOrchestrator(): void {
  useEffect(() => startHostedNodeRouteOrchestrator(), []);
}

export function resetHostedNodeRouteOrchestratorForTests(): void {
  restoreRequestedNodeId = null;
  restoreOriginNodeId = null;
  interactiveNodeId = null;
  reconcileSuspended = false;
  lastAccountStatus = null;
  setNotice(null);
}
