import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId } from "@ryco/contracts";
import type { AppLifecycleEvent, AppLifecycleService } from "../platform/index.ts";

import { createKeyedQueryRegistry, defineKeyedQueryByInput } from "./keyedQuery.ts";

interface State {
  readonly data: string | null;
  readonly fetching: boolean;
  readonly error: Error | null;
}

const initialState: State = { data: null, fetching: false, error: null };
const environmentId = EnvironmentId.make("environment-keyed-query-test");

function makeRegistry(input?: {
  readonly gcTime?: number;
  readonly maxEntries?: number;
  readonly lifecycle?: AppLifecycleService;
}) {
  return createKeyedQueryRegistry<State>({
    labelPrefix: "keyed-query-test",
    initialState,
    gcTime: input?.gcTime ?? 20,
    maxEntries: input?.maxEntries ?? 16,
    lifecycle: input?.lifecycle,
    buildFetchingState: (current) => ({ ...current, fetching: true, error: null }),
    buildSuccessState: (data) => ({ data: data as string, fetching: false, error: null }),
    buildErrorState: (current, error) => ({ ...current, fetching: false, error }),
    isErrorState: (state) => state.error !== null,
  });
}

function createLifecycleHarness() {
  let foreground = true;
  let online = true;
  const listeners = new Set<(event: AppLifecycleEvent) => void>();
  const lifecycle: AppLifecycleService = {
    isForeground: () => foreground,
    isOnline: () => online,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    lifecycle,
    emit(event: AppLifecycleEvent) {
      if (event === "background") foreground = false;
      if (event === "foreground" || event === "resume") foreground = true;
      if (event === "offline") online = false;
      if (event === "online") online = true;
      for (const listener of listeners) listener(event);
    },
    listenerCount: () => listeners.size,
  };
}

