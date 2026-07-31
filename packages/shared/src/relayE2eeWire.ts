import { encode, rfc8949EncodeOptions } from "cborg";

import {
  E2EE_AAD_BYTES,
  E2EE_AEAD_NONCE_BYTES,
  E2EE_AEAD_TAG_BYTES,
  E2EE_CLIENT_HELLO_MAX_BYTES,
  E2EE_COUNTER_FIELD_BYTES,
  E2EE_COUNTER_MAX,
  E2EE_DIRECTION_LABEL_BYTES,
  E2EE_ENVELOPE_DISCRIMINATOR,
  E2EE_ENVELOPE_HEADER_BYTES,
  E2EE_ENVELOPE_OVERHEAD_BYTES,
  E2EE_EPOCH_FIELD_BYTES,
  E2EE_EPOCH_MAX,
  E2EE_HANDSHAKE_REJECT_BYTES,
  E2EE_HANDSHAKE_REJECT_PAD_BYTES,
  E2EE_INNER_TYPE_BYTES,
  E2EE_NEGOTIATION_DISCRIMINATOR,
  E2EE_PROTOCOL_VERSION,
  E2EE_SERVER_ACCEPT_MAX_BYTES,
  E2EE_SESSION_BINDING_HASH_BYTES,
} from "./relayE2eeConstants.ts";

// Wire framing for the Ryco relay E2EE protocol — docs/relay-e2ee-protocol.md
// §3.3 (wire layouts), §3.4 (registries), and §4.3 (post-strip discrimination).
//
// This module is framing only. It holds no keys, performs no AEAD, and decides
// nothing the mode machine (§4.4) decides: it turns bytes into typed structures
// and back, and rejects anything the layouts and registries do not admit.
//
// It parses no negotiation body and defines no body schema — those are §8 and
// §11 and belong to later slices. The single exception is `E2EEHandshakeReject`,
// whose bytes §11.2 fixes completely: it has no body schema to defer, so its one
// conforming record is built here from the pinned canonical-CBOR codec (§3.6)
// and enforced on receipt.
//
// Everything here operates on POST-STRIP payloads — reassembled by the relay
// message assembler and stripped of RELAY_CHUNK_CAPABILITY_PRELUDE (§4.3 step
// 1). Discriminating raw wire bytes is a protocol error: chunk payloads
// legitimately begin RELAY_CHUNK_MAGIC and ciphertext may contain any byte at
// any interior position.
//
// Epochs and counters are `bigint` throughout. §3.1 forbids the IEEE-754
// `number` type for these values, and the uint64 counter range exceeds
// Number.MAX_SAFE_INTEGER by nearly eleven bits, so a `number` counter silently
// loses the very precision nonce uniqueness depends on.
//
// Decoders return typed results rather than throwing, matching
// `relayMessageChunks.ts`: peer bytes are untrusted input, and every reason
// below is a condition the caller maps onto FATAL-PRE or FATAL-POST (§4.4,
// §11). Encoders throw, because the only way to reach one of their guards is a
// local programming error.

export type E2eeDecodeResult<Value, Reason extends string> =
  | { readonly kind: "ok"; readonly value: Value }
  | { readonly kind: "error"; readonly reason: Reason };

// ─── §3.4 registries ─────────────────────────────────────────────────────────
//
// Registry values are not §3.2 constants: §3.2 says each has exactly one
// defining registry, which is §3.4, so they live here rather than in
// `relayE2eeConstants.ts`. Each registry is a union of its wire values, so an
// unregistered value cannot be constructed without an explicit guard, and every
// "all others / reserved" row becomes a type error rather than a silent pass.

/**
 * Suite registry, protocol version 1 (§3.4). `0x01` is
 * `Noise_IK_25519_ChaChaPoly_SHA256` on the signed native tier and
 * `Noise_NX_25519_ChaChaPoly_SHA256` on the unsigned web tier — one id, the
 * tier selects the pattern. All other ids are reserved and rejected.
 */
