import type { EnvironmentStateSink } from "@ryco/client-runtime/connection";

import { useComposerDraftStore } from "../state/composerDraftStore";
import { useTerminalStateStore } from "../state/terminalStateStore";
import { useStore } from "../state/threadsRuntime";

/**
 * Mobile presentation adapter for the connection supervisor — the RN analogue of
 * apps/web/src/environments/runtime/environmentStateSink.ts, minus the web
 * UI-store / provider-cache sync (there is no mobile UI store yet). The core
 * apply/sync methods write shell snapshots and events into `state/threads` so
 * `selectSidebarThreadsAcrossEnvironments` populates once the node stream lands.
 */
export function createMobileEnvironmentStateSink(): EnvironmentStateSink {
  return {
    prepareShellEvent: () => undefined,
    applyShellEvent: (environmentId, event) =>
      useStore.getState().applyShellEvent(event, environmentId),
    afterShellEventApplied: () => undefined,
    applyOrchestrationEvents: (environmentId, events) =>
      useStore.getState().applyOrchestrationEvents(events, environmentId),
    syncServerShellSnapshot: (environmentId, snapshot) =>
      useStore.getState().syncServerShellSnapshot(snapshot, environmentId),
    reconcileSnapshotDerivedState: () => undefined,
    syncProjects: () => undefined,
    syncThreads: () => undefined,
    clearThreadDraft: (ref) => useComposerDraftStore.getState().clearDraftThread(ref),
    clearProjectDraftThread: (ref) =>
      useComposerDraftStore.getState().clearProjectDraftThreadId(ref),
    clearTerminalState: (ref) => useTerminalStateStore.getState().removeTerminalState(ref),
    markProviderInvalidationNeeded: () => undefined,
    flushProviderInvalidation: () => undefined,
  };
}
