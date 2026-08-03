/// <reference types="node" />
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

import {
  installArrayCompatibilityPolyfills,
  installE2eeCsprng,
  installE2eeRuntimeGlobals,
  installE2eeTextEncoder,
} from "./polyfills";

// EVERY case below operates on an INJECTED host. This suite runs in the default
// Node environment, where `globalThis.crypto` and `globalThis.TextEncoder`
// already exist, so a case that read the ambient globals would pass whether or
// not the installers work.
interface CsprngHost {
  crypto?: { getRandomValues?: unknown } | null;
}
interface TextEncoderHost {
  TextEncoder?: unknown;
}

/**
 * Stand `expo-crypto` up in Node's module cache for the duration of `body`.
 *
 * The §14.5 adapter reaches it through `require` inside the installed function —
 * `vi.mock` does not intercept that, and the real module reaches its native
 * module while it evaluates — so the seam is the cache Node consults before it
 * loads anything. `getRandomValues` and `getRandomBytes` are accessors so the
 * case can prove WHICH export the adapter reads and WHEN.
 */
function withExpoCryptoModule(
  exports: { getRandomValues: () => unknown; getRandomBytes: () => unknown },
  body: () => void,
): void {
  const nodeRequire = createRequire(import.meta.url);
  const resolved = nodeRequire.resolve("expo-crypto");
  const previous = nodeRequire.cache[resolved];
  nodeRequire.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports: {
      get getRandomValues() {
        return exports.getRandomValues();
      },
      get getRandomBytes() {
        return exports.getRandomBytes();
      },
    },
  } as unknown as NodeJS.Module;
  try {
    body();
  } finally {
    if (previous === undefined) delete nodeRequire.cache[resolved];
    else nodeRequire.cache[resolved] = previous;
  }
}

describe("mobile Hermes compatibility polyfills", () => {
  it("installs non-mutating array sort and reverse methods when they are missing", () => {
    const prototype: {
      toSorted?: (
        this: ReadonlyArray<unknown>,
        compareFn?: (left: unknown, right: unknown) => number,
      ) => Array<unknown>;
      toReversed?: (this: ReadonlyArray<unknown>) => Array<unknown>;
    } = {};

    installArrayCompatibilityPolyfills(prototype);

    const values = [3, 1, 2];
    expect(prototype.toSorted?.call(values, (left, right) => Number(left) - Number(right))).toEqual(
      [1, 2, 3],
    );
    expect(prototype.toReversed?.call(values)).toEqual([2, 1, 3]);
    expect(values).toEqual([3, 1, 2]);
    expect(Object.keys(prototype)).toEqual([]);
  });

  it("keeps native implementations when Hermes provides them", () => {
    const toSorted = vi.fn(() => ["native-sort"]);
    const toReversed = vi.fn(() => ["native-reverse"]);
    const prototype = { toSorted, toReversed };

    installArrayCompatibilityPolyfills(prototype);

    expect(prototype.toSorted).toBe(toSorted);
    expect(prototype.toReversed).toBe(toReversed);
  });
});

