import { expand, extract } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import { encode, rfc8949EncodeOptions } from "cborg";

import {
  E2EE_CROCKFORD_ALPHABET,
  E2EE_SAFETY_NUMBER_DIGITS,
  E2EE_SAFETY_NUMBER_GROUP_BYTES,
  E2EE_SAFETY_NUMBER_GROUP_MODULUS,
  E2EE_SAFETY_NUMBER_HKDF_BYTES,
  E2EE_SESSION_BINDING_HASH_BYTES,
  E2EE_WEB_SAS_CHARS,
  E2EE_WEB_SAS_HKDF_BYTES,
} from "./relayE2eeConstants.ts";
import {
  E2EE_AGREEMENT_ALGORITHM,
  E2EE_CLIENT_IDENTITY_ALGORITHM,
  E2EE_NODE_IDENTITY_ALGORITHM,
  invalidRelayE2eeInput,
  validateE2eeAgreementPublicKey,
  validateE2eeClientIdentityPublicKey,
  validateE2eeNodeIdentityPublicKey,
} from "./relayE2eeKeys.ts";
import { assertE2eeAccountId, canonicalizeE2eeHubOrigin } from "./relayE2eeTranscripts.ts";

// The two owner-facing verification values of the Ryco relay E2EE protocol —
// docs/relay-e2ee-protocol.md §13.4 (native safety number) and §13.5 (`WebSAS`).
//
// Both are DISPLAY ONLY. Neither travels in any protocol message, log, or
// analytics surface; only the §13.2 pending-record copy of the safety number is
// persisted, and the `WebSAS` is ephemeral display state that is never persisted
// at all. Nothing derived here feeds a key schedule.
//
// The two values answer different questions and carry different guarantees, and
// this module deliberately keeps them apart rather than sharing a renderer:
//
//   - The safety number is LONG-TERM. It covers both identity keys and the
//     Hub/account namespace, so the same key pair paired under a different
//     account yields a different number, and its entropy floor is sized against
//     an OFFLINE adversary who may grind candidate key material indefinitely.
//   - The `WebSAS` is PER SESSION. It is salted with `sessionBindingHash`, so it
//     changes on every channel, and session binding buys NON-PRECOMPUTABILITY,
//     NOT UNFORGEABILITY: an interposer running one NX session with each side
//     authors the client-facing accept itself and can grind its own ephemeral
//     until the two strings match. What bounds that is `T_HANDSHAKE` and the
//     one-handshake-attempt-per-channel rule, not this derivation. An
//     implementation MUST NOT present the `WebSAS` as unforgeable against an
//     active interposer, and MUST NOT describe a match as proof that no
//     interposer is present (§13.5, §2.4, §17.5).
//
// The fixed role labels order the inputs, so both endpoints and the node CLI
// derive the identical value with no key-sorting rule. In both renderings the
// fixed length and grouping ARE the checksum: there is no separate check digit
// or check character.

/**
 * §3.5 HKDF label and §3.5 transcript domain of the native safety number. The
 * two strings are deliberately the same value: one names the array's domain,
 * the other the HKDF-Expand `info` (§13.4).
 */
export const E2EE_SAFETY_NUMBER_DOMAIN = "ryco.relay-e2ee.safety-number.v1" as const;
/** §3.5 HKDF label and transcript domain of the `WebSAS`, on the same footing (§13.5). */
export const E2EE_WEB_SAS_DOMAIN = "ryco.relay-e2ee.web-sas.v1" as const;

/** Role label of the node side of both input arrays (§13.4, §13.5). */
export const E2EE_SAFETY_ROLE_NODE = "node" as const;
/** Role label of the native client side of the safety-number input array (§13.4). */
export const E2EE_SAFETY_ROLE_CLIENT = "client" as const;
/** Role label of the web side of the `WebSAS` input array (§13.5). */
export const E2EE_SAFETY_ROLE_WEB = "web" as const;

/** The §3.6 canonical encoding, stated once for both input arrays. */
function encodeSafetyCanonical(elements: readonly unknown[]): Uint8Array {
  return Uint8Array.from(encode(elements, rfc8949EncodeOptions));
}

// ─── §13.4 native safety number ──────────────────────────────────────────────

export interface E2eeSafetyNumberInput {
  readonly nodeIdentityPublicKey: Uint8Array;
  readonly clientIdentityPublicKey: Uint8Array;
  readonly hubOrigin: string;
  readonly accountId: string;
}

