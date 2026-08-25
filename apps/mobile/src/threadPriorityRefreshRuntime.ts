import {
  getThreadPriorityRefreshCoordinator,
  type ThreadPriorityManualRefreshResult,
  type ThreadPriorityRefreshConfig,
  type ThreadPriorityRefreshEnvironment,
} from "@ryco/client-runtime/state/threads";

import { createMobileConnectionRegistry } from "./runtime/bootstrap";

const runtimeIdentity = {};
let environmentSnapshot: ReadonlyArray<ThreadPriorityRefreshEnvironment> = [];

const coordinator = getThreadPriorityRefreshCoordinator(runtimeIdentity, {
  nowMs: Date.now,
  timer: {
    set: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
    clear: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  },
  listEnvironments: () => environmentSnapshot,
  ensureCurrent: async (environmentId, input) => {
    const connection = createMobileConnectionRegistry().driver.supervisor.read(environmentId);
    if (!connection) throw new Error("The environment is no longer connected.");
    return await connection.client.threadPriority.ensureCurrent(input);
  },
  // Automatic failures stay quiet. Manual refresh reports them in Settings.
});

export function setMobileThreadPriorityRefreshEnvironments(
  environments: ReadonlyArray<ThreadPriorityRefreshEnvironment>,
): void {
  environmentSnapshot = environments;
}

export async function configureMobileThreadPriorityRefresh(
  config: ThreadPriorityRefreshConfig,
): Promise<void> {
  await coordinator.configure(config);
}

export async function notifyMobileThreadPriorityEnvironmentsChanged(): Promise<void> {
  await coordinator.environmentsChanged();
}

export function notifyMobileThreadPriorityInputChanged(): void {
  coordinator.relevantInputChanged();
}

export async function setMobileThreadPriorityForeground(foreground: boolean): Promise<void> {
  await coordinator.setForeground(foreground);
}

export async function refreshMobileThreadPrioritiesNow(): Promise<ThreadPriorityManualRefreshResult> {
  return await coordinator.refreshNow();
}
