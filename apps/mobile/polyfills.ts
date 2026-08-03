// Hermes (React Native's JS engine) does not yet provide the explicit-resource-
// management well-known symbols (`Symbol.dispose` / `Symbol.asyncDispose`) that
// the Effect runtime uses when it constructs scopes/layers. Without them, the
// first Effect runtime construction throws "undefined is not a function". Define
// them (guarded) before any Effect code loads. Must be imported first in the app
// entry, before `./src/App`.
const globalSymbol = Symbol as unknown as {
  dispose?: symbol;
  asyncDispose?: symbol;
};

if (typeof globalSymbol.dispose !== "symbol") {
  globalSymbol.dispose = Symbol.for("Symbol.dispose");
}
if (typeof globalSymbol.asyncDispose !== "symbol") {
  globalSymbol.asyncDispose = Symbol.for("Symbol.asyncDispose");
}

type ArrayCompatibilityPrototype = {
  toSorted?: (
    this: ReadonlyArray<unknown>,
    compareFn?: (left: unknown, right: unknown) => number,
  ) => Array<unknown>;
  toReversed?: (this: ReadonlyArray<unknown>) => Array<unknown>;
};

/**
 * Install the change-array-by-copy methods used by the mobile app and shared
 * client runtime. `index.ts` imports this module before the application graph.
 * The supported Hermes development client does not expose these ES2023 methods
 * yet. Without them, the first populated project/thread snapshot fails during
 * render with `undefined is not a function`.
 */
export function installArrayCompatibilityPolyfills(prototype: ArrayCompatibilityPrototype): void {
  if (typeof prototype.toSorted !== "function") {
    Object.defineProperty(prototype, "toSorted", {
      configurable: true,
      enumerable: false,
      writable: true,
      value(
        this: ReadonlyArray<unknown>,
        compareFn?: (left: unknown, right: unknown) => number,
      ): Array<unknown> {
        // eslint-disable-next-line unicorn/no-array-sort -- This is the toSorted compatibility implementation.
        return Array.from(this).sort(compareFn);
      },
    });
  }

  if (typeof prototype.toReversed !== "function") {
    Object.defineProperty(prototype, "toReversed", {
      configurable: true,
      enumerable: false,
      writable: true,
      value(this: ReadonlyArray<unknown>): Array<unknown> {
        // eslint-disable-next-line unicorn/no-array-reverse -- This is the toReversed compatibility implementation.
        return Array.from(this).reverse();
      },
    });
  }
}

installArrayCompatibilityPolyfills(Array.prototype);

// ─── relay E2EE runtime globals (docs/relay-e2ee-protocol.md §14.5) ──────────
//
// Both installs below are LOAD-ORDER constraints, not runtime ones, which is why
// they live in the entry polyfill module rather than beside the code that needs
// them:
//
// - `@noble/hashes/esm/crypto.js` captures `globalThis.crypto` into a module
//   `const` while it evaluates, and `randomBytes` throws when that capture is
//   `undefined`. A `crypto.getRandomValues` installed after the first noble
//   import is already too late.
// - `cborg/lib/byte-utils.js` constructs a `TextEncoder` at module scope, so the
//   §3.6 canonical codec fails to load at all when the global is absent.
//
// Hermes provides neither. Expo's winter runtime installs `TextDecoder` and not
// `TextEncoder`, and React Native's core setup installs neither.

type RandomFill = (array: Uint8Array) => Uint8Array;

// The host's own `getRandomValues` is only ever detected, never called from
// here, so it is typed as `unknown`: the DOM signature is generic over the view
// type and narrowing it would make a real `globalThis` unassignable.
export interface E2eeCsprngHost {
  crypto?: { getRandomValues?: unknown } | undefined;
}

export interface E2eeTextEncoderHost {
  TextEncoder?: unknown;
}

type ExpoCryptoModule = { readonly getRandomValues: RandomFill };

/**
 * The §14.5 approved React Native adapter, reached through a lazy `require`
 * inside the installed function and never at module scope: `expo-crypto` calls
 * `requireNativeModule("ExpoCrypto")` while it evaluates, which would pull
 * `expo-modules-core` in ahead of `react-native/Libraries/Core/InitializeCore`
 * — the order expo's own winter runtime warns must come first — and would throw
 * during startup on any build whose native module is not yet registered. The
 * installed function exists before the first noble import either way; only the
 * first draw touches the native module.
 *
 * `getRandomValues` and not `getRandomBytes`: `getRandomBytes` substitutes
 * `Math.random` in a development build with a remote debugger attached, which is
 * exactly the non-CSPRNG fallback §14.5 forbids. `getRandomValues` has no such
 * branch — it delegates to the native module unguarded, so it throws (or, in the
 * worst case, no-ops) rather than degrading silently. `src/platform/e2eeRuntime`
 * is the preflight that turns both of those into a refusal.
 */
