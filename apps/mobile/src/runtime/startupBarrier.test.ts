import { describe, expect, it, vi } from "vite-plus/test";

import { createMobileRuntimeStartupBarrier } from "./startupBarrier";

describe("mobile runtime startup barrier", () => {
  it("holds connection work until hydration has completed", async () => {
    const barrier = createMobileRuntimeStartupBarrier();
    const events: string[] = [];
    let finishHydration!: () => void;
    const hydrationGate = new Promise<void>((resolve) => {
      finishHydration = resolve;
    });

    barrier.runAfterHydration(
      () => {
        events.push("connect");
      },
      (error) => {
        throw error;
      },
    );
    const hydration = barrier.beginHydration(async () => {
      events.push("hydrate-start");
      await hydrationGate;
      events.push("hydrate-complete");
    }, vi.fn());

    await vi.waitFor(() => expect(events).toEqual(["hydrate-start"]));
    finishHydration();
    await hydration;
    await vi.waitFor(() =>
      expect(events).toEqual(["hydrate-start", "hydrate-complete", "connect"]),
    );
  });

  it("opens the gate after a failed cache read and reports the failure", async () => {
    const barrier = createMobileRuntimeStartupBarrier();
    const failure = new Error("cache unavailable");
    const onHydrationFailure = vi.fn();
    const connect = vi.fn();

    barrier.runAfterHydration(connect, vi.fn());
    await barrier.beginHydration(async () => {
      throw failure;
    }, onHydrationFailure);

    await vi.waitFor(() => expect(connect).toHaveBeenCalledOnce());
    expect(onHydrationFailure).toHaveBeenCalledWith(failure);
  });

  it("runs only one hydration attempt and cancels callbacks from a reset generation", async () => {
    const barrier = createMobileRuntimeStartupBarrier();
    const hydrate = vi.fn(async () => undefined);
    const staleConnect = vi.fn();
    const currentConnect = vi.fn();

    barrier.runAfterHydration(staleConnect, vi.fn());
    barrier.reset();
    barrier.runAfterHydration(currentConnect, vi.fn());
    const first = barrier.beginHydration(hydrate, vi.fn());
    const second = barrier.beginHydration(hydrate, vi.fn());

    expect(second).toBe(first);
    await first;
    await vi.waitFor(() => expect(currentConnect).toHaveBeenCalledOnce());
    expect(staleConnect).not.toHaveBeenCalled();
    expect(hydrate).toHaveBeenCalledOnce();
  });
});
