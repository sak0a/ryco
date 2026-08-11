import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId } from "@ryco/contracts";

import { createKeyedQueryRegistry, defineKeyedQueryByInput } from "./keyedQuery.ts";

interface State {
  readonly data: string | null;
  readonly fetching: boolean;
  readonly error: Error | null;
}

const initialState: State = { data: null, fetching: false, error: null };
const environmentId = EnvironmentId.make("environment-keyed-query-test");

function makeRegistry(input?: { readonly gcTime?: number; readonly maxEntries?: number }) {
  return createKeyedQueryRegistry<State>({
    labelPrefix: "keyed-query-test",
    initialState,
    gcTime: input?.gcTime ?? 20,
    maxEntries: input?.maxEntries ?? 16,
    buildFetchingState: (current) => ({ ...current, fetching: true, error: null }),
    buildSuccessState: (data) => ({ data: data as string, fetching: false, error: null }),
    buildErrorState: (current, error) => ({ ...current, fetching: false, error }),
  });
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