export const E2EE_SUITE_25519_CHACHAPOLY_SHA256 = 0x01;

export type E2eeSuiteId = typeof E2EE_SUITE_25519_CHACHAPOLY_SHA256;

export function isE2eeSuiteId(value: number): value is E2eeSuiteId {
  return value === E2EE_SUITE_25519_CHACHAPOLY_SHA256;
}

/** Direction label (§3.4), client → node. ASCII `"c2n"`. */
export const E2EE_DIRECTION_CLIENT_TO_NODE = "c2n";
/** Direction label (§3.4), node → client. ASCII `"n2c"`. */
export const E2EE_DIRECTION_NODE_TO_CLIENT = "n2c";

export type E2eeDirection =
  | typeof E2EE_DIRECTION_CLIENT_TO_NODE
  | typeof E2EE_DIRECTION_NODE_TO_CLIENT;

export function isE2eeDirection(value: string): value is E2eeDirection {
  return value === E2EE_DIRECTION_CLIENT_TO_NODE || value === E2EE_DIRECTION_NODE_TO_CLIENT;
}

/** Opaque application RPC message bytes, handed to the RPC layer (§3.4). */
export const E2EE_INNER_TYPE_RPC = 0x01;
/** `E2EEClose` — canonical-CBOR close control (§3.4, §10). */
export const E2EE_INNER_TYPE_CLOSE = 0x02;
/** `E2EEError` — canonical-CBOR bounded encrypted error (§3.4, §11). */
export const E2EE_INNER_TYPE_ERROR = 0x03;
/** `E2EECloseAck` — canonical-CBOR close acknowledgement (§3.4, §10). */
export const E2EE_INNER_TYPE_CLOSE_ACK = 0x04;

export type E2eeInnerRecordType =
  | typeof E2EE_INNER_TYPE_RPC
  | typeof E2EE_INNER_TYPE_CLOSE
  | typeof E2EE_INNER_TYPE_ERROR
  | typeof E2EE_INNER_TYPE_CLOSE_ACK;

export function isE2eeInnerRecordType(value: number): value is E2eeInnerRecordType {
  return (
    value === E2EE_INNER_TYPE_RPC ||
    value === E2EE_INNER_TYPE_CLOSE ||
    value === E2EE_INNER_TYPE_ERROR ||
    value === E2EE_INNER_TYPE_CLOSE_ACK
  );
}

/** `E2EEClientHello`, client → node, bounded by `E2EE_CLIENT_HELLO_MAX_BYTES` (§3.4). */
export const E2EE_NEGOTIATION_TYPE_CLIENT_HELLO = 0x01;
/** `E2EEServerAccept`, node → client, bounded by `E2EE_SERVER_ACCEPT_MAX_BYTES` (§3.4). */
export const E2EE_NEGOTIATION_TYPE_SERVER_ACCEPT = 0x02;
/** `E2EEHandshakeReject`, node → client, exactly `E2EE_HANDSHAKE_REJECT_BYTES` (§3.4). */
export const E2EE_NEGOTIATION_TYPE_HANDSHAKE_REJECT = 0x03;

export type E2eeNegotiationRecordType =
  | typeof E2EE_NEGOTIATION_TYPE_CLIENT_HELLO
  | typeof E2EE_NEGOTIATION_TYPE_SERVER_ACCEPT
  | typeof E2EE_NEGOTIATION_TYPE_HANDSHAKE_REJECT;

export function isE2eeNegotiationRecordType(value: number): value is E2eeNegotiationRecordType {
  return (
    value === E2EE_NEGOTIATION_TYPE_CLIENT_HELLO ||
    value === E2EE_NEGOTIATION_TYPE_SERVER_ACCEPT ||
    value === E2EE_NEGOTIATION_TYPE_HANDSHAKE_REJECT
  );
}

/**
 * The direction the §3.4 registry fixes for a negotiation record type, so the
 * mode machine can reject a misdirected record (§4.4 N5) without restating the
 * registry.
 */
