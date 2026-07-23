import type { EnvironmentStateSink } from "@ryco/client-runtime/connection";
import { scopedThreadKey, scopeThreadRef } from "@ryco/client-runtime/scoped";

import { useComposerDraftStore } from "~/composerDraftStore";
import { getClientSettings } from "~/hooks/useSettings";
import { deriveLogicalProjectKeyFromSettings, derivePhysicalProjectKey } from "~/logicalProject";
import {
  useStore,
  selectProjectsAcrossEnvironments,
  selectThreadsAcrossEnvironments,
} from "~/store";
import { useTerminalStateStore } from "~/terminalStateStore";
import { useUiStateStore } from "~/uiStateStore";

/** Web presentation adapter. Every operation preserves the former store-write order. */
export function createWebEnvironmentStateSink(input: {
  readonly markProviderInvalidationNeeded: () => void;
  readonly flushProviderInvalidation: () => void;
}): EnvironmentStateSink {
  return {
    applyOrchestrationEvents: (environmentId, events) =>
      useStore.getState().applyOrchestrationEvents(events, environmentId),
    syncServerShellSnapshot: (environmentId, snapshot) =>
      useStore.getState().syncServerShellSnapshot(snapshot, environmentId),
    syncProjects: () => {
      const clientSettings = getClientSettings();
      useUiStateStore.getState().syncProjects(
        selectProjectsAcrossEnvironments(useStore.getState()).map((project) => ({
          key: derivePhysicalProjectKey(project),
          logicalKey: deriveLogicalProjectKeyFromSettings(project, clientSettings),
          cwd: project.cwd,
        })),
      );
    },
    syncThreads: () => {
      const threads = selectThreadsAcrossEnvironments(useStore.getState());
      useUiStateStore.getState().syncThreads(
        threads.map((thread) => ({
          key: scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
          seedVisitedAt: thread.updatedAt ?? thread.createdAt,
        })),
      );
    },
    clearThreadDraft: (ref) => {
      useComposerDraftStore.getState().clearDraftThread(ref);
      useUiStateStore.getState().clearThreadUi(scopedThreadKey(ref));
    },
    clearProjectDraftThread: (ref) =>
      useComposerDraftStore.getState().clearProjectDraftThreadId(ref),
    clearTerminalState: (ref) => useTerminalStateStore.getState().removeTerminalState(ref),
    markProviderInvalidationNeeded: input.markProviderInvalidationNeeded,
    flushProviderInvalidation: input.flushProviderInvalidation,
  };
}
