import {
  createEnvironmentConnection,
  type EnvironmentConnection,
  type EnvironmentConnectionSupervisor,
  type OrchestrationHandlers,
} from "@ryco/client-runtime/connection";
import {
  hostedHubStore,
  markHostedSessionReady,
  markHostedSessionReplaying,
  reportHostedShellSnapshotFailure,
} from "@ryco/client-runtime/authorization";
import {
  attachEnvironmentDescriptor,
  createKnownEnvironment,
} from "@ryco/client-runtime/knownEnvironment";
import { getHostedRelayAttemptFactory } from "@ryco/client-runtime/relay";
import { createWsRpcClient } from "@ryco/client-runtime/rpc";

import { WsTransport } from "../rpc/wsTransport";
import { readPrimaryEnvironmentDescriptor } from "./primaryEnvironment";
import { mobileHostedRelayUrl } from "./relaySocket";
import { getMobileHostedConfig } from "./runtimeConfig";

/**
 * Builds the node connection that runs **through the Hub relay**.
 *
 * `nodeLifecycle.connectPrimaryEnvironment()` drives `supervisor.connectPrimary()`,
 * which calls this. The relay attempt factory owns the ticket lifecycle — it
 * issues a fresh ticket per attempt and throws on any reuse — so this module
 * only consumes it and never caches or replays one.
 *
 * Returns `null` when no hosted node is selected, which is the normal state and
 * includes supervisor `start()` on a direct-only build. That `null` is what
 * keeps the direct plane's behavior byte-identical when hosted mode is absent.
 */
export interface HostedPrimaryConnectionDeps extends Pick<
  OrchestrationHandlers,
  "applyShellEvent"
> {
  readonly syncShellSnapshot: EnvironmentConnectionSupervisor["syncShellSnapshot"];
  readonly pushSequenceMonitor: Parameters<
    typeof createEnvironmentConnection
  >[0]["pushSequenceMonitor"];
}

export function createHostedPrimaryConnection(
  deps: HostedPrimaryConnectionDeps,
): EnvironmentConnection | null {
  const descriptor = readPrimaryEnvironmentDescriptor();
  if (descriptor === null) return null;
  const hostedGeneration = hostedHubStore.getState().generation;
  const acceptsEvent = () => hostedHubStore.getState().generation === hostedGeneration;

  const attemptFactory = getHostedRelayAttemptFactory();
  const client = createWsRpcClient(
    new WsTransport(() => attemptFactory.nextUrl(), {
      ...attemptFactory.lifecycleHandlers(),
      getConnectionLabel: () => descriptor.label ?? null,
    }),
  );

  // The node is reached only through the relay, so the "target" is the Hub's
  // relay endpoint rather than any node-owned address — the app never learns
  // one, which is the point of the hosted plane.
  const knownEnvironment = attachEnvironmentDescriptor(
    createKnownEnvironment({
      id: descriptor.environmentId,
      label: descriptor.label,
      source: "hub-hosted",
      target: {
        httpBaseUrl: getMobileHostedConfig()?.hubOrigin ?? "",
        wsBaseUrl: mobileHostedRelayUrl(),
      },
    }),
    descriptor,
  );

  return createEnvironmentConnection({
    // Must be "primary": `disconnectPrimary` finds the connection by this kind.
    kind: "primary",
    knownEnvironment,
    client,
    pushSequenceMonitor: deps.pushSequenceMonitor,
    onResubscribe: (environmentId) => markHostedSessionReplaying(environmentId, hostedGeneration),
    onShellError: (environmentId) =>
      reportHostedShellSnapshotFailure(environmentId, hostedGeneration),
    applyShellEvent: (event, environmentId) => {
      if (!acceptsEvent()) return;
      deps.applyShellEvent(event, environmentId);
    },
    syncShellSnapshot: (snapshot, environmentId) => {
      if (!acceptsEvent()) return;
      deps.syncShellSnapshot(snapshot, environmentId, {
        onCurrent: () => markHostedSessionReady(environmentId, hostedGeneration),
        onReady: () => markHostedSessionReady(environmentId, hostedGeneration),
      });
    },
    // Terminal streaming is deferred, matching the direct plane.
    applyTerminalEvent: () => undefined,
  });
}