export function e2eeNegotiationRecordDirection(
  recordType: E2eeNegotiationRecordType,
): E2eeDirection {
  return recordType === E2EE_NEGOTIATION_TYPE_CLIENT_HELLO
    ? E2EE_DIRECTION_CLIENT_TO_NODE
    : E2EE_DIRECTION_NODE_TO_CLIENT;
}

/**
 * The total record length bound of a negotiation record type (§3.3). `exact`
 * marks `E2EEHandshakeReject`, whose length is fixed rather than capped: a
 * received reject of any other length is itself malformed (§11.2).
 */
export function e2eeNegotiationRecordBound(recordType: E2eeNegotiationRecordType): {
  readonly maxBytes: number;
  readonly exact: boolean;
} {
  switch (recordType) {
    case E2EE_NEGOTIATION_TYPE_CLIENT_HELLO:
      return { maxBytes: E2EE_CLIENT_HELLO_MAX_BYTES, exact: false };
    case E2EE_NEGOTIATION_TYPE_SERVER_ACCEPT:
      return { maxBytes: E2EE_SERVER_ACCEPT_MAX_BYTES, exact: false };
    case E2EE_NEGOTIATION_TYPE_HANDSHAKE_REJECT:
      return { maxBytes: E2EE_HANDSHAKE_REJECT_BYTES, exact: true };
  }
}

// ─── §3.4 post-strip discrimination ──────────────────────────────────────────

// Legacy JSON payloads always begin `{` or `[`: the pinned RPC serialization
// emits a single JSON object or a JSON array of messages. §3.2 deliberately
// does not make these constants of this protocol — they are properties of the
// pinned serialization — so they stay private to the discriminator.
const LEGACY_JSON_OBJECT_FIRST_BYTE = 0x7b;
const LEGACY_JSON_ARRAY_FIRST_BYTE = 0x5b;

/**
 * The §3.4 class of a post-strip payload. `other` is the class §3.4 calls
 * Malformed and §4.4 calls `OTHER`; `reason` keeps the two rows §3.4 enumerates
 * separately apart, because the zero-length row is reachable in ways the
 * catch-all is not (a `data.payload` of length zero, and a payload consisting
 * of exactly `RELAY_CHUNK_CAPABILITY_PRELUDE`).
 */
export type PostStripPayloadClass =
  | { readonly kind: "envelope" }
  | { readonly kind: "negotiation" }
  | { readonly kind: "legacy-json" }
  | { readonly kind: "other"; readonly reason: "empty" | "unknown_discriminator" };

// Shared singletons: this runs on every inbound payload and none of these
// values carries per-payload state. FROZEN, because a shared singleton that a
// consumer can write to is a shared singleton every later payload inherits: one
// stray assignment would silently reclassify every inbound payload in the
// process, which on this path means misrouting peer bytes.
const ENVELOPE_CLASS: PostStripPayloadClass = Object.freeze({ kind: "envelope" } as const);
const NEGOTIATION_CLASS: PostStripPayloadClass = Object.freeze({ kind: "negotiation" } as const);
const LEGACY_JSON_CLASS: PostStripPayloadClass = Object.freeze({ kind: "legacy-json" } as const);
const EMPTY_CLASS: PostStripPayloadClass = Object.freeze({
  kind: "other",
  reason: "empty",
} as const);
const UNKNOWN_CLASS: PostStripPayloadClass = Object.freeze({
  kind: "other",
  reason: "unknown_discriminator",
} as const);

/**
 * Classify a reassembled, prelude-stripped payload by its first byte (§3.4,
 * §4.3 step 2). This is the receive pipeline's entry point, and it is called
 * only AFTER the relay message assembler — never on raw wire bytes.
 *
 * A zero-length payload has no first byte and matches no class. §3.4 enumerates
 * it rather than leaving it to the catch-all precisely so no implementation
 * treats it as a benign no-op: it is fatal in every state (FATAL-PRE before
 * keys, FATAL-POST after), and it is never silently dropped.
 *
 * Classification is the whole of this function's job. Whether the class is
 * admissible is the mode machine's decision (§4.4), and every class here is
 * fatal in some state.
 */
