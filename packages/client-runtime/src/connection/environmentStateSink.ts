import type {
  EnvironmentId,
  OrchestrationEvent,
  OrchestrationShellSnapshot,
  OrchestrationShellStreamEvent,
  ScopedProjectRef,
  ScopedThreadRef,
} from "@ryco/contracts";

/**
 * App-owned presentation writes performed by the connection supervisor.
 * The hosted readiness handlers deliberately do not belong here: hosted lifecycle
 * ownership and its generation fencing remain a separate interface.
 */
export interface EnvironmentStateSink {
  readonly prepareShellEvent: (
    environmentId: EnvironmentId,
    event: OrchestrationShellStreamEvent,
  ) => unknown;
  readonly applyShellEvent: (
    environmentId: EnvironmentId,
    event: OrchestrationShellStreamEvent,
  ) => void;
  readonly afterShellEventApplied: (
    environmentId: EnvironmentId,
    event: OrchestrationShellStreamEvent,
    context: unknown,
  ) => void;
  readonly applyOrchestrationEvents: (
    environmentId: EnvironmentId,
    events: ReadonlyArray<OrchestrationEvent>,
  ) => void;
  readonly syncServerShellSnapshot: (
    environmentId: EnvironmentId,
    snapshot: OrchestrationShellSnapshot,
  ) => void;
  readonly reconcileSnapshotDerivedState: () => void;
  readonly syncProjects: (environmentId: EnvironmentId) => void;
  readonly syncThreads: (environmentId: EnvironmentId) => void;
  readonly clearThreadDraft: (ref: ScopedThreadRef) => void;
  readonly clearProjectDraftThread: (ref: ScopedProjectRef) => void;
  readonly clearTerminalState: (ref: ScopedThreadRef) => void;
  readonly markProviderInvalidationNeeded: () => void;
  readonly flushProviderInvalidation: () => void;
}
