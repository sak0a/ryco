/**
 * The relay-E2EE runtime preflight (docs/relay-e2ee-protocol.md §14.5).
 *
 * §14.5 is fail-closed: an implementation "verifies the source at startup and
 * refuses E2EE, rather than discovering the absence mid-handshake", and there is
 * no non-CSPRNG fallback and no degraded mode. THERE IS DELIBERATELY NO SOFTWARE
 * RNG ANYWHERE IN THIS MODULE — refusing the feature is the only correct
 * outcome, so the only thing this file can do on failure is throw.
 *
 * Presence is not the check. `expo-crypto`'s `getRandomValues` delegates to its
 * native module unguarded (unlike its `getRandomBytes` siblings, which throw
 * `UnavailabilityError`), so a runtime whose native module is missing or asleep
 * can throw OR return the caller's buffer untouched. The preflight therefore
 * DRAWS and inspects the draw.
 *
 * This mirrors `assertHostedRuntimeGlobals` in `./dpopSigner` and does not extend
 * it: that one guards the hosted plane only, and E2EE is not hosted-only.
 */

/** §14.5 preflight draw. One agreement key's worth of bytes, then discarded. */
const E2EE_PREFLIGHT_DRAW_BYTES = 32;

// Fixed, bounded, and free of anything drawn: the operator needs the verdict and
// which of the four conditions produced it, and nothing else may leave here.
const RANDOM_SOURCE_MISSING =
  "End-to-end encryption requires a cryptographic random source this device does not provide.";
const RANDOM_SOURCE_FAILED =
  "End-to-end encryption requires a cryptographic random source, and this device's source failed.";
const RANDOM_SOURCE_DEGENERATE =
  "End-to-end encryption requires a cryptographic random source, and this device's source returned no randomness.";
const TEXT_ENCODER_MISSING =
  "End-to-end encryption requires UTF-8 text encoding this device does not provide.";

/**
 * The globals §14.5 depends on. Injected rather than read off `globalThis` so a
 * test can present a runtime that lacks them; the default is the real one.
 */
export interface E2eeRuntimeHost {
  readonly crypto?: { readonly getRandomValues?: unknown } | undefined;
  readonly TextEncoder?: unknown;
}

/** Non-short-circuiting, so the check reads the whole draw either way. */
function isAllZero(bytes: Uint8Array): boolean {
  let accumulator = 0;
  for (const byte of bytes) accumulator |= byte;
  return accumulator === 0;
}

/**
 * Assert that this runtime can carry relay E2EE, or throw.
 *
 * Callers MUST run this before any key generation or handshake and MUST treat a
 * throw as "E2EE is unavailable on this device" — never as a reason to continue
 * with a weaker source.
 */
export function assertE2eeRuntimeGlobals(host: E2eeRuntimeHost = globalThis): void {
  const source = host.crypto;
  const getRandomValues = source?.getRandomValues;
  if (typeof getRandomValues !== "function") {
    throw new Error(RANDOM_SOURCE_MISSING);
  }

  const probe = new Uint8Array(E2EE_PREFLIGHT_DRAW_BYTES);
  let drawn: unknown;
  try {
    // Bound: an unbound `getRandomValues` throws "Illegal invocation" on a real
    // platform `Crypto`. The cause is dropped rather than chained — it comes out
    // of a native module and the verdict is the same either way.
    drawn = (getRandomValues as (array: Uint8Array) => unknown).call(source, probe);
  } catch {
    probe.fill(0);
    throw new Error(RANDOM_SOURCE_FAILED);
  }

  try {
    // The pinned primitives consume the RETURN value (`@noble/hashes`'
    // `randomBytes` returns `crypto.getRandomValues(new Uint8Array(n))`), so the
    // return value is what has to be sound — not the buffer that went in.
    if (!(drawn instanceof Uint8Array) || drawn.byteLength !== E2EE_PREFLIGHT_DRAW_BYTES) {
      throw new Error(RANDOM_SOURCE_FAILED);
    }
    // A source that silently left the buffer alone is indistinguishable from one
    // that returned zeros, and both are refusals. A conforming CSPRNG produces
    // this draw with probability 2^-256.
    if (isAllZero(drawn)) {
      throw new Error(RANDOM_SOURCE_DEGENERATE);
    }
  } finally {
    probe.fill(0);
    if (drawn instanceof Uint8Array) drawn.fill(0);
  }

  // §3.6 canonical CBOR encodes every transcript `tstr` as UTF-8, and those bytes
  // are signed and hashed; `cborg` builds its encoder at module scope, so an
  // absent `TextEncoder` is a load failure rather than a wrong-bytes failure.
  if (typeof host.TextEncoder !== "function") {
    throw new Error(TEXT_ENCODER_MISSING);
  }
}