export function classifyPostStripPayload(payload: Uint8Array): PostStripPayloadClass {
  if (payload.byteLength === 0) return EMPTY_CLASS;
  const first = payload[0];
  if (first === E2EE_ENVELOPE_DISCRIMINATOR) return ENVELOPE_CLASS;
  if (first === E2EE_NEGOTIATION_DISCRIMINATOR) return NEGOTIATION_CLASS;
  if (first === LEGACY_JSON_OBJECT_FIRST_BYTE || first === LEGACY_JSON_ARRAY_FIRST_BYTE) {
    return LEGACY_JSON_CLASS;
  }
  return UNKNOWN_CLASS;
}

// ─── §3.3 envelope ───────────────────────────────────────────────────────────

// Field offsets, exactly as §3.3 tabulates them.
const VERSION_OFFSET = 1;
const SUITE_OFFSET = 2;
const EPOCH_OFFSET = 3;
const COUNTER_OFFSET = 7;
/** The smallest ciphertext a conforming envelope can carry: the inner type byte plus the tag. */
const MIN_CIPHERTEXT_BYTES = E2EE_INNER_TYPE_BYTES + E2EE_AEAD_TAG_BYTES;

export interface E2eeEnvelopeFields {
  /** Suite of the established session; §4.3 checks it before selecting an AEAD. */
  readonly suite: E2eeSuiteId;
  readonly epoch: bigint;
  readonly counter: bigint;
}

export interface E2eeEnvelope extends E2eeEnvelopeFields {
  readonly version: typeof E2EE_PROTOCOL_VERSION;
  /**
   * The exact envelope header. The AAD covers these bytes verbatim (§3.3), so
   * the decoder hands back the received bytes rather than a re-encoding of the
   * parsed fields. A view into the payload, not a copy.
   */
  readonly header: Uint8Array;
  /** AEAD output over the record plaintext, ending in the tag. A view, not a copy. */
  readonly ciphertext: Uint8Array;
}

export type E2eeEnvelopeDecodeError =
  | "bad_discriminator"
  | "truncated"
  | "unsupported_version"
  | "unsupported_suite";

function assertEpochAndCounter(epoch: bigint, counter: bigint): void {
  if (typeof epoch !== "bigint" || epoch < 0n || epoch > E2EE_EPOCH_MAX) {
    throw new TypeError("E2EE envelope epoch must be a bigint within the uint32 field range.");
  }
  if (typeof counter !== "bigint" || counter < 0n || counter > E2EE_COUNTER_MAX) {
    throw new TypeError("E2EE envelope counter must be a bigint within the uint64 field range.");
  }
}

