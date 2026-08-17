import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, type AgentControlProposalStreamEvent } from "@ryco/contracts";

import { startAgentControlProposalSync } from "./sync.ts";

const environmentId = EnvironmentId.make("env-1");

const snapshot: AgentControlProposalStreamEvent = {
  version: 1,
  type: "snapshot",
  queue: { revision: 1, active: [], recent: [] },
};

function makeHarness() {
  const applied: Array<{ environmentId: string; event: AgentControlProposalStreamEvent }> = [];
  const cleared: string[] = [];
  let listener: ((event: AgentControlProposalStreamEvent) => void) | null = null;
  let unsubscribed = 0;

  return {
    applied,
    cleared,
    emit: (event: AgentControlProposalStreamEvent) => listener?.(event),
    unsubscribedCount: () => unsubscribed,
    source: {
      subscribeProposals: (callback: (event: AgentControlProposalStreamEvent) => void) => {
        listener = callback;
        return () => {
          unsubscribed += 1;
          listener = null;
        };
      },
    },
    sink: {
      applyStreamEvent: (id: EnvironmentId, event: AgentControlProposalStreamEvent) => {
        applied.push({ environmentId: id, event });
      },
      clearEnvironment: (id: EnvironmentId) => {
        cleared.push(id);
      },
    },
  };
}

describe("startAgentControlProposalSync", () => {
  it("routes stream events into the sink for its environment", () => {
    const harness = makeHarness();
    startAgentControlProposalSync({
      environmentId,
      source: harness.source,
      sink: harness.sink,
    });

    harness.emit(snapshot);
    expect(harness.applied).toHaveLength(1);
    expect(harness.applied[0]?.environmentId).toBe(environmentId);
    expect(harness.applied[0]?.event.type).toBe("snapshot");
  });

  it("stops delivering, unsubscribes, and clears state exactly once", () => {
    const harness = makeHarness();
    const stop = startAgentControlProposalSync({
      environmentId,
      source: harness.source,
      sink: harness.sink,
    });

    stop();
    stop();
    harness.emit(snapshot);

    expect(harness.applied).toHaveLength(0);
    expect(harness.unsubscribedCount()).toBe(1);
    expect(harness.cleared).toEqual([environmentId]);
  });
});
