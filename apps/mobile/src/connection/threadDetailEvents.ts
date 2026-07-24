import type { EnvironmentId, OrchestrationEvent } from "@ryco/contracts";
import type {
  EnvironmentConnectionSupervisor,
  EnvironmentStateSink,
} from "@ryco/client-runtime/connection";
import { deriveOrchestrationBatchEffects } from "@ryco/client-runtime/state/orchestration";
import { scopeProjectRef, scopeThreadRef } from "@ryco/client-runtime/scoped";

import { markPromotedDraftThreadByRef } from "../state/composerDraftStore";

// §4 stub closure for the driver's applyThreadDetailEvent. Mirrors web's
// applyRecoveredEventBatch (service.ts:611-662): derive the batch effects, apply
// the orchestration events through the sink, then run the same promotion /
// draft-and-terminal cleanup / detail-subscription eviction as the shell path.
//
// coalesceOrchestrationUiEvents is intentionally omitted — it is identity for the
// single-event detail path (§3-9); syncProjects/syncThreads are mobile no-ops
// (no UI store, §3-5). This is a mobile-local mirror (a hoist candidate to
// client-runtime), not a fork of the effects derivation, which stays in the
// runtime package.
export function createThreadDetailEventApplier(input: {
  readonly stateSink: EnvironmentStateSink;
  readonly getSupervisor: () => Pick<
    EnvironmentConnectionSupervisor,
    "reconcileThreadDetailSubscriptionEvictionForEnvironment"
  >;
}): (environmentId: EnvironmentId, event: OrchestrationEvent) => void {
  const applyRecoveredEventBatch = (
    events: ReadonlyArray<OrchestrationEvent>,
    environmentId: EnvironmentId,
  ): void => {
    if (events.length === 0) return;

    const batchEffects = deriveOrchestrationBatchEffects(events);

    if (batchEffects.needsProviderInvalidation) {
      input.stateSink.markProviderInvalidationNeeded();
    }

    input.stateSink.applyOrchestrationEvents(environmentId, events);

    for (const threadId of batchEffects.promoteDraftThreadIds) {
      markPromotedDraftThreadByRef(scopeThreadRef(environmentId, threadId));
    }
    for (const threadId of batchEffects.clearDeletedThreadIds) {
      input.stateSink.clearThreadDraft(scopeThreadRef(environmentId, threadId));
    }
    for (const event of events) {
      if (event.type === "project.deleted") {
        input.stateSink.clearProjectDraftThread(
          scopeProjectRef(environmentId, event.payload.projectId),
        );
      }
    }
    for (const threadId of batchEffects.removeTerminalStateThreadIds) {
      input.stateSink.clearTerminalState(scopeThreadRef(environmentId, threadId));
    }

    input.getSupervisor().reconcileThreadDetailSubscriptionEvictionForEnvironment(environmentId);
  };

  return (environmentId, event) => applyRecoveredEventBatch([event], environmentId);
}