function makeBinding(
  registry: ReturnType<typeof makeRegistry>,
  run: (key: string) => Promise<string>,
) {
  return defineKeyedQueryByInput(
    registry,
    {
      label: "family",
      staleTime: 60_000,
      isEnabled: () => true,
      buildKey: (input: { readonly key: string }) => `${environmentId}\u0000${input.key}`,
      resolveEnvironmentId: () => environmentId,
      createControllerFields: () => ({}),
      run: (input) => run(input.key),
    },
    (controller) => !controller.hasData,
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe("keyed query retention", () => {
  it("evicts released entries after gcTime and releases their payload", async () => {
    vi.useFakeTimers();
    const registry = makeRegistry();
    const binding = makeBinding(registry, (key) => Promise.resolve(`value:${key}`));
    const input = { key: "one" };
    const compositeKey = binding.targetKey(input) as string;

    const release = binding.watch(input);
    await vi.runAllTicks();
    await registry.controllers.get(compositeKey)?.inFlightPromise;
    expect(binding.snapshotFor(input).data).toBe("value:one");

    release();
    await vi.advanceTimersByTimeAsync(21);
    expect(registry.controllers.has(compositeKey)).toBe(false);
    expect(binding.snapshotFor(input)).toEqual(initialState);
  });

  it("pins active and in-flight entries until they become safely evictable", async () => {
    vi.useFakeTimers();
    let resolveRun: ((value: string) => void) | undefined;
    const registry = makeRegistry();
    const binding = makeBinding(
      registry,
      () =>
        new Promise<string>((resolve) => {
          resolveRun = resolve;
        }),
    );
    const input = { key: "pending" };
    const compositeKey = binding.targetKey(input) as string;
    const release = binding.watch(input);

    await vi.advanceTimersByTimeAsync(100);
    expect(registry.evict(compositeKey)).toBe(false);
    release();
    expect(registry.evict(compositeKey)).toBe(false);

    resolveRun?.("done");
    await registry.controllers.get(compositeKey)?.inFlightPromise;
    await vi.advanceTimersByTimeAsync(21);
    expect(registry.controllers.has(compositeKey)).toBe(false);
  });

  it("uses indexed environment and family lookups", () => {
    const registry = makeRegistry();
    const binding = makeBinding(registry, (key) => Promise.resolve(key));
    const releaseOne = binding.watch({ key: "one" });
    const releaseTwo = binding.watch({ key: "two" });

    expect(registry.controllerKeys({ environmentId }).size).toBe(2);
    expect(registry.controllerKeys({ family: "family" }).size).toBe(2);
    registry.clearEnvironment(environmentId);
    expect(registry.controllerKeys({ environmentId }).size).toBe(0);

    releaseOne();
    releaseTwo();
  });

  it("evicts least-recent idle entries before active entries at capacity", async () => {
    vi.useFakeTimers();
    const registry = makeRegistry({ gcTime: 60_000, maxEntries: 2 });
    const binding = makeBinding(registry, (key) => Promise.resolve(key));
    const releaseOne = binding.watch({ key: "one" });
    await registry.controllers.get(binding.targetKey({ key: "one" }) as string)?.inFlightPromise;
    releaseOne();

    const releaseTwo = binding.watch({ key: "two" });
    const releaseThree = binding.watch({ key: "three" });
    expect(registry.controllers.has(binding.targetKey({ key: "one" }) as string)).toBe(false);
    expect(registry.controllers.has(binding.targetKey({ key: "two" }) as string)).toBe(true);
    expect(registry.controllers.has(binding.targetKey({ key: "three" }) as string)).toBe(true);

    releaseTwo();
    releaseThree();
  });
});

describe("keyed query reconnect refresh", () => {
  it("retries an active failed query once across duplicate refresh requests", async () => {
    const registry = makeRegistry();
    const run = vi
      .fn<(key: string) => Promise<string>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue("ready");
    const binding = makeBinding(registry, run);
    const input = { key: "failed" };
    const compositeKey = binding.targetKey(input) as string;
    const release = binding.watch(input);
    await registry.controllers.get(compositeKey)?.inFlightPromise;

    expect(binding.snapshotFor(input).error?.message).toBe("offline");
    await Promise.all([
      registry.refreshActiveEnvironment(environmentId),
      registry.refreshActiveEnvironment(environmentId),
    ]);

    expect(run).toHaveBeenCalledTimes(2);
    expect(binding.snapshotFor(input)).toEqual({ data: "ready", fetching: false, error: null });
    release();
    registry.dispose();
  });

  it("fences a late result from the superseded transport generation", async () => {
    const registry = makeRegistry();
    const resolvers: Array<(value: string) => void> = [];
    const binding = makeBinding(
      registry,
      () =>
        new Promise<string>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const input = { key: "generation" };
    const compositeKey = binding.targetKey(input) as string;
    const release = binding.watch(input);
    const stale = registry.controllers.get(compositeKey)?.inFlightPromise;

    registry.fenceActiveEnvironment(environmentId);
    const current = registry.refreshActiveEnvironment(environmentId);
    expect(resolvers).toHaveLength(2);
    resolvers[1]?.("current");
    await current;
    resolvers[0]?.("stale");
    await stale;

    expect(binding.snapshotFor(input).data).toBe("current");
    release();
    registry.dispose();
  });
});

describe("keyed query polling", () => {
  it("shares one timer at the fastest subscriber cadence and reschedules after release", async () => {
    vi.useFakeTimers();
    const run = vi.fn((key: string) => Promise.resolve(`value:${key}`));
    const registry = makeRegistry({ gcTime: 60_000 });
    const binding = makeBinding(registry, run);
    const input = { key: "shared" };

    const releaseSlow = binding.watch(input, () => 30_000);
    const releaseFast = binding.watch(input, () => 10_000);
    await registry.controllers.get(binding.targetKey(input) as string)?.inFlightPromise;
    expect(run).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(9_999);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);

    releaseFast();
    await vi.advanceTimersByTimeAsync(29_999);
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(3);

    releaseSlow();
  });

  it("pauses timers in the background and performs one eligible stale refresh on recovery", async () => {
    vi.useFakeTimers();
    const lifecycleHarness = createLifecycleHarness();
    const run = vi.fn((key: string) => Promise.resolve(`value:${key}`));
    const registry = makeRegistry({ gcTime: 60_000, lifecycle: lifecycleHarness.lifecycle });
    const binding = makeBinding(registry, run);
    const input = { key: "lifecycle" };

    const release = binding.watch(input, {
      resolveIntervalMs: () => 10_000,
      shouldRefreshOnLifecycle: ({ hasData, lastFetchedAt, staleTime }) =>
        !hasData || Date.now() - lastFetchedAt >= staleTime,
    });
    await registry.controllers.get(binding.targetKey(input) as string)?.inFlightPromise;
    expect(run).toHaveBeenCalledTimes(1);

    lifecycleHarness.emit("background");
    await vi.advanceTimersByTimeAsync(70_000);
    expect(run).toHaveBeenCalledTimes(1);

    lifecycleHarness.emit("foreground");
    await vi.runAllTicks();
    expect(run).toHaveBeenCalledTimes(2);

    lifecycleHarness.emit("offline");
    await vi.advanceTimersByTimeAsync(70_000);
    expect(run).toHaveBeenCalledTimes(2);
    lifecycleHarness.emit("online");
    await vi.runAllTicks();
    expect(run).toHaveBeenCalledTimes(3);

    release();
    registry.dispose();
    expect(lifecycleHarness.listenerCount()).toBe(0);
  });

  it("does not schedule or lifecycle-refresh a manual subscriber", async () => {
    vi.useFakeTimers();
    const lifecycleHarness = createLifecycleHarness();
    const run = vi.fn((key: string) => Promise.resolve(`value:${key}`));
    const registry = makeRegistry({ gcTime: 60_000, lifecycle: lifecycleHarness.lifecycle });
    const binding = makeBinding(registry, run);
    const input = { key: "manual" };

    const release = binding.watch(input, {
      resolveIntervalMs: () => false,
      shouldRefreshOnLifecycle: () => false,
    });
    await registry.controllers.get(binding.targetKey(input) as string)?.inFlightPromise;
    await vi.advanceTimersByTimeAsync(120_000);
    lifecycleHarness.emit("background");
    lifecycleHarness.emit("foreground");
    await vi.runAllTicks();

    expect(run).toHaveBeenCalledTimes(1);
    release();
    registry.dispose();
  });
});
