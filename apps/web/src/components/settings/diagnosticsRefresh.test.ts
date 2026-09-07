import { describe, expect, it, vi } from "vitest";
import { createDiagnosticsRefresh } from "./diagnosticsRefresh";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("diagnostics refresh lifetime", () => {
  it("coalesces overlapping requests and permits another after completion", async () => {
    const response = deferred<number>();
    const fetch = vi.fn(() => response.promise);
    const onSuccess = vi.fn();
    const onLoading = vi.fn();
    const controller = createDiagnosticsRefresh({ fetch, onSuccess, onLoading, onError: vi.fn() });
    const first = controller.refresh();
    await controller.refresh();
    expect(fetch).toHaveBeenCalledTimes(1);
    response.resolve(4);
    await first;
    expect(onSuccess).toHaveBeenCalledWith(4);
    expect(onLoading.mock.calls).toEqual([[true], [false]]);
    await controller.refresh();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("ignores a stale environment response without blocking the new environment", async () => {
    const old = deferred<number>();
    const onSuccess = vi.fn();
    const onError = vi.fn();
    const onLoading = vi.fn();
    const controller = createDiagnosticsRefresh({
      fetch: () => old.promise,
      onSuccess,
      onError,
      onLoading,
    });
    const pending = controller.refresh();
    controller.dispose();
    const current = createDiagnosticsRefresh({
      fetch: () => Promise.resolve(2),
      onSuccess,
      onError,
      onLoading,
    });
    await current.refresh();
    old.resolve(1);
    await pending;
    await controller.refresh();
    expect(onSuccess.mock.calls).toEqual([[2]]);
    expect(onLoading.mock.calls).toEqual([[true], [true], [false]]);
  });

  it("ignores failures after disposal and clears pending on live errors", async () => {
    const response = deferred<number>();
    const onError = vi.fn();
    const controller = createDiagnosticsRefresh({
      fetch: () => response.promise,
      onSuccess: vi.fn(),
      onError,
      onLoading: vi.fn(),
    });
    const pending = controller.refresh();
    controller.dispose();
    response.reject(new Error("disconnected"));
    await pending;
    expect(onError).not.toHaveBeenCalled();
    const live = createDiagnosticsRefresh({
      fetch: () => Promise.reject(new Error("offline")),
      onSuccess: vi.fn(),
      onError,
      onLoading: vi.fn(),
    });
    await live.refresh();
    await live.refresh();
    expect(onError).toHaveBeenCalledTimes(2);
  });
});