// Big-endian writes and reads done by hand, over bigint. Written by hand for
// the same reason `relayMessageChunks.ts` does it: this stays free of DataView
// aliasing concerns when the caller hands us a subarray of a larger buffer.
function writeUintBe(target: Uint8Array, offset: number, width: number, value: bigint): void {
  let remaining = value;
  for (let index = width - 1; index >= 0; index -= 1) {
    target[offset + index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
}

function readUintBe(bytes: Uint8Array, offset: number, width: number): bigint {
  let value = 0n;
  for (let index = 0; index < width; index += 1) {
    value = (value << 8n) | BigInt(bytes[offset + index]!);
  }
  return value;
}

function writeE2eeEnvelopeHeader(target: Uint8Array, fields: E2eeEnvelopeFields): void {
  if (!isE2eeSuiteId(fields.suite)) {
    throw new TypeError("E2EE envelope suite must be a registered suite id.");
  }
  assertEpochAndCounter(fields.epoch, fields.counter);

  target[0] = E2EE_ENVELOPE_DISCRIMINATOR;
  target[VERSION_OFFSET] = E2EE_PROTOCOL_VERSION;
  target[SUITE_OFFSET] = fields.suite;
  writeUintBe(target, EPOCH_OFFSET, E2EE_EPOCH_FIELD_BYTES, fields.epoch);
  writeUintBe(target, COUNTER_OFFSET, E2EE_COUNTER_FIELD_BYTES, fields.counter);
}

/**
 * Encode the `E2EE_ENVELOPE_HEADER_BYTES` envelope header (§3.3). The header is
 * also the first field of the AAD, so a sender builds it once and passes the
 * same bytes to `e2eeEnvelopeAad` and to the AEAD.
 *
 * `version` is not an input: a conforming sender emits `E2EE_PROTOCOL_VERSION`
 * and nothing else.
 */
export function encodeE2eeEnvelopeHeader(fields: E2eeEnvelopeFields): Uint8Array {
  const header = new Uint8Array(E2EE_ENVELOPE_HEADER_BYTES);
  writeE2eeEnvelopeHeader(header, fields);
  return header;
}

/**
 * Encode a complete envelope: header ‖ ciphertext (§3.3). The header is written
 * straight into the envelope buffer, so one record costs one allocation and one
 * copy of the ciphertext.
 */
export function encodeE2eeEnvelope(
  fields: E2eeEnvelopeFields & { readonly ciphertext: Uint8Array },
): Uint8Array {
  if (fields.ciphertext.byteLength < MIN_CIPHERTEXT_BYTES) {
    // An envelope below E2EE_ENVELOPE_OVERHEAD_BYTES is malformed on the wire;
    // refusing to build one keeps a sender from emitting bytes it would itself
    // reject on receipt.
    throw new TypeError("E2EE envelope ciphertext must cover the inner type byte and the tag.");
  }
  const envelope = new Uint8Array(E2EE_ENVELOPE_HEADER_BYTES + fields.ciphertext.byteLength);
  writeE2eeEnvelopeHeader(envelope, fields);
  envelope.set(fields.ciphertext, E2EE_ENVELOPE_HEADER_BYTES);
  return envelope;
}

/**
 * Decode a post-strip payload the discriminator identified as an envelope
 * (§3.3, §4.3 step 3), in the order §4.3 fixes: length bound, then `version`,
 * then `suite` — all of it before any AEAD implementation is selected.
 *
 * The suite check here is against the §3.4 registry only. The receiver MUST
 * still check the decoded suite against the ESTABLISHED SESSION suite (§4.3
 * step 3); this module holds no session state and cannot do it.
 *
 * Nothing here authenticates anything: the returned ciphertext is unverified
 * peer input until the AEAD says otherwise.
 */
export function decodeE2eeEnvelope(
  payload: Uint8Array,
): E2eeDecodeResult<E2eeEnvelope, E2eeEnvelopeDecodeError> {
  if (payload.byteLength === 0 || payload[0] !== E2EE_ENVELOPE_DISCRIMINATOR) {
    return { kind: "error", reason: "bad_discriminator" };
  }
  if (payload.byteLength < E2EE_ENVELOPE_OVERHEAD_BYTES) {
    return { kind: "error", reason: "truncated" };
  }
  if (payload[VERSION_OFFSET] !== E2EE_PROTOCOL_VERSION) {
    return { kind: "error", reason: "unsupported_version" };
  }
  const suite = payload[SUITE_OFFSET]!;
  if (!isE2eeSuiteId(suite)) {
    return { kind: "error", reason: "unsupported_suite" };
  }
  return {
    kind: "ok",
    value: {
      version: E2EE_PROTOCOL_VERSION,
      suite,
      epoch: readUintBe(payload, EPOCH_OFFSET, E2EE_EPOCH_FIELD_BYTES),
      counter: readUintBe(payload, COUNTER_OFFSET, E2EE_COUNTER_FIELD_BYTES),
      header: payload.subarray(0, E2EE_ENVELOPE_HEADER_BYTES),
      ciphertext: payload.subarray(E2EE_ENVELOPE_HEADER_BYTES),
    },
  };
}

/**
 * The AEAD nonce of §3.3: `epoch ‖ counter`, exactly `E2EE_AEAD_NONCE_BYTES`.
 * These are the envelope's own header fields, so this is byte-identical to
 * `header.subarray(3, E2EE_ENVELOPE_HEADER_BYTES)`.
 */
export function e2eeAeadNonce(epoch: bigint, counter: bigint): Uint8Array {
  assertEpochAndCounter(epoch, counter);
  const nonce = new Uint8Array(E2EE_AEAD_NONCE_BYTES);
  writeUintBe(nonce, 0, E2EE_EPOCH_FIELD_BYTES, epoch);
  writeUintBe(nonce, E2EE_EPOCH_FIELD_BYTES, E2EE_COUNTER_FIELD_BYTES, counter);
  return nonce;
}

/**
 * The AEAD nonce as a view into an envelope header that already exists — the
 * bytes `e2eeAeadNonce` would rebuild, taken from where they already are. This
 * is the receive path's form, and it exists so no caller has to know that the
 * nonce starts at header offset 3.
 */
export function e2eeAeadNonceFromHeader(header: Uint8Array): Uint8Array {
  if (header.byteLength !== E2EE_ENVELOPE_HEADER_BYTES) {
    throw new TypeError("E2EE AEAD nonce requires the exact envelope header.");
  }
  return header.subarray(EPOCH_OFFSET, E2EE_ENVELOPE_HEADER_BYTES);
}

/**
 * The AEAD associated data of §3.3: the exact envelope header, then
 * `sessionBindingHash` (§8), then the direction label of the direction the
 * record travels (§3.4) — `E2EE_AAD_BYTES` in total.
 */
export function e2eeEnvelopeAad(input: {
  readonly header: Uint8Array;
  readonly sessionBindingHash: Uint8Array;
  readonly direction: E2eeDirection;
}): Uint8Array {
  if (input.header.byteLength !== E2EE_ENVELOPE_HEADER_BYTES) {
    throw new TypeError("E2EE AAD requires the exact envelope header.");
  }
  if (input.sessionBindingHash.byteLength !== E2EE_SESSION_BINDING_HASH_BYTES) {
    throw new TypeError("E2EE AAD requires a full-length session binding hash.");
  }
  const aad = new Uint8Array(E2EE_AAD_BYTES);
  aad.set(input.header);
  aad.set(input.sessionBindingHash, E2EE_ENVELOPE_HEADER_BYTES);
  aad.set(
    encodeE2eeDirectionLabel(input.direction),
    E2EE_ENVELOPE_HEADER_BYTES + E2EE_SESSION_BINDING_HASH_BYTES,
  );
  return aad;
}

/**
 * The ASCII bytes of a direction label (§3.4): `"c2n"` is `0x63 0x32 0x6E` and
 * `"n2c"` is `0x6E 0x32 0x63`. A fresh array each call, so no caller can mutate
 * a shared one.
 *
 * The label is AAD, so an unregistered value would not fail here but at the
 * peer's AEAD, one round trip later and with no way to tell it from tampering.
 * Like every other registry encoder in this module, this one refuses it.
 */
export function encodeE2eeDirectionLabel(direction: E2eeDirection): Uint8Array {
  if (!isE2eeDirection(direction)) {
    throw new TypeError("E2EE direction must be a registered direction label.");
  }
  const label = new Uint8Array(E2EE_DIRECTION_LABEL_BYTES);
  for (let index = 0; index < E2EE_DIRECTION_LABEL_BYTES; index += 1) {
    label[index] = direction.charCodeAt(index);
  }
  return label;
}

// ─── §3.3 inner-record framing ───────────────────────────────────────────────

export interface E2eeInnerRecord {
  readonly innerType: E2eeInnerRecordType;
  /** A view into the plaintext, not a copy. Zero-length is valid here (§9.1). */
  readonly body: Uint8Array;
}

export type E2eeInnerRecordDecodeError = "truncated" | "reserved_inner_type";

/**
 * Build a record plaintext: `innerType ‖ body` (§3.3). The size ceiling on
 * `body` is `plaintextCeiling` (§4.5, `e2eeChannelSizeBudget`), which depends on
 * the channel's Hub-asserted limits and so belongs to the sender, not to this
 * framing.
 */
export function encodeE2eeInnerRecord(
  innerType: E2eeInnerRecordType,
  body: Uint8Array,
): Uint8Array {
  if (!isE2eeInnerRecordType(innerType)) {
    throw new TypeError("E2EE inner record type must be a registered type.");
  }
  const plaintext = new Uint8Array(E2EE_INNER_TYPE_BYTES + body.byteLength);
  plaintext[0] = innerType;
  plaintext.set(body, E2EE_INNER_TYPE_BYTES);
  return plaintext;
}

/**
 * Split an AUTHENTICATED record plaintext into its inner type and body (§3.3).
 *
 * §4.3 step 3 is explicit that the inner-record type is read only after
 * authentication succeeds, so this is called on AEAD output and never on
 * received bytes. A reserved type is an error, not a pass-through: §4.4 N10
 * makes it FATAL-POST, because an endpoint that skipped an unknown inner record
 * would let a peer choose which authenticated records the application sees.
 */
export function decodeE2eeInnerRecord(
  plaintext: Uint8Array,
): E2eeDecodeResult<E2eeInnerRecord, E2eeInnerRecordDecodeError> {
  if (plaintext.byteLength < E2EE_INNER_TYPE_BYTES) {
    return { kind: "error", reason: "truncated" };
  }
  const innerType = plaintext[0]!;
  if (!isE2eeInnerRecordType(innerType)) {
    return { kind: "error", reason: "reserved_inner_type" };
  }
  return {
    kind: "ok",
    value: { innerType, body: plaintext.subarray(E2EE_INNER_TYPE_BYTES) },
  };
}

// ─── §3.3 negotiation-record framing ─────────────────────────────────────────

const NEGOTIATION_HEADER_BYTES = 2;

/**
 * The one conforming `E2EEHandshakeReject` body (§11.2): the canonical-CBOR
 * byte string holding exactly `E2EE_HANDSHAKE_REJECT_PAD_BYTES` zero bytes.
 *
 * Produced by the pinned codec (§3.6) rather than written out by hand, so the
 * bytes are canonical by construction; `relayE2eeWire.test.ts` pins the literal
 * record the two together must produce.
 */
const HANDSHAKE_REJECT_BODY: Uint8Array = encode(
  new Uint8Array(E2EE_HANDSHAKE_REJECT_PAD_BYTES),
  rfc8949EncodeOptions,
);

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

export interface E2eeNegotiationRecord {
  readonly recordType: E2eeNegotiationRecordType;
  /**
   * Canonical CBOR (§3.6); the body schemas are defined in §8 and §11. Framing
   * carries the bytes and validates nothing inside them. A view, not a copy.
   */
  readonly body: Uint8Array;
}

export type E2eeNegotiationRecordDecodeError =
  | "bad_discriminator"
  | "truncated"
  | "reserved_record_type"
  | "too_large"
  | "length_mismatch"
  | "non_canonical_reject";

/**
 * Frame a negotiation record: `E2EE_NEGOTIATION_DISCRIMINATOR ‖ recordType ‖
 * body` (§3.3). The per-type total-length bound of §3.3 is enforced on the
 * framed record, so a sender cannot emit a record its peer must reject unread.
 *
 * `E2EEHandshakeReject` additionally admits exactly one body (§11.2). Callers
 * SHOULD reach it through `encodeE2eeHandshakeReject`; the check is here so
 * there is no path through this module that emits a distinguishable reject.
 */
export function encodeE2eeNegotiationRecord(
  recordType: E2eeNegotiationRecordType,
  body: Uint8Array,
): Uint8Array {
  if (!isE2eeNegotiationRecordType(recordType)) {
    throw new TypeError("E2EE negotiation record type must be a registered type.");
  }
  const total = NEGOTIATION_HEADER_BYTES + body.byteLength;
  const bound = e2eeNegotiationRecordBound(recordType);
  if (bound.exact ? total !== bound.maxBytes : total > bound.maxBytes) {
    throw new RangeError("E2EE negotiation record exceeds the bound its type fixes.");
  }
  if (
    recordType === E2EE_NEGOTIATION_TYPE_HANDSHAKE_REJECT &&
    !bytesEqual(body, HANDSHAKE_REJECT_BODY)
  ) {
    throw new TypeError("E2EE handshake reject records are byte-identical; this body is not.");
  }
  const record = new Uint8Array(total);
  record[0] = E2EE_NEGOTIATION_DISCRIMINATOR;
  record[1] = recordType;
  record.set(body, NEGOTIATION_HEADER_BYTES);
  return record;
}

/**
 * The `E2EEHandshakeReject` record (§11.2) — the only pre-key error record, and
 * the only bytes any conforming node emits for one.
 *
 * §11.2 fixes it completely: it carries no cause, no code, no text, and no
 * variable field, because every pre-key failure MUST be indistinguishable from
 * every other one on the wire. There is nothing to parameterize, which is why
 * this takes no arguments; a fresh array each call, so the record a caller is
 * about to write cannot be mutated through a shared one.
 */
export function encodeE2eeHandshakeReject(): Uint8Array {
  return encodeE2eeNegotiationRecord(E2EE_NEGOTIATION_TYPE_HANDSHAKE_REJECT, HANDSHAKE_REJECT_BODY);
}

/**
 * Decode a post-strip payload the discriminator identified as a negotiation
 * record (§3.3, §4.3 step 4). The per-type bound is enforced BEFORE the body is
 * surfaced, as §3.3 requires: a record exceeding its bound is rejected without
 * parsing its body.
 *
 * Negotiation records are accepted only in `negotiating` (§4.4 N5, N6, N11,
 * N13); this decoder does not know the state and the caller MUST apply it.
 *
 * `E2EEHandshakeReject` is checked against its exact bytes, not merely its
 * exact length: §11.2 makes every conforming reject byte-identical, so a
 * 64-byte reject carrying anything else is a peer trying to signal through a
 * record this protocol deliberately left no room to signal in.
 */
export function decodeE2eeNegotiationRecord(
  payload: Uint8Array,
): E2eeDecodeResult<E2eeNegotiationRecord, E2eeNegotiationRecordDecodeError> {
  if (payload.byteLength === 0 || payload[0] !== E2EE_NEGOTIATION_DISCRIMINATOR) {
    return { kind: "error", reason: "bad_discriminator" };
  }
  if (payload.byteLength < NEGOTIATION_HEADER_BYTES) {
    return { kind: "error", reason: "truncated" };
  }
  const recordType = payload[1]!;
  if (!isE2eeNegotiationRecordType(recordType)) {
    return { kind: "error", reason: "reserved_record_type" };
  }
  const bound = e2eeNegotiationRecordBound(recordType);
  if (payload.byteLength > bound.maxBytes) {
    return { kind: "error", reason: "too_large" };
  }
  if (bound.exact && payload.byteLength !== bound.maxBytes) {
    return { kind: "error", reason: "length_mismatch" };
  }
  const body = payload.subarray(NEGOTIATION_HEADER_BYTES);
  if (
    recordType === E2EE_NEGOTIATION_TYPE_HANDSHAKE_REJECT &&
    !bytesEqual(body, HANDSHAKE_REJECT_BODY)
  ) {
    return { kind: "error", reason: "non_canonical_reject" };
  }
  return { kind: "ok", value: { recordType, body } };
}
