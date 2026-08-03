import { describe, expect, it, vi } from "vite-plus/test";

import { assertE2eeRuntimeGlobals } from "./e2eeRuntime";

// EVERY case injects its host. This suite runs in the default Node environment,
// where `crypto` and `TextEncoder` both exist, so a case that read the ambient
// globals would pass whether or not the preflight works.
const workingHost = (
  fill: (array: Uint8Array) => unknown = (array) => array.fill(9),
): { crypto: { getRandomValues: (array: Uint8Array) => unknown }; TextEncoder: unknown } => ({
  crypto: { getRandomValues: fill },
  TextEncoder,
});

describe("relay E2EE runtime preflight (§14.5)", () => {
  it("accepts a runtime with a working source and a text encoder", () => {
    expect(() => assertE2eeRuntimeGlobals(workingHost())).not.toThrow();
  });

  it("draws a full agreement key's worth of bytes and reads the returned array", () => {
    const getRandomValues = vi.fn((array: Uint8Array) => array.fill(1));

    assertE2eeRuntimeGlobals({ crypto: { getRandomValues }, TextEncoder });

    expect(getRandomValues).toHaveBeenCalledTimes(1);
    const drawn = getRandomValues.mock.calls[0]![0];
    expect(drawn.byteLength).toBe(32);
    // The draw is erased before the preflight returns; nothing may outlive it.
    expect([...drawn]).toEqual(Array.from<number>({ length: 32 }).fill(0));
  });

  it("calls the source bound to its own crypto object", () => {
    const crypto = {
      marker: "platform",
      getRandomValues(this: { marker: string }, array: Uint8Array) {
        expect(this.marker).toBe("platform");
        return array.fill(3);
      },
    };

    expect(() => assertE2eeRuntimeGlobals({ crypto, TextEncoder })).not.toThrow();
  });

  it("refuses a runtime with no source at all", () => {
    expect(() => assertE2eeRuntimeGlobals({ crypto: undefined, TextEncoder })).toThrow(
      /cryptographic random source this device does not provide/,
    );
    expect(() => assertE2eeRuntimeGlobals({ crypto: {}, TextEncoder })).toThrow(
      /cryptographic random source this device does not provide/,
    );
    expect(() =>
      assertE2eeRuntimeGlobals({ crypto: { getRandomValues: "not a function" }, TextEncoder }),
    ).toThrow(/cryptographic random source this device does not provide/);
  });

  it("refuses a source that throws, without carrying the cause out", () => {
    const cause = new Error("ExpoCrypto native module secret detail");

    expect(() =>
      assertE2eeRuntimeGlobals(
        workingHost(() => {
          throw cause;
        }),
      ),
    ).toThrow(/this device's source failed/);
    try {
      assertE2eeRuntimeGlobals(
        workingHost(() => {
          throw cause;
        }),
      );
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain("ExpoCrypto");
      expect((error as { cause?: unknown }).cause).toBeUndefined();
    }
  });

  it("refuses a source that returns the wrong thing", () => {
    expect(() => assertE2eeRuntimeGlobals(workingHost(() => undefined))).toThrow(
      /this device's source failed/,
    );
    expect(() => assertE2eeRuntimeGlobals(workingHost(() => new Uint8Array(16)))).toThrow(
      /this device's source failed/,
    );
  });

  it("refuses a source that silently returns no randomness", () => {
    // `expo-crypto`'s `getRandomValues` delegates to its native module unguarded,
    // so a no-op is a real failure mode and asserting the function EXISTS is not
    // enough.
    expect(() => assertE2eeRuntimeGlobals(workingHost((array) => array))).toThrow(
      /returned no randomness/,
    );
  });

  it("does not leak drawn bytes into any refusal", () => {
    const marker = 0xab;
    try {
      assertE2eeRuntimeGlobals({
        crypto: { getRandomValues: (array: Uint8Array) => array.fill(marker) },
        TextEncoder: undefined,
      });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain(String(marker));
      expect((error as Error).message).not.toContain(marker.toString(16));
    }
  });

  it("refuses a runtime with no text encoder", () => {
    expect(() => assertE2eeRuntimeGlobals({ ...workingHost(), TextEncoder: undefined })).toThrow(
      /UTF-8 text encoding this device does not provide/,
    );
  });

  it("has no fallback: every refusal is a throw", () => {
    // §14.5 admits no degraded mode, so the only shapes this function has are
    // "returns undefined" and "throws".
    expect(assertE2eeRuntimeGlobals(workingHost())).toBeUndefined();
  });
});