export interface E2eeSafetyNumber {
  /** The canonical-CBOR input array (§13.4). */
  readonly input: Uint8Array;
  /** `SHA-256(input)`, used DIRECTLY as the HKDF-Expand pseudorandom key. */
  readonly secret: Uint8Array;
  /** `E2EE_SAFETY_NUMBER_HKDF_BYTES` of HKDF-Expand output. */
  readonly output: Uint8Array;
  /** The rendered `E2EE_SAFETY_NUMBER_DIGITS` display form. */
  readonly display: string;
}

/**
 * The §13.4 input array: a canonical-CBOR array of exactly 9 elements, whose
 * fixed role labels are what let both endpoints and the node CLI derive the same
 * value without any key-sorting rule.
 *
 * The Hub origin and account id bind the namespace, which is what makes the
 * value long-term-meaningful: it is not the per-channel transcript, which
 * re-rolls every channel and is unusable for asynchronous human verification.
 */
export function encodeE2eeSafetyNumberInput(input: E2eeSafetyNumberInput): Uint8Array {
  const nodeIdentityPublicKey = validateE2eeNodeIdentityPublicKey(input.nodeIdentityPublicKey);
  const clientIdentityPublicKey = validateE2eeClientIdentityPublicKey(
    input.clientIdentityPublicKey,
  );
  const hubOrigin = canonicalizeE2eeHubOrigin(input.hubOrigin);
  const accountId = assertE2eeAccountId(input.accountId);
  return encodeSafetyCanonical([
    E2EE_SAFETY_NUMBER_DOMAIN,
    E2EE_SAFETY_ROLE_NODE,
    E2EE_NODE_IDENTITY_ALGORITHM,
    nodeIdentityPublicKey,
    E2EE_SAFETY_ROLE_CLIENT,
    E2EE_CLIENT_IDENTITY_ALGORITHM,
    clientIdentityPublicKey,
    hubOrigin,
    accountId,
  ]);
}

/**
 * The §13.4 derivation and rendering.
 *
 * The SHA-256 digest is used directly as the HKDF-Expand pseudorandom key: there
 * is NO HKDF-Extract step and NO salt. `out` is then consumed in consecutive
 * runs of `E2EE_SAFETY_NUMBER_GROUP_BYTES`, each read as a big-endian unsigned
 * integer, reduced modulo `E2EE_SAFETY_NUMBER_GROUP_MODULUS`, and rendered as a
 * zero-padded five-digit decimal group in derivation order. The modulus bias per
 * group is below one part in ten million and is negligible at this length.
 */
export function deriveE2eeSafetyNumber(input: E2eeSafetyNumberInput): E2eeSafetyNumber {
  const encoded = encodeE2eeSafetyNumberInput(input);
  const secret = sha256(encoded);
  const output = expand(
    sha256,
    secret,
    utf8ToBytes(E2EE_SAFETY_NUMBER_DOMAIN),
    E2EE_SAFETY_NUMBER_HKDF_BYTES,
  );
  return { input: encoded, secret, output, display: renderE2eeSafetyNumber(output) };
}

/**
 * Render `E2EE_SAFETY_NUMBER_HKDF_BYTES` of HKDF output as the
 * `E2EE_SAFETY_NUMBER_DIGITS` display form: `groups` runs of
 * `E2EE_SAFETY_NUMBER_GROUP_BYTES` bytes, each a zero-padded
 * `digitsPerGroup`-digit decimal, joined by the format's separator.
 */
export function renderE2eeSafetyNumber(output: Uint8Array): string {
  if (
    !(output instanceof Uint8Array) ||
    output.byteLength !== E2EE_SAFETY_NUMBER_HKDF_BYTES ||
    E2EE_SAFETY_NUMBER_HKDF_BYTES !==
      E2EE_SAFETY_NUMBER_DIGITS.groups * E2EE_SAFETY_NUMBER_GROUP_BYTES
  ) {
    invalidRelayE2eeInput();
  }
  const groups: string[] = [];
  for (let start = 0; start < output.byteLength; start += E2EE_SAFETY_NUMBER_GROUP_BYTES) {
    let value = 0;
    for (let offset = 0; offset < E2EE_SAFETY_NUMBER_GROUP_BYTES; offset += 1) {
      value = value * 256 + output[start + offset]!;
    }
    groups.push(
      String(value % E2EE_SAFETY_NUMBER_GROUP_MODULUS).padStart(
        E2EE_SAFETY_NUMBER_DIGITS.digitsPerGroup,
        "0",
      ),
    );
  }
  return groups.join(E2EE_SAFETY_NUMBER_DIGITS.separator);
}

// ─── §13.5 `WebSAS` ──────────────────────────────────────────────────────────

