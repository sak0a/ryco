import { describe, expect, it, vi } from "vite-plus/test";

import {
  requestThreadPinChange,
  resolveThreadPinCommandPresentation,
  toggleThreadPin,
} from "./threadPinning";

function makeDependencies(initialPinned: boolean, confirmResult = true) {
  let pinned = initialPinned;
  const setPinned = vi.fn((_threadKey: string, nextPinned: boolean) => {
    pinned = nextPinned;
  });
  const confirm = vi.fn(async () => confirmResult);
  return {
    dependencies: {
      isPinned: () => pinned,
      setPinned,
      confirm,
    },
    setPinned,
    confirm,
    readPinned: () => pinned,
  };
}

describe("thread pin commands", () => {
  it("disables the active-thread command until a thread is ready", () => {
    expect(resolveThreadPinCommandPresentation({ threadKey: null, pinned: false })).toEqual({
      disabled: true,
      pinned: false,
      title: "Pin current thread",
      description: "Open a thread to pin or unpin it.",
    });
    expect(resolveThreadPinCommandPresentation({ threadKey: "env:thread", pinned: true })).toEqual({
      disabled: false,
      pinned: true,
      title: "Unpin current thread",
      description: undefined,
    });
  });

  it("pins immediately without asking for confirmation", async () => {
    const state = makeDependencies(false);
    await expect(
      requestThreadPinChange(
        {
          threadKey: "env:thread",
          threadTitle: "Thread",
          pinned: true,
          confirmUnpin: true,
        },
        state.dependencies,
      ),
    ).resolves.toBe("changed");
    expect(state.readPinned()).toBe(true);
    expect(state.confirm).not.toHaveBeenCalled();
  });

  it("keeps unpin low-friction by default and honors optional cancellation", async () => {
    const immediate = makeDependencies(true);
    await expect(
      toggleThreadPin(
        { threadKey: "env:thread", threadTitle: "Thread", confirmUnpin: false },
        immediate.dependencies,
      ),
    ).resolves.toBe("changed");
    expect(immediate.readPinned()).toBe(false);
    expect(immediate.confirm).not.toHaveBeenCalled();

    const guarded = makeDependencies(true, false);
    await expect(
      toggleThreadPin(
        { threadKey: "env:thread", threadTitle: "Important thread", confirmUnpin: true },
        guarded.dependencies,
      ),
    ).resolves.toBe("cancelled");
    expect(guarded.readPinned()).toBe(true);
    expect(guarded.setPinned).not.toHaveBeenCalled();
    expect(guarded.confirm).toHaveBeenCalledWith(expect.stringContaining("Important thread"));
  });
});
