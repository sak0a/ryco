import { describe, expect, it, vi } from "vitest";

import {
  NativeIdentityTransactionError,
  createNativeIdentityTransactionCoordinator,
} from "./nativeIdentity.ts";

const ORIGIN = "https://hub.example.test";
const NOW = 1_752_710_400_000;

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("native identity transaction coordinator", () => {
  it("publishes only secret-free phases and returns to idle after success", async () => {
    const coordinator = createNativeIdentityTransactionCoordinator({ now: () => NOW });
    const snapshots: unknown[] = [];
    const unsubscribe = coordinator.subscribe((snapshot) => snapshots.push(snapshot));

    await expect(
      coordinator.run({ origin: ORIGIN, operation: "email_start" }, async () => ({
        attemptSecret: "secret-must-not-enter-snapshot",
      })),
    ).resolves.toEqual({ attemptSecret: "secret-must-not-enter-snapshot" });
    unsubscribe();

    expect(snapshots).toEqual([
      { status: "idle" },
      { status: "running", operation: "email_start" },
      { status: "idle" },
    ]);
    expect(JSON.stringify(snapshots)).not.toContain("secret-must-not-enter-snapshot");
    expect(coordinator.snapshot()).toEqual({ status: "idle" });
  });

  it("supersedes an older operation and prevents its late result from publishing", async () => {
    const coordinator = createNativeIdentityTransactionCoordinator({ now: () => NOW });
    const first = deferred<string>();
    const firstSignal = vi.fn<(signal: AbortSignal) => Promise<string>>(async (signal) => {
      signal.addEventListener("abort", () => undefined);
      return first.promise;
    });
    const older = coordinator.run({ origin: ORIGIN, operation: "email_verify" }, firstSignal);
    const newer = coordinator.run(
      { origin: ORIGIN, operation: "password_start" },
      async () => "new-result",
    );
    first.resolve("stale-result");

    await expect(newer).resolves.toBe("new-result");
    await expect(older).rejects.toMatchObject({ code: "superseded", name: "AbortError" });
    expect(firstSignal.mock.calls[0]?.[0].aborted).toBe(true);
  });

  it("reports an overlapping request for another Hub as an origin change", async () => {
    const coordinator = createNativeIdentityTransactionCoordinator({ now: () => NOW });
    const first = deferred<string>();
    const older = coordinator.run(
      { origin: ORIGIN, operation: "email_verify" },
      async () => first.promise,
    );
    await coordinator.run(
      { origin: "https://other.example.test", operation: "email_start" },
      async () => "new-hub-result",
    );
    first.resolve("stale-result");

    await expect(older).rejects.toMatchObject({ code: "origin_changed", name: "AbortError" });
  });

  it("cancels on explicit request, caller abort, and selected-origin change", async () => {
    for (const cancel of ["explicit", "caller", "origin"] as const) {
      const coordinator = createNativeIdentityTransactionCoordinator({ now: () => NOW });
      const caller = new AbortController();
      const pending = coordinator.run(
        { origin: ORIGIN, operation: "password_finish", signal: caller.signal },
        async (signal) =>
          new Promise<string>((_resolve, reject) => {
            signal.addEventListener("abort", () =>
              reject(new DOMException("cancelled", "AbortError")),
            );
          }),
      );
      if (cancel === "explicit") coordinator.cancel();
      if (cancel === "caller") caller.abort();
      if (cancel === "origin") coordinator.selectOrigin("https://other.example.test");

      await expect(pending).rejects.toMatchObject({
        code: cancel === "origin" ? "origin_changed" : "cancelled",
        name: "AbortError",
      });
      expect(coordinator.snapshot()).toEqual({ status: "idle" });
    }
  });

  it("rejects malformed origins and expired attempts before work", async () => {
    const coordinator = createNativeIdentityTransactionCoordinator({ now: () => NOW });
    const work = vi.fn(async () => "unreachable");

    for (const origin of [
      "http://hub.example.test",
      "https://user@hub.example.test",
      "https://hub.example.test/path",
      "https://hub.example.test/?query=1",
    ]) {
      await expect(
        coordinator.run({ origin, operation: "email_start" }, work),
      ).rejects.toMatchObject({ code: "invalid_origin" });
    }
    await expect(
      coordinator.run({ origin: ORIGIN, operation: "email_verify", expiresAt: NOW - 60_001 }, work),
    ).rejects.toMatchObject({ code: "expired" });
    expect(work).not.toHaveBeenCalled();
  });

  it("rejects a result that becomes expired while work is in flight", async () => {
    let now = NOW;
    const coordinator = createNativeIdentityTransactionCoordinator({ now: () => now });
    const pending = deferred<string>();
    const result = coordinator.run(
      { origin: ORIGIN, operation: "email_verify", expiresAt: NOW + 1_000 },
      async () => pending.promise,
    );
    now = NOW + 61_001;
    pending.resolve("late-result");

    await expect(result).rejects.toMatchObject({ code: "expired" });
  });

  it("uses bounded stable errors without echoing origins or task failures", () => {
    for (const code of [
      "cancelled",
      "expired",
      "invalid_origin",
      "origin_changed",
      "superseded",
    ] as const) {
      const error = new NativeIdentityTransactionError(code);
      expect(error.message.length).toBeLessThanOrEqual(100);
      expect(error.message).not.toContain(ORIGIN);
    }
  });
});