describe("relay E2EE CSPRNG adapter (§14.5)", () => {
  it("installs a non-enumerable crypto.getRandomValues on a host that has none", () => {
    const host: CsprngHost = {};
    const randomFill = vi.fn((array: Uint8Array) => array.fill(7));

    expect(installE2eeCsprng(host, randomFill)).toBe("adapter");

    const target = new Uint8Array(4);
    expect((host.crypto!.getRandomValues as (array: Uint8Array) => Uint8Array)(target)).toBe(
      target,
    );
    expect([...target]).toEqual([7, 7, 7, 7]);
    expect(randomFill).toHaveBeenCalledTimes(1);
    // Nothing here may show up in a spread of the global object.
    expect(Object.keys(host)).toEqual([]);
    expect(Object.keys(host.crypto!)).toEqual([]);
  });

  it("leaves a platform implementation completely untouched", () => {
    const getRandomValues = vi.fn();
    const crypto = { getRandomValues, randomUUID: () => "" };
    const host: CsprngHost = { crypto };
    const randomFill = vi.fn();

    // The provenance is the only place a device run learns which of the two it
    // got (README step 5), so the return value is asserted, not just the effect.
    expect(installE2eeCsprng(host, randomFill)).toBe("platform");

    expect(host.crypto).toBe(crypto);
    expect(host.crypto!.getRandomValues).toBe(getRandomValues);
    expect(randomFill).not.toHaveBeenCalled();
  });

  it("fills in the method when a partial crypto object is present", () => {
    const crypto = { randomUUID: () => "" };
    const host: CsprngHost = { crypto };
    const randomFill = vi.fn((array: Uint8Array) => array);

    expect(installE2eeCsprng(host, randomFill)).toBe("adapter");

    expect(host.crypto).toBe(crypto);
    expect(host.crypto!.getRandomValues).toBe(randomFill);
  });

  it("replaces a null or non-object crypto rather than defining onto it", () => {
    // The install runs at module scope of the app's first import, so a host that
    // presents `crypto` as anything but an object must not throw out of it — and
    // must not report an adapter that landed on a substitute the host never
    // adopted.
    const hosts: CsprngHost[] = [{ crypto: null }, { crypto: 0 as unknown as null }];
    for (const host of hosts) {
      const randomFill = vi.fn((array: Uint8Array) => array);

      expect(installE2eeCsprng(host, randomFill)).toBe("adapter");

      expect(host.crypto!.getRandomValues).toBe(randomFill);
    }
  });

  it("does not touch the randomness source until the first draw", () => {
    const host: CsprngHost = {};
    const randomFill = vi.fn((array: Uint8Array) => array);

    installE2eeCsprng(host, randomFill);

    // `expo-crypto` reaches its native module while it evaluates, so the adapter
    // must be installable without ever having loaded it.
    expect(randomFill).not.toHaveBeenCalled();
  });

  it("draws through expo-crypto's getRandomValues, and never its getRandomBytes", () => {
    // The DEFAULT `randomFill` is the only thing that supplies entropy on a real
    // device, and every case above injects its own. §14.5 admits `getRandomValues`
    // and not `getRandomBytes`: the latter substitutes `Math.random` in a
    // development build with a remote debugger attached, which the preflight
    // cannot catch because that output is neither absent, throwing, nor zero.
    const host: CsprngHost = {};
    // A buffer of the module's own, so the case pins that the adapter hands back
    // what `expo-crypto` returned: `@noble/hashes`' `randomBytes` consumes the
    // RETURN value, and an adapter that returned its argument instead would hand
    // out whatever that buffer happened to hold.
    const moduleBuffer = Uint8Array.from([4, 4, 4]);
    let getRandomValuesReads = 0;
    let filled: Uint8Array | undefined;
    withExpoCryptoModule(
      {
        getRandomValues: () => {
          getRandomValuesReads += 1;
          return (array: Uint8Array) => {
            filled = array;
            return moduleBuffer;
          };
        },
        getRandomBytes: () => {
          throw new Error("getRandomBytes must never be reached");
        },
      },
      () => {
        installE2eeCsprng(host);
        // Nothing is read off the module by the install itself, only by the draw.
        expect(getRandomValuesReads).toBe(0);

        const target = new Uint8Array(3);
        const drawn = (host.crypto!.getRandomValues as (array: Uint8Array) => Uint8Array)(target);

        expect(getRandomValuesReads).toBe(1);
        expect(filled).toBe(target);
        expect(drawn).toBe(moduleBuffer);
      },
    );
  });
});