export interface E2eeWebSasInput {
  readonly nodeIdentityPublicKey: Uint8Array;
  /** The web client's Noise ephemeral public key for THIS handshake (§6.2). */
  readonly webEphemeralPublicKey: Uint8Array;
  /** The §8.8 session-binding hash, used as the HKDF-Extract salt. */
  readonly sessionBindingHash: Uint8Array;
}

export interface E2eeWebSas {
  /** The canonical-CBOR input array (§13.5). */
  readonly input: Uint8Array;
  /** `HKDF-Extract(salt = sessionBindingHash, IKM = webSasInput)`. */
  readonly prk: Uint8Array;
  /** `E2EE_WEB_SAS_HKDF_BYTES` of HKDF-Expand output. */
  readonly output: Uint8Array;
  /** The rendered `E2EE_WEB_SAS_CHARS` display form. */
  readonly display: string;
}

/**
 * The §13.5 input array: a canonical-CBOR array of exactly 7 elements. Web has
 * no long-term client identity, so the client side of the pair is the
 * per-handshake Noise ephemeral — which is exactly why the value is per session
 * and cannot be the §13.4 safety number.
 */
export function encodeE2eeWebSasInput(
  input: Pick<E2eeWebSasInput, "nodeIdentityPublicKey" | "webEphemeralPublicKey">,
): Uint8Array {
  const nodeIdentityPublicKey = validateE2eeNodeIdentityPublicKey(input.nodeIdentityPublicKey);
  const webEphemeralPublicKey = validateE2eeAgreementPublicKey(input.webEphemeralPublicKey);
  return encodeSafetyCanonical([
    E2EE_WEB_SAS_DOMAIN,
    E2EE_SAFETY_ROLE_NODE,
    E2EE_NODE_IDENTITY_ALGORITHM,
    nodeIdentityPublicKey,
    E2EE_SAFETY_ROLE_WEB,
    E2EE_AGREEMENT_ALGORITHM,
    webEphemeralPublicKey,
  ]);
}

/**
 * The §13.5 derivation and rendering. Unlike §13.4 this one HAS an extract step,
 * and the salt is the §8.8 `sessionBindingHash` — that is the whole of the
 * session binding.
 */
export function deriveE2eeWebSas(input: E2eeWebSasInput): E2eeWebSas {
  if (
    !(input.sessionBindingHash instanceof Uint8Array) ||
    input.sessionBindingHash.byteLength !== E2EE_SESSION_BINDING_HASH_BYTES
  ) {
    invalidRelayE2eeInput();
  }
  const encoded = encodeE2eeWebSasInput(input);
  const prk = extract(sha256, encoded, input.sessionBindingHash);
  const output = expand(sha256, prk, utf8ToBytes(E2EE_WEB_SAS_DOMAIN), E2EE_WEB_SAS_HKDF_BYTES);
  return { input: encoded, prk, output, display: renderE2eeWebSas(output) };
}

/**
 * Render `E2EE_WEB_SAS_HKDF_BYTES` of HKDF output as the `E2EE_WEB_SAS_CHARS`
 * display form: the output is read as a bit string, MOST SIGNIFICANT BIT FIRST,
 * in five-bit groups, each indexing `E2EE_CROCKFORD_ALPHABET`, then split into
 * `groups` runs of `charsPerGroup` joined by the format's separator.
 *
 * The output length is chosen so the bit string divides evenly into five-bit
 * groups; the guard below is what keeps a future length change from silently
 * dropping or inventing trailing bits.
 */
export function renderE2eeWebSas(output: Uint8Array): string {
  if (
    !(output instanceof Uint8Array) ||
    output.byteLength !== E2EE_WEB_SAS_HKDF_BYTES ||
    output.byteLength * 8 !== E2EE_WEB_SAS_CHARS.chars * 5 ||
    E2EE_WEB_SAS_CHARS.chars !== E2EE_WEB_SAS_CHARS.groups * E2EE_WEB_SAS_CHARS.charsPerGroup
  ) {
    invalidRelayE2eeInput();
  }
  let characters = "";
  let accumulator = 0;
  let bits = 0;
  for (const byte of output) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      characters += E2EE_CROCKFORD_ALPHABET[(accumulator >> bits) & 0x1f];
    }
  }
  const groups: string[] = [];
  for (let index = 0; index < characters.length; index += E2EE_WEB_SAS_CHARS.charsPerGroup) {
    groups.push(characters.slice(index, index + E2EE_WEB_SAS_CHARS.charsPerGroup));
  }
  return groups.join(E2EE_WEB_SAS_CHARS.separator);
}
