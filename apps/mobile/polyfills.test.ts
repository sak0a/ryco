import { describe, expect, it, vi } from "vitest";

import {
  installArrayCompatibilityPolyfills,
  installE2eeCsprng,
  installE2eeTextEncoder,
} from "./polyfills";

// EVERY case below operates on an INJECTED host. This suite runs in the default
// Node environment, where `globalThis.crypto` and `globalThis.TextEncoder`
// already exist, so a case that read the ambient globals would pass whether or
// not the installers work.
interface CsprngHost {
  crypto?: { getRandomValues?: unknown };
}
interface TextEncoderHost {
  TextEncoder?: unknown;
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

    installE2eeCsprng(host, randomFill);

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

    installE2eeCsprng(host, randomFill);

    expect(host.crypto).toBe(crypto);
    expect(host.crypto!.getRandomValues).toBe(getRandomValues);
    expect(randomFill).not.toHaveBeenCalled();
  });

  it("fills in the method when a partial crypto object is present", () => {
    const crypto = { randomUUID: () => "" };
    const host: CsprngHost = { crypto };
    const randomFill = vi.fn((array: Uint8Array) => array);

    installE2eeCsprng(host, randomFill);

    expect(host.crypto).toBe(crypto);
    expect(host.crypto!.getRandomValues).toBe(randomFill);
  });

  it("does not touch the randomness source until the first draw", () => {
    const host: CsprngHost = {};
    const randomFill = vi.fn((array: Uint8Array) => array);

    installE2eeCsprng(host, randomFill);

    // `expo-crypto` reaches its native module while it evaluates, so the adapter
    // must be installable without ever having loaded it.
    expect(randomFill).not.toHaveBeenCalled();
  });
});

describe("relay E2EE TextEncoder (§3.6)", () => {
  const encoderFor = (host: TextEncoderHost): { encode: (input?: string) => Uint8Array } =>
    new (host.TextEncoder as new () => { encode: (input?: string) => Uint8Array })();

  it("installs a UTF-8 encoder on a host that has none", () => {
    const host: TextEncoderHost = {};

    installE2eeTextEncoder(host);

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

    installE2eeTextEncoder(host);

    expect(host.TextEncoder).toBe(platform);
  });
});