describe("relay E2EE TextEncoder (§3.6)", () => {
  const encoderFor = (host: TextEncoderHost): { encode: (input?: string) => Uint8Array } =>
    new (host.TextEncoder as new () => { encode: (input?: string) => Uint8Array })();

  it("installs a UTF-8 encoder on a host that has none", () => {
    const host: TextEncoderHost = {};

    expect(installE2eeTextEncoder(host)).toBe("adapter");

    const encoder = encoderFor(host) as {
      encoding: string;
      encode: (input?: string) => Uint8Array;
    };
    expect(encoder.encoding).toBe("utf-8");
    expect(Object.keys(host)).toEqual([]);
    expect([...encoder.encode()]).toEqual([]);
    // One, two, three, and four byte sequences, and the empty string.
    expect([...encoder.encode("ryco")]).toEqual([0x72, 0x79, 0x63, 0x6f]);
    expect([...encoder.encode("é")]).toEqual([0xc3, 0xa9]);
    expect([...encoder.encode("あ")]).toEqual([0xe3, 0x81, 0x82]);
    expect([...encoder.encode("😀")]).toEqual([0xf0, 0x9f, 0x98, 0x80]);
  });

  it("replaces unpaired surrogates with U+FFFD, as the encoding spec requires", () => {
    const host: TextEncoderHost = {};

    installE2eeTextEncoder(host);

    const replacement = [0xef, 0xbf, 0xbd];
    expect([...encoderFor(host).encode("\uD800")]).toEqual(replacement);
    expect([...encoderFor(host).encode("\uDC00")]).toEqual(replacement);
    expect([...encoderFor(host).encode("a\uD800b")]).toEqual([0x61, ...replacement, 0x62]);
  });

  it("agrees with the platform encoder over a mixed-width sample", () => {
    const host: TextEncoderHost = {};

    installE2eeTextEncoder(host);

    const sample = "ryco.node-e2ee-prekey.v1 é あ 😀 \uD800 https://hub.example.com";
    expect([...encoderFor(host).encode(sample)]).toEqual([...new TextEncoder().encode(sample)]);
  });

  it("writes only whole code points through encodeInto", () => {
    const host: TextEncoderHost = {};

    installE2eeTextEncoder(host);

    const encoder = encoderFor(host) as unknown as {
      encodeInto: (source: string, destination: Uint8Array) => { read: number; written: number };
    };
    const destination = new Uint8Array(3);
    expect(encoder.encodeInto("a😀", destination)).toEqual({ read: 1, written: 1 });
    expect([...destination]).toEqual([0x61, 0, 0]);
  });

  it("leaves a platform implementation untouched", () => {
    const platform = vi.fn();
    const host: TextEncoderHost = { TextEncoder: platform };

    expect(installE2eeTextEncoder(host)).toBe("platform");

    expect(host.TextEncoder).toBe(platform);
  });
});

describe("relay E2EE runtime globals wiring", () => {
  it("installs both globals on a host that has neither", () => {
    // This is what runs on Hermes: not the two installers in isolation, but both
    // of them, on one host, before the first noble or cborg import. A regression
    // that drops or reorders the wiring is invisible to the cases above.
    const host: CsprngHost & TextEncoderHost = {};

    const provenance = installE2eeRuntimeGlobals(host);

    expect(provenance).toEqual({ csprng: "adapter", textEncoder: "adapter" });
    expect(Object.isFrozen(provenance)).toBe(true);
    expect(typeof host.crypto!.getRandomValues).toBe("function");
    expect(typeof host.TextEncoder).toBe("function");
    expect(Object.keys(host)).toEqual([]);
  });

  it("installs onto the real globals as the module evaluates", async () => {
    // The wiring that matters on Hermes is the module-scope call, not the
    // function it calls: `@noble/hashes` captures `globalThis.crypto` and `cborg`
    // constructs its `TextEncoder` while THEY evaluate, so both globals must
    // already be there. Node has both, so the only way to observe the install is
    // to take them away and evaluate the module again.
    const globals = globalThis as { crypto?: unknown; TextEncoder?: unknown };
    const descriptors = (["crypto", "TextEncoder"] as const).map(
      (name) => [name, Object.getOwnPropertyDescriptor(globals, name)] as const,
    );
    for (const [name] of descriptors) Reflect.deleteProperty(globals, name);

    try {
      vi.resetModules();
      const evaluated = (await import("./polyfills")) as typeof import("./polyfills");

      expect(evaluated.e2eeGlobalProvenance).toEqual({ csprng: "adapter", textEncoder: "adapter" });
      expect(typeof (globals.crypto as { getRandomValues?: unknown }).getRandomValues).toBe(
        "function",
      );
      expect(typeof globals.TextEncoder).toBe("function");
    } finally {
      for (const [name, descriptor] of descriptors) {
        if (descriptor === undefined) Reflect.deleteProperty(globals, name);
        else Object.defineProperty(globals, name, descriptor);
      }
    }
  });

  it("reports the platform where the host already has both", () => {
    const host: CsprngHost & TextEncoderHost = {
      crypto: { getRandomValues: vi.fn() },
      TextEncoder: vi.fn(),
    };

    expect(installE2eeRuntimeGlobals(host)).toEqual({
      csprng: "platform",
      textEncoder: "platform",
    });
  });
});
