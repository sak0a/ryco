import type { AgentControlProposalStreamEvent, EnvironmentId } from "@ryco/contracts";

/**
 * The slice of `EnvironmentApi["agentControl"]` the sync needs. Injected so
 * tests and platforms can supply any conforming subscription source.
 */
export interface AgentControlSubscriptionSource {
  readonly subscribeProposals: (
    callback: (event: AgentControlProposalStreamEvent) => void,
    options?: {
      onResubscribe?: () => void;
      onError?: () => void;
    },
  ) => () => void;
}

export interface AgentControlSyncSink {
  readonly applyStreamEvent: (
    environmentId: EnvironmentId,
    event: AgentControlProposalStreamEvent,
  ) => void;
  readonly clearEnvironment: (environmentId: EnvironmentId) => void;
}

/**
 * Subscribe one environment's Agent Control queue into the shared store.
 *
 * The transport resubscribes automatically after reconnects, and the server
 * opens every subscription with a fresh snapshot event, which resets the
 * store's dedupe baseline — so replayed or duplicated events are absorbed
 * without polling. Callers start this only while the Agent Control setting
 * is enabled; stopping clears the environment's queue state.
 */
export function startAgentControlProposalSync(input: {
  readonly environmentId: EnvironmentId;
  readonly source: AgentControlSubscriptionSource;
  readonly sink: AgentControlSyncSink;
  /** Invoked when the subscription fails terminally (e.g. feature disabled). */
  readonly onError?: () => void;
}): () => void {
  const { environmentId, source, sink } = input;
  let stopped = false;

  const unsubscribe = source.subscribeProposals(
    (event) => {
      if (stopped) return;
      sink.applyStreamEvent(environmentId, event);
    },
    {
      onError: () => {
        if (stopped) return;
        input.onError?.();
      },
    },
  );

  return () => {
    if (stopped) return;
    stopped = true;
    unsubscribe();
    sink.clearEnvironment(environmentId);
  };
}
