import {
  EnvironmentId,
  ThreadId,
  type DesktopWorkspaceScopeProjection,
  type DesktopWorkspaceConnectionCommand,
  type DesktopWorkspaceStateProjection,
} from "@ryco/contracts";
import { useSyncExternalStore } from "react";

import {
  connectDesktopWorkspaceEnvironment,
  disconnectPrimaryEnvironment,
  disconnectSavedEnvironment,
  readEnvironmentConnection,
} from "../environments/runtime";
import { useStore } from "../store";
import { readWorkspaceMetadataSnapshot } from "../workspaceMetadataProjection";

const SIGNED_OUT: DesktopWorkspaceStateProjection = {
  status: "signed-out",
  accountId: null,
  localEnvironmentId: null,
  machines: [],
  snapshots: [],
  queuedEnvironmentIds: [],
  activeConnectionCount: 0,
};

let current = SIGNED_OUT;
const listeners = new Set<() => void>();

export function readDesktopWorkspaceState(): DesktopWorkspaceStateProjection {
  return current;
}

export function subscribeDesktopWorkspaceState(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useDesktopWorkspaceState(): DesktopWorkspaceStateProjection {
  return useSyncExternalStore(
    subscribeDesktopWorkspaceState,
    readDesktopWorkspaceState,
    readDesktopWorkspaceState,
  );
}

/**
 * A mounted thread detail is demand. Sidebar prewarming deliberately does not
 * call this helper, so cached/list rows cannot connect every machine.
 */
function retainDesktopWorkspaceScope(
  environmentId: EnvironmentId,
  scope: DesktopWorkspaceScopeProjection,
): () => void {
  const bridge = globalThis.window?.desktopBridge;
  if (!bridge?.retainDesktopWorkspaceScope) return () => undefined;
  let released = false;
  let leaseId: string | null = null;
  let renewal: ReturnType<typeof setInterval> | null = null;
  void bridge
    .retainDesktopWorkspaceScope({
      environmentId,
      scope,
    })
    .then((result) => {
      leaseId = result.leaseId;
      if (released) {
        void bridge.releaseDesktopWorkspaceScope?.(result.leaseId);
        return;
      }
      renewal = globalThis.setInterval(() => {
        void bridge.renewDesktopWorkspaceScope?.(result.leaseId).catch(() => undefined);
      }, 15_000);
    })
    .catch(() => undefined);

  return () => {
    released = true;
    if (renewal) globalThis.clearInterval(renewal);
    if (leaseId) void bridge.releaseDesktopWorkspaceScope?.(leaseId).catch(() => undefined);
  };
}

export function retainDesktopWorkspaceThreadScope(
  environmentId: EnvironmentId,
  threadId: ThreadId,
): () => void {
  return retainDesktopWorkspaceScope(environmentId, { type: "thread-detail", threadId });
}

export function retainDesktopWorkspaceVcsScope(
  environmentId: EnvironmentId,
  cwd: string,
): () => void {
  return retainDesktopWorkspaceScope(environmentId, { type: "vcs-status", cwd });
}

export function retainDesktopWorkspaceProviderScope(
  environmentId: EnvironmentId,
  instanceId?: string,
): () => void {
  return retainDesktopWorkspaceScope(environmentId, {
    type: "provider-status",
    ...(instanceId ? { instanceId } : {}),
  });
}

function adopt(state: DesktopWorkspaceStateProjection): void {
  current = state;
  for (const listener of listeners) listener();
}

async function applyConnectionCommand(command: DesktopWorkspaceConnectionCommand): Promise<void> {
  let connection = readEnvironmentConnection(command.environmentId);
  if (command.action === "connect") {
    if (command.delayMs > 0) {
      await new Promise<void>((resolve) => globalThis.setTimeout(resolve, command.delayMs));
    }
    try {
      if (!connection) {
        const machine = current.machines.find(
          (candidate) => candidate.environmentId === command.environmentId,
        );
        if (!machine?.canConnect) throw new Error("Desktop workspace machine is unavailable.");
        connection = await connectDesktopWorkspaceEnvironment({
          environmentId: machine.environmentId,
          label: machine.label,
        });
      } else {
        await connection.reconnect();
        await connection.ensureBootstrapped();
      }
      await globalThis.window?.desktopBridge
        ?.reportDesktopWorkspaceConnection?.({
          environmentId: command.environmentId,
          connected: true,
        })
        .catch(() => undefined);
    } catch (error) {
      await globalThis.window?.desktopBridge
        ?.reportDesktopWorkspaceConnection?.({
          environmentId: command.environmentId,
          connected: false,
        })
        .catch(() => undefined);
      throw error;
    }
    return;
  }
  if (!connection) return;
  if (connection.kind === "primary") {
    await disconnectPrimaryEnvironment();
  } else {
    await disconnectSavedEnvironment(command.environmentId);
  }
  await globalThis.window?.desktopBridge
    ?.reportDesktopWorkspaceConnection?.({
      environmentId: command.environmentId,
      connected: false,
    })
    .catch(() => undefined);
}

/** Bind the renderer only to secret-free projections and exact environment commands. */
export function startDesktopWorkspaceBridge(): () => void {
  const bridge = globalThis.window?.desktopBridge;
  if (!bridge?.getDesktopWorkspaceState) return () => undefined;
  let disposed = false;
  let publishTimer: ReturnType<typeof setTimeout> | null = null;
  const publishLiveMetadata = () => {
    if (publishTimer) globalThis.clearTimeout(publishTimer);
    publishTimer = globalThis.setTimeout(() => {
      publishTimer = null;
      const publish = bridge.publishDesktopWorkspaceSnapshot;
      if (!publish || disposed) return;
      for (const machine of current.machines) {
        if (!machine.canReadMetadata) continue;
        const snapshot = readWorkspaceMetadataSnapshot(machine.environmentId);
        if (snapshot) void publish(snapshot).catch(() => undefined);
      }
    }, 100);
  };
  const unsubscribeState = bridge.onDesktopWorkspaceState?.((state) => {
    adopt(state);
    publishLiveMetadata();
  });
  const unsubscribeCommands = bridge.onDesktopWorkspaceConnectionCommand?.((command) => {
    void applyConnectionCommand(command).catch(() => undefined);
  });
  const unsubscribeStore = useStore.subscribe(publishLiveMetadata);
  void bridge
    .getDesktopWorkspaceState()
    .then((state) => {
      if (disposed) return;
      adopt(state);
      publishLiveMetadata();
    })
    .catch(() => undefined);

  return () => {
    disposed = true;
    if (publishTimer) globalThis.clearTimeout(publishTimer);
    unsubscribeState?.();
    unsubscribeCommands?.();
    unsubscribeStore();
  };
}
