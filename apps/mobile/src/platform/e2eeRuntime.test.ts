import { describe, expect, it, vi } from "vite-plus/test";

import { assertE2eeRuntimeGlobals } from "./e2eeRuntime";

// EVERY case injects its host. This suite runs in the default Node environment,
// where `crypto`, `TextEncoder`, and `TextDecoder` all exist, so a case that read
// the ambient globals would pass whether or not the preflight works.
const workingHost = (
  fill: (array: Uint8Array) => unknown = (array) => array.fill(9),
): {
  crypto: { getRandomValues: (array: Uint8Array) => unknown };
  TextEncoder: unknown;
  TextDecoder: unknown;
} => ({
  crypto: { getRandomValues: fill },
  TextEncoder,
  TextDecoder,
});

describe("relay E2EE runtime preflight (§14.5)", () => {
  it("accepts a runtime with a working source and a text encoder", () => {
    expect(() => assertE2eeRuntimeGlobals(workingHost())).not.toThrow();
  });

  it("draws a full agreement key's worth of bytes and reads the returned array", () => {
    const getRandomValues = vi.fn((array: Uint8Array) => array.fill(1));

    assertE2eeRuntimeGlobals({ crypto: { getRandomValues }, TextEncoder, TextDecoder });

    expect(getRandomValues).toHaveBeenCalledTimes(1);
    const drawn = getRandomValues.mock.calls[0]![0];
    expect(drawn.byteLength).toBe(32);
    // The draw is erased before the preflight returns; nothing may outlive it.
    expect([...drawn]).toEqual(Array.from<number>({ length: 32 }).fill(0));
  });

  it("erases a draw the source hands back in a different buffer", () => {
    // The probe and the RETURNED array are erased separately because a source may
    // return a buffer of its own — `expo-crypto`'s `getRandomBytes` shape — and
    // that buffer is the one the pinned primitives consume. Nothing may outlive
    // the preflight, so this case returns a distinct array and reads it after.
    const returned = Uint8Array.from({ length: 32 }, (_, index) => index + 1);

    assertE2eeRuntimeGlobals(workingHost(() => returned));

    expect([...returned]).toEqual(Array.from<number>({ length: 32 }).fill(0));
  });

  it("calls the source bound to its own crypto object", () => {
    const crypto = {
      marker: "platform",
      getRandomValues(this: { marker: string }, array: Uint8Array) {
        expect(this.marker).toBe("platform");
        return array.fill(3);
      },
    };

    expect(() => assertE2eeRuntimeGlobals({ crypto, TextEncoder, TextDecoder })).not.toThrow();
  });

  it("refuses a runtime with no source at all", () => {
    for (const crypto of [undefined, null, {}, { getRandomValues: "not a function" }]) {
      expect(() => assertE2eeRuntimeGlobals({ crypto, TextEncoder, TextDecoder })).toThrow(
        /cryptographic random source this device does not provide/,
      );
    }
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
        TextDecoder,
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

  it("refuses a runtime with no text decoder", () => {
    // `cborg`'s string codec constructs a `TextDecoder` at module scope and
    // `encode.js` imports it, so ENCODING a §7 transcript needs both globals. The
    // app installs only the encoder — the decoder is Expo's winter runtime, which
    // evaluates after `polyfills.ts` — so a runtime that passes on the encoder
    // alone would still fail at codec load, which is the mid-handshake discovery
    // §14.5 forbids.
    expect(() => assertE2eeRuntimeGlobals({ ...workingHost(), TextDecoder: undefined })).toThrow(
      /UTF-8 text decoding this device does not provide/,
    );
  });

  it("has no fallback: every refusal is a throw", () => {
    // §14.5 admits no degraded mode, so the only shapes this function has are
    // "returns undefined" and "throws".
    expect(assertE2eeRuntimeGlobals(workingHost())).toBeUndefined();
  });
});
