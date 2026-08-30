import { EnvironmentId } from "@ryco/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  createEnvironmentQueryRefreshCoordinator,
  isHostedEnvironmentQueryRefreshReady,
  type HostedEnvironmentQueryRefreshState,
} from "./environmentQueryRefresh";

const environmentId = EnvironmentId.make("environment-query-refresh-test");

function makeHarness() {
  const fence = vi.fn();
  const refresh = vi.fn(async () => undefined);
  return {
    fence,
    refresh,
    coordinator: createEnvironmentQueryRefreshCoordinator({ fence, refresh }),
  };
}

describe("environment query refresh coordination", () => {
  it("refreshes a direct environment only after its current shell is ready", async () => {
    const harness = makeHarness();
    const generation = harness.coordinator.begin(environmentId);

    expect(harness.fence).toHaveBeenCalledWith(environmentId);
    expect(harness.refresh).not.toHaveBeenCalled();

    await expect(harness.coordinator.ready(environmentId, generation)).resolves.toBe(true);
    expect(harness.refresh).toHaveBeenCalledTimes(1);
  });

  it("keeps a hosted refresh gated until lifecycle ownership is ready", async () => {
    const harness = makeHarness();
    const generation = harness.coordinator.begin(environmentId);
    const readiness: HostedEnvironmentQueryRefreshState = {
      generation,
      selectedNode: { environmentId },
      directoryStatus: "ready",
      selectionStatus: "online",
      transportStatus: "online",
      sessionStatus: "replaying",
      sessionEstablished: false,
      browserStatus: "current",
    };

    await expect(
      harness.coordinator.ready(environmentId, generation, () =>
        isHostedEnvironmentQueryRefreshReady(readiness, environmentId, generation),
      ),
    ).resolves.toBe(false);
    expect(harness.refresh).not.toHaveBeenCalled();

    const readyState = {
      ...readiness,
      sessionStatus: "ready",
      sessionEstablished: true,
    } as const;
    await expect(
      harness.coordinator.ready(environmentId, generation, () =>
        isHostedEnvironmentQueryRefreshReady(readyState, environmentId, generation),
      ),
    ).resolves.toBe(true);
    expect(harness.refresh).toHaveBeenCalledTimes(1);
  });

  it("requires the current hosted generation, directory, relay, session, and browser snapshot", () => {
    const ready: HostedEnvironmentQueryRefreshState = {
      generation: 4,
      selectedNode: { environmentId },
      directoryStatus: "ready",
      selectionStatus: "online",
      transportStatus: "online",
      sessionStatus: "ready",
      sessionEstablished: true,
      browserStatus: "current",
    };

    expect(isHostedEnvironmentQueryRefreshReady(ready, environmentId, 4)).toBe(true);
    expect(
      isHostedEnvironmentQueryRefreshReady({ ...ready, generation: 5 }, environmentId, 4),
    ).toBe(false);
    expect(
      isHostedEnvironmentQueryRefreshReady(
        { ...ready, directoryStatus: "stale" },
        environmentId,
        4,
      ),
    ).toBe(false);
    expect(
      isHostedEnvironmentQueryRefreshReady(
        { ...ready, transportStatus: "reconnecting" },
        environmentId,
        4,
      ),
    ).toBe(false);
    expect(
      isHostedEnvironmentQueryRefreshReady(
        { ...ready, sessionEstablished: false },
        environmentId,
        4,
      ),
    ).toBe(false);
    expect(
      isHostedEnvironmentQueryRefreshReady({ ...ready, browserStatus: "stale" }, environmentId, 4),
    ).toBe(false);
  });

  it("fences stale generations and deduplicates repeated readiness", async () => {
    let resolveRefresh: (() => void) | undefined;
    const fence = vi.fn();
    const refresh = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRefresh = resolve;
        }),
    );
    const coordinator = createEnvironmentQueryRefreshCoordinator({ fence, refresh });
    const staleGeneration = coordinator.begin(environmentId);
    const currentGeneration = coordinator.begin(environmentId);

    await expect(coordinator.ready(environmentId, staleGeneration)).resolves.toBe(false);
    const first = coordinator.ready(environmentId, currentGeneration);
    const duplicate = coordinator.ready(environmentId, currentGeneration);
    expect(refresh).toHaveBeenCalledTimes(1);

    resolveRefresh?.();
    await expect(first).resolves.toBe(true);
    await expect(duplicate).resolves.toBe(true);
    await expect(coordinator.ready(environmentId, currentGeneration)).resolves.toBe(true);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
