import { describe, expect, it, vi } from "vite-plus/test";

import { createNativeAuthorizationPhaseStore } from "./nativeAuthorizationState";

describe("native authorization phase store", () => {
  it("publishes only the four secret-free phases", () => {
    const store = createNativeAuthorizationPhaseStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    expect(store.getSnapshot()).toEqual({ phase: "idle", revision: 0 });
    store.opening();
    store.waiting();
    store.cancelled();
    store.idle();

    expect(listener).toHaveBeenCalledTimes(4);
    expect(store.getSnapshot()).toEqual({ phase: "idle", revision: 4 });
    expect(Object.keys(store.getSnapshot())).toEqual(["phase", "revision"]);
    expect(JSON.stringify(store.getSnapshot())).not.toContain("url");
    unsubscribe();
  });

  it("does not notify for a repeated phase", () => {
    const store = createNativeAuthorizationPhaseStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.idle();
    store.opening();
    store.opening();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toEqual({ phase: "opening", revision: 1 });
  });
});
