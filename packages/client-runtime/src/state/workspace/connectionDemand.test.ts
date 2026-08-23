import { EnvironmentId, ThreadId } from "@ryco/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  createWorkspaceConnectionDemandState,
  planWorkspaceConnectionDemand,
  releaseWorkspaceConnectionScope,
  renewWorkspaceConnectionScope,
  retainWorkspaceConnectionScope,
  setWorkspaceConnectionBackgrounded,
  setWorkspaceEnvironmentConnected,
  UNIFIED_WORKSPACE_MAX_CONNECTIONS,
  workspaceConnectionScopeRefCounts,
} from "./connectionDemand.js";

const environments = Array.from({ length: 5 }, (_, index) =>
  EnvironmentId.make(`env-${index + 1}`),
);

function retain(
  state: ReturnType<typeof createWorkspaceConnectionDemandState>,
  index: number,
  now = index,
) {
  return retainWorkspaceConnectionScope(state, {
    leaseId: `lease-${index}`,
    environmentId: environments[index - 1]!,
    scope: { type: "thread-detail", threadId: ThreadId.make(`thread-${index}`) },
    now,
  });
}

describe("unified workspace connection demand", () => {
  it("enforces the assessed absolute ceiling", () => {
    expect(UNIFIED_WORKSPACE_MAX_CONNECTIONS).toBe(3);
    expect(() => createWorkspaceConnectionDemandState(0)).toThrow(RangeError);
    expect(() => createWorkspaceConnectionDemandState(4)).toThrow(RangeError);
    expect(createWorkspaceConnectionDemandState(1).platformMaxConnections).toBe(1);
  });

  it("refcounts duplicate scopes with independently renewable TTL leases", () => {
    let state = createWorkspaceConnectionDemandState(3);
    const scope = { type: "provider-status" as const, instanceId: "codex" };
    state = retainWorkspaceConnectionScope(state, {
      leaseId: "first",
      environmentId: environments[0]!,
      scope,
      now: 0,
      ttlMs: 10,
    });
    state = retainWorkspaceConnectionScope(state, {
      leaseId: "second",
      environmentId: environments[0]!,
      scope,
      now: 0,
      ttlMs: 10,
    });
    expect(workspaceConnectionScopeRefCounts(state, 5)).toMatchObject([{ refCount: 2 }]);

    state = renewWorkspaceConnectionScope(state, "first", 8, 10);
    expect(workspaceConnectionScopeRefCounts(state, 11)).toMatchObject([{ refCount: 1 }]);
    expect(planWorkspaceConnectionDemand(state, { now: 19 }).retain).toHaveLength(0);
  });

  it("uses LRU only for non-retained connections in a five-node fixture", () => {
    let state = createWorkspaceConnectionDemandState(3);
    state = setWorkspaceEnvironmentConnected(state, environments[0]!, true, 10);
    state = setWorkspaceEnvironmentConnected(state, environments[1]!, true, 20);
    state = setWorkspaceEnvironmentConnected(state, environments[2]!, true, 1);
    state = retain(state, 1, 30);
    state = retain(state, 2, 31);
    state = retain(state, 4, 32);

    const plan = planWorkspaceConnectionDemand(state, { now: 33 });
    expect(plan.retain).toEqual([environments[0], environments[1]]);
    expect(plan.release).toEqual([environments[2]]);
    expect(plan.connect).toEqual([{ environmentId: environments[3], delayMs: 0 }]);
    expect(plan.queued).toEqual([]);
  });

  it("queues and cancels a fourth retained acquisition instead of evicting", () => {
    let state = createWorkspaceConnectionDemandState(3);
    for (let index = 1; index <= 3; index += 1) {
      state = retain(state, index, index);
      state = setWorkspaceEnvironmentConnected(state, environments[index - 1]!, true, index);
    }
    state = retain(state, 4, 10);
    const queued = planWorkspaceConnectionDemand(state, { now: 11 });
    expect(queued.release).toEqual([]);
    expect(queued.connect).toEqual([]);
    expect(queued.queued).toEqual([environments[3]]);

    state = releaseWorkspaceConnectionScope(state, "lease-4");
    expect(planWorkspaceConnectionDemand(state, { now: 12 }).queued).toEqual([]);
  });

  it("releases non-retained background work and staggers retained foreground reconnects", () => {
    let state = createWorkspaceConnectionDemandState(3);
    state = retain(state, 1, 1);
    state = retain(state, 2, 2);
    state = setWorkspaceEnvironmentConnected(state, environments[2]!, true, 3);
    state = setWorkspaceConnectionBackgrounded(state, true);

    const background = planWorkspaceConnectionDemand(state, { now: 4 });
    expect(background.release).toEqual([environments[2]]);
    expect(background.connect).toEqual([]);
    expect(background.queued).toEqual([environments[1], environments[0]]);

    state = setWorkspaceEnvironmentConnected(state, environments[2]!, false, 4);
    state = setWorkspaceConnectionBackgrounded(state, false);
    const foreground = planWorkspaceConnectionDemand(state, { now: 5, wakeStaggerMs: 750 });
    expect(foreground.connect).toEqual([
      { environmentId: environments[1], delayMs: 0 },
      { environmentId: environments[0], delayMs: 750 },
    ]);
  });
});
