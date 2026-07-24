import type {
  EnvironmentConnectionSupervisor,
  EnvironmentStateSink,
} from "@ryco/client-runtime/connection";
import { scopeThreadRef } from "@ryco/client-runtime/scoped";

import { markPromotedDraftThreadByRef, useComposerDraftStore } from "../state/composerDraftStore";
import { useTerminalStateStore } from "../state/terminalStateStore";
import { selectThreadByRef, useStore } from "../state/threadsRuntime";

// The supervisor methods the sink drives from live shell events (§4). Threaded in
// as a getter (the supervisor is constructed after the sink), mirroring web's
// `supervisor: getEnvironmentSupervisor`.
type SinkSupervisor = Pick<
  EnvironmentConnectionSupervisor,
  | "disposeThreadDetailSubscription"
  | "evictIdleThreadDetailSubscriptionsToCapacity"
  | "reconcileThreadDetailSubscriptionEvictionForThread"
>;

interface ShellEventContext {
  readonly previousThread: ReturnType<typeof selectThreadByRef> | undefined;
  readonly threadRef: ReturnType<typeof scopeThreadRef> | null;
}

/**
 * Mobile presentation adapter for the connection supervisor — the RN analogue of
 * apps/web/src/environments/runtime/environmentStateSink.ts, minus the web
 * UI-store / provider-cache sync (there is no mobile UI store — §3-5). The core
 * apply/sync methods write shell snapshots and events into `state/threads`; live
 * thread events get the same promotion/cleanup/detail-eviction treatment as the
 * recovered-batch path in the driver (§4).
 */
export function createMobileEnvironmentStateSink(
  input: { readonly supervisor?: () => SinkSupervisor } = {},
): EnvironmentStateSink {
  return {
    // Snapshot the pre-apply thread so afterShellEventApplied can tell a freshly
    // promoted draft (no previous thread) from an existing one.
    prepareShellEvent: (environmentId, event): ShellEventContext => {
      const threadId =
        event.kind === "thread-upserted"
          ? event.thread.id
          : event.kind === "thread-removed"
            ? event.threadId
            : null;
      const threadRef = threadId ? scopeThreadRef(environmentId, threadId) : null;
      return {
        previousThread: threadRef ? selectThreadByRef(useStore.getState(), threadRef) : undefined,
        threadRef,
      };
    },
    applyShellEvent: (environmentId, event) =>
      useStore.getState().applyShellEvent(event, environmentId),
    afterShellEventApplied: (environmentId, event, context) => {
      const { previousThread, threadRef } = context as ShellEventContext;
      switch (event.kind) {
        case "thread-upserted": {
          // A shell upsert for a thread that did not exist means a local draft was
          // promoted to a real server thread — re-key its composer draft.
          if (!previousThread && threadRef) markPromotedDraftThreadByRef(threadRef);
          // A thread that just became archived releases its terminal state.
          if (previousThread?.archivedAt === null && event.thread.archivedAt !== null && threadRef) {
            useTerminalStateStore.getState().removeTerminalState(threadRef);
          }
          input.supervisor?.().reconcileThreadDetailSubscriptionEvictionForThread(
            environmentId,
            event.thread.id,
          );
          input.supervisor?.().evictIdleThreadDetailSubscriptionsToCapacity();
          return;
        }
        case "thread-removed": {
          if (threadRef) {
            input.supervisor?.().disposeThreadDetailSubscription(environmentId, event.threadId);
            useComposerDraftStore.getState().clearDraftThread(threadRef);
            useTerminalStateStore.getState().removeTerminalState(threadRef);
          }
          return;
        }
        default:
          return;
      }
    },
    applyOrchestrationEvents: (environmentId, events) =>
      useStore.getState().applyOrchestrationEvents(events, environmentId),
    syncServerShellSnapshot: (environmentId, snapshot) =>
      useStore.getState().syncServerShellSnapshot(snapshot, environmentId),
    // No mobile UI store and terminal GC is deferred (terminals are v1.1) — §3-5.
    reconcileSnapshotDerivedState: () => undefined,
    syncProjects: () => undefined,
    syncThreads: () => undefined,
    clearThreadDraft: (ref) => useComposerDraftStore.getState().clearDraftThread(ref),
    clearProjectDraftThread: (ref) =>
      useComposerDraftStore.getState().clearProjectDraftThreadId(ref),
    clearTerminalState: (ref) => useTerminalStateStore.getState().removeTerminalState(ref),
    // Permanent no-ops on mobile — no RPC-atom caches in B1 (§3-28).
    markProviderInvalidationNeeded: () => undefined,
    flushProviderInvalidation: () => undefined,
  };
}
