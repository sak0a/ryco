import { describe, expect, it, vi } from "vite-plus/test";

import { createSendUndoController, runSendUndoWindow } from "./sendUndoController";

describe("createSendUndoController", () => {
  it("starts armed", () => {
    const controller = createSendUndoController({ onCommit: vi.fn(), onUndo: vi.fn() });
    expect(controller.status).toBe("armed");
  });

  it("commit transitions armed → committed and fires onCommit once", () => {
    const onCommit = vi.fn();
    const onUndo = vi.fn();
    const controller = createSendUndoController({ onCommit, onUndo });

    expect(controller.commit()).toBe(true);
    expect(controller.status).toBe("committed");
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onUndo).not.toHaveBeenCalled();

    // Idempotent: a second commit is a no-op.
    expect(controller.commit()).toBe(false);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("undo transitions armed → undone and fires onUndo once", () => {
    const onCommit = vi.fn();
    const onUndo = vi.fn();
    const controller = createSendUndoController({ onCommit, onUndo });

    expect(controller.undo()).toBe(true);
    expect(controller.status).toBe("undone");
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();

    expect(controller.undo()).toBe(false);
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it("undo after commit is rejected (no silent double-resolve)", () => {
    const onCommit = vi.fn();
    const onUndo = vi.fn();
    const controller = createSendUndoController({ onCommit, onUndo });

    expect(controller.commit()).toBe(true);
    expect(controller.undo()).toBe(false);
    expect(controller.status).toBe("committed");
    expect(onUndo).not.toHaveBeenCalled();
  });

  it("commit after undo is rejected", () => {
    const onCommit = vi.fn();
    const onUndo = vi.fn();
    const controller = createSendUndoController({ onCommit, onUndo });

    expect(controller.undo()).toBe(true);
    expect(controller.commit()).toBe(false);
    expect(controller.status).toBe("undone");
    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe("runSendUndoWindow", () => {
  function makeFakeTimer() {
    let scheduled: (() => void) | null = null;
    const setTimer = vi.fn((callback: () => void) => {
      scheduled = callback;
      return 1 as unknown as ReturnType<typeof setTimeout>;
    });
    const clearTimer = vi.fn();
    return {
      setTimer,
      clearTimer,
      fire() {
        scheduled?.();
      },
    };
  }

  it("auto-commits when the window elapses and disposes the presenter", async () => {
    const timer = makeFakeTimer();
    const dispose = vi.fn();
    const present = vi.fn(() => dispose);

    const promise = runSendUndoWindow({
      windowMs: 4000,
      present,
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
    });

    expect(present).toHaveBeenCalledTimes(1);
    expect(timer.setTimer).toHaveBeenCalledWith(expect.any(Function), 4000);
    expect(dispose).not.toHaveBeenCalled();

    timer.fire();

    await expect(promise).resolves.toBe("committed");
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("resolves undone and clears the timer when the undo control fires", async () => {
    const timer = makeFakeTimer();
    const dispose = vi.fn();
    let triggerUndo: (() => void) | null = null;
    const present = vi.fn((controls: { triggerUndo: () => void }) => {
      triggerUndo = controls.triggerUndo;
      return dispose;
    });

    const promise = runSendUndoWindow({
      windowMs: 4000,
      present,
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
    });

    triggerUndo!();

    await expect(promise).resolves.toBe("undone");
    expect(timer.clearTimer).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);

    // A late timer fire must not flip the result.
    timer.fire();
    await expect(promise).resolves.toBe("undone");
  });
});
