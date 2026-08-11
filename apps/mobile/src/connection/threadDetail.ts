import type { EnvironmentId, OrchestrationThreadHistoryPageInfo, ThreadId } from "@ryco/contracts";

import { createMobileConnectionRegistry } from "../runtime/bootstrap";

// Thin wrapper over the supervisor's thread-detail retention (spec Thread-row
// requirement: the Thread screen retains the detail subscription while mounted,
// per apps/web ChatView). Bound to the app's single-homed registry.
const registry = createMobileConnectionRegistry();

export function retainThreadDetailSubscription(
  environmentId: EnvironmentId,
  threadId: ThreadId,
): () => void {
  return registry.driver.supervisor.retainThreadDetailSubscription(environmentId, threadId);
}

export function loadOlderThreadMessages(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly page: OrchestrationThreadHistoryPageInfo;
}) {
  return registry.driver.supervisor.loadOlderThreadHistory({
    ...input,
    collection: "messages",
    limit: 100,
  });
}
