import type {
  EnvironmentId,
  OrchestrationEvent,
  OrchestrationShellSnapshot,
  ScopedProjectRef,
  ScopedThreadRef,
} from "@ryco/contracts";

/**
 * App-owned presentation writes performed by the connection supervisor.
 * The hosted readiness handlers deliberately do not belong here: hosted lifecycle
 * ownership and its generation fencing remain a separate interface.
 */
export interface EnvironmentStateSink {
  readonly applyOrchestrationEvents: (
    environmentId: EnvironmentId,
    events: ReadonlyArray<OrchestrationEvent>,
  ) => void;
  readonly syncServerShellSnapshot: (
    environmentId: EnvironmentId,
    snapshot: OrchestrationShellSnapshot,
  ) => void;
  readonly syncProjects: (environmentId: EnvironmentId) => void;
  readonly syncThreads: (environmentId: EnvironmentId) => void;
  readonly clearThreadDraft: (ref: ScopedThreadRef) => void;
  readonly clearProjectDraftThread: (ref: ScopedProjectRef) => void;
  readonly clearTerminalState: (ref: ScopedThreadRef) => void;
  readonly markProviderInvalidationNeeded: () => void;
  readonly flushProviderInvalidation: () => void;
}