function expoCryptoRandomFill(array: Uint8Array): Uint8Array {
  return (require("expo-crypto") as ExpoCryptoModule).getRandomValues(array);
}

/** Which implementation a global ended up with. Reported by the vector runner. */
export type E2eeGlobalProvenance = "platform" | "adapter";

/**
 * Install the §14.5 CSPRNG adapter on `host` when it has none.
 *
 * A host that already exposes `crypto.getRandomValues` — a Hermes build that
 * grows one, or a test host standing in for it — is left completely untouched:
 * the platform implementation is always preferred over the adapter.
 */
export function installE2eeCsprng(
  host: E2eeCsprngHost,
  randomFill: RandomFill = expoCryptoRandomFill,
): E2eeGlobalProvenance {
  const existing = host.crypto;
  if (existing !== undefined && typeof existing.getRandomValues === "function") return "platform";
  const target = existing ?? {};
  Object.defineProperty(target, "getRandomValues", {
    configurable: true,
    enumerable: false,
    writable: true,
    value: randomFill,
  });
  if (existing === undefined) {
    Object.defineProperty(host, "crypto", {
      configurable: true,
      enumerable: false,
      writable: true,
      value: target,
    });
  }
  return "adapter";
}

/** One code point of a JavaScript string, with lone surrogates already replaced. */
function readCodePoint(source: string, index: number): { value: number; units: number } {
  const first = source.charCodeAt(index);
  if (first < 0xd800 || first > 0xdfff) return { value: first, units: 1 };
  if (first <= 0xdbff && index + 1 < source.length) {
    const second = source.charCodeAt(index + 1);
    if (second >= 0xdc00 && second <= 0xdfff) {
      return { value: (first - 0xd800) * 0x400 + (second - 0xdc00) + 0x10000, units: 2 };
    }
  }
  // https://encoding.spec.whatwg.org/#utf-8-encoder: an unpaired surrogate is
  // encoded as U+FFFD rather than rejected.
  return { value: 0xfffd, units: 1 };
}

function utf8ByteLength(value: number): number {
  if (value < 0x80) return 1;
  if (value < 0x800) return 2;
  if (value < 0x10000) return 3;
  return 4;
}

function writeUtf8(source: string, destination: Uint8Array): { read: number; written: number } {
  let read = 0;
  let written = 0;
  while (read < source.length) {
    const point = readCodePoint(source, read);
    const size = utf8ByteLength(point.value);
    // Whole code points only: a truncated sequence is not UTF-8.
    if (written + size > destination.length) break;
    if (size === 1) {
      destination[written] = point.value;
    } else {
      const lead = size === 2 ? 0xc0 : size === 3 ? 0xe0 : 0xf0;
      destination[written] = lead | (point.value >> ((size - 1) * 6));
      for (let offset = 1; offset < size; offset += 1) {
        destination[written + offset] = 0x80 | ((point.value >> ((size - 1 - offset) * 6)) & 0x3f);
      }
    }
    read += point.units;
    written += size;
  }
  return { read, written };
}

/**
 * The UTF-8 half of the encoding spec, for runtimes that ship only `TextDecoder`.
 *
 * The E2EE path needs it for exact bytes, not convenience: every §7 transcript is
 * canonical CBOR whose `tstr` elements are UTF-8, and those bytes are signed and
 * hashed. Encoding is therefore spec-exact — surrogate pairs combine, unpaired
 * surrogates become U+FFFD — rather than the shorter loop that emits raw code
 * units.
 */
class Utf8TextEncoder {
  get encoding(): string {
    return "utf-8";
  }

  encode(input = ""): Uint8Array {
    const source = String(input);
    let size = 0;
    for (let index = 0; index < source.length; ) {
      const point = readCodePoint(source, index);
      size += utf8ByteLength(point.value);
      index += point.units;
    }
    const destination = new Uint8Array(size);
    writeUtf8(source, destination);
    return destination;
  }

  encodeInto(source: string, destination: Uint8Array): { read: number; written: number } {
    return writeUtf8(String(source), destination);
  }
}

/**
 * Install a UTF-8 `TextEncoder` on `host` when it has none, leaving any platform
 * implementation untouched.
 */
export function installE2eeTextEncoder(host: E2eeTextEncoderHost): E2eeGlobalProvenance {
  if (typeof host.TextEncoder === "function") return "platform";
  Object.defineProperty(host, "TextEncoder", {
    configurable: true,
    enumerable: false,
    writable: true,
    value: Utf8TextEncoder,
  });
  return "adapter";
}

/**
 * Which implementation each global ended up with on THIS runtime, recorded at
 * install time because it is unrecoverable afterwards. Whether Hermes ships
 * either of these is not statically knowable from the checked-in tree, and the
 * §16 vector runner prints this so a device check answers it with evidence.
 */
export const e2eeGlobalProvenance = Object.freeze({
  csprng: installE2eeCsprng(globalThis),
  textEncoder: installE2eeTextEncoder(globalThis),
});
