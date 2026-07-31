import { sha256 } from "@noble/hashes/sha2";
import { encode, rfc8949EncodeOptions } from "cborg";

import {
  E2EE_CLOSE_COMMITMENT_BYTES,
  E2EE_CLOSE_RECORDS_RESERVED,
  E2EE_COUNTER_FIELD_BYTES,
  E2EE_COUNTER_MAX,
  E2EE_EPOCH_FIELD_BYTES,
  E2EE_EPOCH_MAX,
  E2EE_ERROR_BODY_MAX_BYTES,
  E2EE_SESSION_BINDING_HASH_BYTES,
  T_CLOSE,
  T_CLOSE_LINGER_MAX,
} from "./relayE2eeConstants.ts";
import { e2eeBytesEqual } from "./relayE2eeKeys.ts";
import { decodeCanonicalE2eeCbor } from "./relayE2eeTranscripts.ts";
import {
  E2EE_DIRECTION_CLIENT_TO_NODE,
  E2EE_DIRECTION_NODE_TO_CLIENT,
  E2EE_INNER_TYPE_CLOSE,
  E2EE_INNER_TYPE_CLOSE_ACK,
  E2EE_INNER_TYPE_ERROR,
  E2EE_INNER_TYPE_RPC,
  e2eeAeadNonce,
  isE2eeDirection,
  isE2eeInnerRecordType,
  type E2eeDecodeResult,
  type E2eeDirection,
  type E2eeInnerRecordType,
} from "./relayE2eeWire.ts";

// The authenticated close of the Ryco relay E2EE protocol —
// docs/relay-e2ee-protocol.md §10.1 (close records and the close commitment),
// §10.1.1 (the close anchor), §10.2 (the close state machine), §10.3 (outer
// `channel.close` ordering), and §10.4 (close verdicts). It also owns the
// §11.3 `E2EEError` body and its error-code registry, because §10.2's
// terminal-record carve-out is the only place either is read: an authenticated
// `0x03` envelope is the peer's terminal record ONLY if its body conforms to
// §11.3, and a body that does not is §11.3 Q11 rather than a close.
//
// IT OWNS NO KEYS, NO FRAMING, AND NO AEAD. `relayE2eeWire` builds the envelope
// and the inner-record framing (§3.3) and `relayE2eeSession` protects and
// authenticates the records (§9); this module decides WHICH close-machine record
// may be protected next, WHAT its body says, whether a peer's close-machine
// record is admissible, and WHICH §10.4 verdict the endpoint records. The
// sequence fields of a close body are produced by `e2eeAeadNonce` — the very
// encoder that writes the envelope header the body MUST byte-equal (§10.1 fields
// 0–1) — rather than by a second big-endian writer, because a second writer is a
// second chance to disagree with the header.
//
// THE ANCHOR IS THE POINT OF THIS MODULE (§10.1.1). An endpoint's close anchor is
// the §9.2/§9.4 expected-next advance of the position at which it transmitted its
// own FIRST close-machine record. It is frozen at that instant by
// `noteTransmitted` and never recomputed from later next-send state, because in
// the simultaneous branch an honest endpoint is permanently one advance ahead of
// anything its peer could have acknowledged: validating a peer's `E2EECloseAck`
// against current next-send would fail every simultaneous close between two
// conforming endpoints, or — worse — make the outcome depend on whether the peer's
// close and ack happened to be read in the same batch. The two `expectedRecv`
// rules are therefore implemented as two separate code paths that take two
// separate inputs, so no refactor can quietly feed one the other's value: the
// PASSED-THROUGH rule (a received `E2EEClose`) compares against the receiver's
// CURRENT next-send, and the STRICT rule (a received `E2EECloseAck`) compares
// against the receiver's ANCHOR.
//
// RESULTS ARE TYPED FOR PEER INPUT AND THROWN FOR LOCAL MISTAKES, as in
// `relayE2eeWire` and `relayE2eeSession`: every validation failure a peer can
// cause is a §11.3 Q7 row the caller maps onto an `E2EEError`, and every throw
// here is reachable only from a local programming error — building a record the
// machine does not owe, reporting a transmission that does not match the record
// that was built, or asking the strict rule to run without an anchor.
//
// Epochs and counters are `bigint` throughout (§3.1, §9.3). Timestamps are
// milliseconds on the caller's clock, exactly as `relayE2eeHandshake` takes them.

// ─── §9.2/§9.4 sequence positions ────────────────────────────────────────────

/**
 * One direction's `(epoch, counter)` position (§9.2, §9.3) — a next-send
 * position, an expected-next-receive position, a carrying envelope's header
 * fields, or a close anchor.
 */
export interface E2eeSequencePosition {
  readonly epoch: bigint;
  readonly counter: bigint;
}

/**
 * Lexicographic order over `(epoch, counter)`, which is the order the
 * passed-through rule of §10.1 is stated in. Exact over the full field range
 * (§9.3): both members are `bigint` and nothing here narrows them.
 */
export function compareE2eeSequencePositions(
  left: E2eeSequencePosition,
  right: E2eeSequencePosition,
): -1 | 0 | 1 {
  requirePosition(left);
  requirePosition(right);
  if (left.epoch !== right.epoch) return left.epoch < right.epoch ? -1 : 1;
  if (left.counter !== right.counter) return left.counter < right.counter ? -1 : 1;
  return 0;
}

/** Byte-for-byte position equality, for the strict rule and the header check. */
export function e2eeSequencePositionsEqual(
  left: E2eeSequencePosition,
  right: E2eeSequencePosition,
): boolean {
  return compareE2eeSequencePositions(left, right) === 0;
}

/**
 * The §9.2 expected-next advance — the same function §9.4 defines, so a record
 * that completes an epoch advances to `(e + 1, 0)` and NOT to counter + 1 —
 * or `undefined` where §9.6 leaves no such position: a record that completed
 * epoch `E2EE_EPOCH_MAX`, or the defensive counter bound of §9.6.
 * `epochCompleted` is the flag `relayE2eeSession` reports for the record that
 * reached a §9.4 threshold and is therefore the last of its epoch.
 *
 * This is the form for the caller that CANNOT hold a §9.6 proof that the
 * advance exists — the close anchor, which is fixed from a record that has
 * already been transmitted (§10.1.1). `advanceE2eeSequencePosition` is the
 * throwing form for everyone else, and it is defined in terms of this one so
 * the representability rule has a single spelling.
 */
export function nextE2eeSequencePosition(
  position: E2eeSequencePosition,
  epochCompleted: boolean,
): E2eeSequencePosition | undefined {
  requirePosition(position);
  if (epochCompleted) {
    if (position.epoch >= E2EE_EPOCH_MAX) return undefined;
    return { epoch: position.epoch + 1n, counter: 0n };
  }
  if (position.counter >= E2EE_COUNTER_MAX) return undefined;
  return { epoch: position.epoch, counter: position.counter + 1n };
}

/**
 * The §9.2 expected-next advance, for a caller that requires it to exist.
 *
 * Throws when it does not. A conforming endpoint cannot reach that from an
 * ordinary close-machine record: §9.6 requires the whole post-application
 * reserve to be held under both §9.4 thresholds, so a first close-machine
 * record normally has a further record's worth of capacity behind it. The state
 * in which it would arise is §9.6's degenerate state, and §9.6 hands that
 * outcome to **Unclean — abrupt** rather than to an exception.
 *
 * THIS FORM IS THEREFORE FOR A CALLER THAT HAS COMMITTED TO NOTHING. Every
 * position `E2eeCloseMachine` advances is derived either from a record already
 * transmitted (the §10.1.1 anchor) or from a peer record already authenticated
 * (the `expectedRecv` an owed ack declares), and at both of those points a throw
 * would escape after the commitment it cannot undo — so both take
 * `nextE2eeSequencePosition` and both produce §9.6's degenerate state instead.
 * A peer sitting at the boundary of its own sequence space MUST NOT be able to
 * raise an exception inside a conforming endpoint.
 */
export function advanceE2eeSequencePosition(
  position: E2eeSequencePosition,
  epochCompleted: boolean,
): E2eeSequencePosition {
  const next = nextE2eeSequencePosition(position, epochCompleted);
  if (next === undefined) {
    throw new RangeError("Relay E2EE sequence space is spent; no expected-next position exists.");
  }
  return next;
}

function requirePosition(position: E2eeSequencePosition): E2eeSequencePosition {
  if (
    typeof position?.epoch !== "bigint" ||
    typeof position.counter !== "bigint" ||
    position.epoch < 0n ||
    position.epoch > E2EE_EPOCH_MAX ||
    position.counter < 0n ||
    position.counter > E2EE_COUNTER_MAX
  ) {
    throw new TypeError("Relay E2EE sequence positions are bigints within their field ranges.");
  }
  return position;
}

/**
 * The `(epoch, counter)` pair as the two fixed-width big-endian fields §10.1
 * fields 0–3 carry — taken from `e2eeAeadNonce`, which is the envelope header's
 * own `epoch ‖ counter` (§3.3). Copies, so nothing downstream can alias them.
 */
function sequenceFields(position: E2eeSequencePosition): {
  readonly epochField: Uint8Array;
  readonly counterField: Uint8Array;
} {
  const fields = e2eeAeadNonce(position.epoch, position.counter);
  return {
    epochField: fields.slice(0, E2EE_EPOCH_FIELD_BYTES),
    counterField: fields.slice(E2EE_EPOCH_FIELD_BYTES),
  };
}

/** The inverse of the field encoding above, over `bigint` (§3.1). */
function readSequenceField(field: Uint8Array): bigint {
  let value = 0n;
  for (let index = 0; index < field.byteLength; index += 1) {
    value = (value << 8n) | BigInt(field[index]!);
  }
  return value;
}

// ─── §10.1 close records and the close commitment ────────────────────────────

/** §10.1: the first element of the close-commitment preimage. */
export const E2EE_CLOSE_COMMITMENT_DOMAIN = "ryco.relay-e2ee.close.v1" as const;

/** The two close-machine inner record types (§3.4, §10.1). */
export type E2eeCloseRecordType = typeof E2EE_INNER_TYPE_CLOSE | typeof E2EE_INNER_TYPE_CLOSE_ACK;

export function isE2eeCloseRecordType(value: number): value is E2eeCloseRecordType {
  return value === E2EE_INNER_TYPE_CLOSE || value === E2EE_INNER_TYPE_CLOSE_ACK;
}

/** The declared state a close-machine record carries (§10.1 fields 0–3). */
export interface E2eeCloseDeclaration {
  /** Fields 0–1; MUST byte-equal the carrying envelope's epoch and counter. */
  readonly finalSend: E2eeSequencePosition;
  /** Fields 2–3; the sender's §9.2 expected-next for its receive direction. */
  readonly expectedRecv: E2eeSequencePosition;
}

export interface E2eeCloseCommitmentInput extends E2eeCloseDeclaration {
  /** §10.1 preimage element 1: `0x02` close, `0x04` close-ack. */
  readonly innerType: E2eeCloseRecordType;
  /** §10.1 preimage element 2: the SENDER's direction label (§3.4). */
  readonly senderDirection: E2eeDirection;
  /** §8.8 `sessionBindingHash`; binds the commitment to this session. */
  readonly sessionBindingHash: Uint8Array;
}

/**
 * The exact canonical-CBOR array §10.1 hashes:
 *
 * ```text
 * [ "ryco.relay-e2ee.close.v1", innerType, directionLabel,
 *   bstr(sessionBindingHash),
 *   bstr(finalSendEpoch), bstr(finalSendCounter),
 *   bstr(expectedRecvEpoch), bstr(expectedRecvCounter) ]
 * ```
 *
 * Exposed because §7.2's no-ad-hoc-transcript discipline applies to every
 * to-be-hashed structure in this protocol: the commitment preimage has exactly
 * one encoder, and a caller that needs the bytes takes them from here.
 */
export function encodeE2eeCloseCommitmentPreimage(input: E2eeCloseCommitmentInput): Uint8Array {
  const innerType = requireCloseRecordType(input.innerType);
  const senderDirection = requireDirection(input.senderDirection);
  const sessionBindingHash = requireSessionBindingHash(input.sessionBindingHash);
  const finalSend = sequenceFields(input.finalSend);
  const expectedRecv = sequenceFields(input.expectedRecv);
  return Uint8Array.from(
    encode(
      [
        E2EE_CLOSE_COMMITMENT_DOMAIN,
        innerType,
        senderDirection,
        sessionBindingHash,
        finalSend.epochField,
        finalSend.counterField,
        expectedRecv.epochField,
        expectedRecv.counterField,
      ],
      rfc8949EncodeOptions,
    ),
  );
}

/**
 * §10.1 `closeCommitment`: SHA-256 over the preimage above. It binds the declared
 * final session state to the session (`sessionBindingHash`), to the direction the
 * record travels, and to the record's role — so a close cannot be replayed as an
 * ack, in the reverse direction, or into another session.
 */
export function e2eeCloseCommitment(input: E2eeCloseCommitmentInput): Uint8Array {
  const commitment = sha256(encodeE2eeCloseCommitmentPreimage(input));
  if (commitment.byteLength !== E2EE_CLOSE_COMMITMENT_BYTES) {
    throw new TypeError("Relay E2EE close commitment must be E2EE_CLOSE_COMMITMENT_BYTES long.");
  }
  return commitment;
}

/** §10.1: both record bodies are the same canonical-CBOR array of exactly 5 elements. */
const CLOSE_BODY_ELEMENTS = 5;

const CLOSE_BODY_FIELD_WIDTHS: readonly number[] = Object.freeze([
  E2EE_EPOCH_FIELD_BYTES,
  E2EE_COUNTER_FIELD_BYTES,
  E2EE_EPOCH_FIELD_BYTES,
  E2EE_COUNTER_FIELD_BYTES,
  E2EE_CLOSE_COMMITMENT_BYTES,
]);

/**
 * The §10.1 body of an `E2EEClose` or an `E2EECloseAck`. The commitment is
 * COMPUTED here rather than taken as an input: a body paired with a commitment
 * over other fields is precisely the record §10.1 makes a receiver reject, and
 * there is no reason for an encoder to be able to produce one.
 */
export function encodeE2eeCloseRecordBody(input: E2eeCloseCommitmentInput): Uint8Array {
  const finalSend = sequenceFields(input.finalSend);
  const expectedRecv = sequenceFields(input.expectedRecv);
  return Uint8Array.from(
    encode(
      [
        finalSend.epochField,
        finalSend.counterField,
        expectedRecv.epochField,
        expectedRecv.counterField,
        e2eeCloseCommitment(input),
      ],
      rfc8949EncodeOptions,
    ),
  );
}

export interface E2eeCloseRecordBody extends E2eeCloseDeclaration {
  /** Field 0, as received — what §10.1 compares byte-wise against the header. */
  readonly finalSendEpochField: Uint8Array;
  /** Field 1, as received. */
  readonly finalSendCounterField: Uint8Array;
  /** Field 2, as received. */
  readonly expectedRecvEpochField: Uint8Array;
  /** Field 3, as received. */
  readonly expectedRecvCounterField: Uint8Array;
  /** Field 4. */
  readonly closeCommitment: Uint8Array;
}

export type E2eeCloseBodyDecodeError =
  /** Not canonical CBOR at all (§3.6). */
  | "malformed"
  /** Decoded, but does not re-encode to itself (§3.6). */
  | "non_canonical"
  /** A floating-point encoding, which §3.6 forbids in every E2EE structure. */
  | "float_forbidden"
  /** Not an array of exactly 5 byte strings. */
  | "shape"
  /** An element whose length is not the width §10.1 fixes for it. */
  | "field_width";

/**
 * Decode a §10.1 body under the strict canonical profile of §3.6, including the
 * re-encode byte-equality rule: bytes that decode but do not re-encode to
 * themselves are not the bytes the commitment covers, whatever they decode to.
 *
 * This validates the body's SHAPE only. The header equality, the commitment, and
 * the `expectedRecv` rule are `validateE2eeCloseRecord`'s, because each needs
 * receiver state this decoder does not have.
 */
export function decodeE2eeCloseRecordBody(
  body: Uint8Array,
): E2eeDecodeResult<E2eeCloseRecordBody, E2eeCloseBodyDecodeError> {
  const decoded = decodeCanonicalE2eeCbor(body);
  if (decoded.kind === "error") return { kind: "error", reason: decoded.reason };
  const elements = decoded.value;
  if (!Array.isArray(elements) || elements.length !== CLOSE_BODY_ELEMENTS) {
    return { kind: "error", reason: "shape" };
  }
  for (let index = 0; index < CLOSE_BODY_ELEMENTS; index += 1) {
    const element: unknown = elements[index];
    if (!(element instanceof Uint8Array)) return { kind: "error", reason: "shape" };
    if (element.byteLength !== CLOSE_BODY_FIELD_WIDTHS[index]) {
      return { kind: "error", reason: "field_width" };
    }
  }
  const fields = elements as readonly Uint8Array[];
  return {
    kind: "ok",
    value: {
      finalSendEpochField: fields[0]!,
      finalSendCounterField: fields[1]!,
      expectedRecvEpochField: fields[2]!,
      expectedRecvCounterField: fields[3]!,
      closeCommitment: fields[4]!,
      finalSend: {
        epoch: readSequenceField(fields[0]!),
        counter: readSequenceField(fields[1]!),
      },
      expectedRecv: {
        epoch: readSequenceField(fields[2]!),
        counter: readSequenceField(fields[3]!),
      },
    },
  };
}

// ─── §10.1 receiver validation ───────────────────────────────────────────────

export type E2eeCloseValidationFailure =
  /** Strict decode, re-encode equality, shape, or field width (§3.6, §10.1). */
  | "malformed_body"
  /** Fields 0–1 do not byte-equal the carrying envelope header (§10.1). */
  | "header_mismatch"
  /** The recomputed commitment does not equal field 4 (§10.1). */
  | "commitment_mismatch"
  /** A received `E2EEClose` declared more than the receiver's current next-send. */
  | "passed_through_rule"
  /** A received `E2EECloseAck` did not exactly equal the receiver's close anchor. */
  | "strict_rule";

export type E2eeCloseValidation =
  | { readonly kind: "ok"; readonly value: E2eeCloseRecordBody }
  | {
      readonly kind: "invalid";
      readonly reason: E2eeCloseValidationFailure;
      /** Present for `malformed_body`, for local diagnosis only. */
      readonly decodeError?: E2eeCloseBodyDecodeError;
    };

export interface E2eeCloseValidationInput {
  readonly innerType: E2eeCloseRecordType;
  readonly body: Uint8Array;
  /** The carrying envelope's header fields (§10.1 fields 0–1). */
  readonly envelope: E2eeSequencePosition;
  readonly sessionBindingHash: Uint8Array;
  /** The direction the record TRAVELLED — the peer's send direction (§3.4). */
  readonly senderDirection: E2eeDirection;
  /**
   * §10.1 passed-through rule input, read ONLY for a received `E2EEClose`: the
   * receiver's own CURRENT next-send, a state the peer's receive window could
   * legitimately hold because records may still be in flight.
   */
  readonly currentNextSend: E2eeSequencePosition;
  /**
   * §10.1.1 strict rule input, read ONLY for a received `E2EECloseAck`: the
   * receiver's close anchor. Never its current next-send — in the simultaneous
   * branch the two differ by construction for an honest pair.
   */
  readonly closeAnchor?: E2eeSequencePosition | undefined;
}

/**
 * The complete §10.1 receiver check, in the order §10.1 states it: strict decode
 * with re-encode equality, fields 0–1 equal to the carrying envelope header, the
 * recomputed commitment equal to field 4, and then the `expectedRecv` rule the
 * record's type selects. Any failure is FATAL-POST (§11.3 Q7) and the endpoint's
 * verdict is **Failed** (§10.4) — never one of the unattributed unclean verdicts.
 *
 * The record type — not a caller-supplied flag — selects the rule, and the two
 * rules read two different fields of this input. A caller cannot apply the strict
 * rule to a close, apply the passed-through rule to an ack, or hand the strict
 * rule its current next-send while believing it handed it the anchor.
 */
export function validateE2eeCloseRecord(input: E2eeCloseValidationInput): E2eeCloseValidation {
  const innerType = requireCloseRecordType(input.innerType);
  const senderDirection = requireDirection(input.senderDirection);
  const sessionBindingHash = requireSessionBindingHash(input.sessionBindingHash);
  requirePosition(input.envelope);
  requirePosition(input.currentNextSend);

  const decoded = decodeE2eeCloseRecordBody(input.body);
  if (decoded.kind === "error") {
    return { kind: "invalid", reason: "malformed_body", decodeError: decoded.reason };
  }
  const value = decoded.value;

  // §10.1: fields 0–1 MUST BYTE-EQUAL the carrying envelope's fields. Compared as
  // bytes against the same encoder that wrote the header (§3.3), not as parsed
  // integers, because that is the comparison §10.1 states.
  const header = sequenceFields(input.envelope);
  if (
    !e2eeBytesEqual(value.finalSendEpochField, header.epochField) ||
    !e2eeBytesEqual(value.finalSendCounterField, header.counterField)
  ) {
    return { kind: "invalid", reason: "header_mismatch" };
  }

  const expected = e2eeCloseCommitment({
    innerType,
    senderDirection,
    sessionBindingHash,
    finalSend: value.finalSend,
    expectedRecv: value.expectedRecv,
  });
  if (!e2eeBytesEqual(value.closeCommitment, expected)) {
    return { kind: "invalid", reason: "commitment_mismatch" };
  }

  if (innerType === E2EE_INNER_TYPE_CLOSE) {
    // PASSED-THROUGH RULE (§10.1): less than or equal to the receiver's CURRENT
    // next-send, in lexicographic order.
    if (compareE2eeSequencePositions(value.expectedRecv, input.currentNextSend) > 0) {
      return { kind: "invalid", reason: "passed_through_rule" };
    }
    return { kind: "ok", value };
  }

  // STRICT RULE (§10.1, §10.1.1): EXACTLY EQUAL to the receiver's CLOSE ANCHOR.
  const anchor = input.closeAnchor;
  if (anchor === undefined) {
    throw new TypeError(
      "Relay E2EE strict close-rule requires the receiver's close anchor (§10.1.1).",
    );
  }
  requirePosition(anchor);
  if (!e2eeSequencePositionsEqual(value.expectedRecv, anchor)) {
    return { kind: "invalid", reason: "strict_rule" };
  }
  return { kind: "ok", value };
}

// ─── §10.4 verdicts ──────────────────────────────────────────────────────────

export type E2eeCloseVerdict = "clean" | "unclean_truncation" | "unclean_abrupt" | "failed";

/**
 * §10.4: exactly one verdict per endpoint, resolved **Failed**, then **Unclean —
 * truncation**, then **Unclean — abrupt**, then **Clean**. The same ordering is
 * applied over time: a condition of higher precedence arising after a verdict was
 * recorded supersedes it; a condition of lower or equal precedence never does.
 */
const VERDICT_PRECEDENCE: Readonly<Record<E2eeCloseVerdict, number>> = Object.freeze({
  failed: 3,
  unclean_truncation: 2,
  unclean_abrupt: 1,
  clean: 0,
});

export function e2eeCloseVerdictPrecedence(verdict: E2eeCloseVerdict): number {
  const precedence = VERDICT_PRECEDENCE[verdict];
  if (precedence === undefined) {
    throw new TypeError("Relay E2EE close verdict must be one of the four §10.4 verdicts.");
  }
  return precedence;
}

/** The §10.4 resolution of two candidate verdicts: the higher-precedence one. */
export function resolveE2eeCloseVerdict(
  left: E2eeCloseVerdict,
  right: E2eeCloseVerdict,
): E2eeCloseVerdict {
  return e2eeCloseVerdictPrecedence(right) > e2eeCloseVerdictPrecedence(left) ? right : left;
}

// ─── §11.3 the terminal `E2EEError` record ───────────────────────────────────

/** §11.3: a §4, §9, or §10 fatal condition detected on peer input. */
export const E2EE_ERROR_CODE_PROTOCOL_VIOLATION = 0x01;
/** §11.3: a local failure unrelated to peer input. */
export const E2EE_ERROR_CODE_INTERNAL = 0x02;
/** §11.3: a §13.6 authorization withdrawal or a §12.6 policy withdrawal. */
export const E2EE_ERROR_CODE_POLICY = 0x03;

/**
 * The complete §11.3 error-code registry. §11.3 is its sole definition site and
 * §3.4 delegates to it, so the three codes are spelled once, here.
 */
export type E2eeErrorCode =
  | typeof E2EE_ERROR_CODE_PROTOCOL_VIOLATION
  | typeof E2EE_ERROR_CODE_INTERNAL
  | typeof E2EE_ERROR_CODE_POLICY;

export function isE2eeErrorCode(value: number): value is E2eeErrorCode {
  return (
    value === E2EE_ERROR_CODE_PROTOCOL_VIOLATION ||
    value === E2EE_ERROR_CODE_INTERNAL ||
    value === E2EE_ERROR_CODE_POLICY
  );
}

/** §11.3: the body is the canonical-CBOR array of exactly one element. */
const ERROR_BODY_ELEMENTS = 1;

export interface E2eeErrorRecordBody {
  /** The transmitted code, defined or reserved. */
  readonly errorCode: number;
  /**
   * §11.3: whether the code is one of the three the registry defines. A
   * reserved code is a CONFORMING record — "the channel still closes; a
   * reserved code is not separately actionable" — and never a Q11 condition,
   * so it is reported rather than rejected.
   */
  readonly defined: boolean;
}

export type E2eeErrorBodyDecodeError =
  /** Over `E2EE_ERROR_BODY_MAX_BYTES` (§11.3, Q11's "oversized"). */
  | "oversized"
  /** Not canonical CBOR at all (§3.6). */
  | "malformed"
  /** Decoded, but does not re-encode to itself (§3.6). */
  | "non_canonical"
  /** A floating-point encoding, which §3.6 forbids in every E2EE structure. */
  | "float_forbidden"
  /** Not an array of exactly one unsigned integer. */
  | "shape";

/**
 * The §11.3 body of an `E2EEError`: `[ errorCode (uint) ]` in canonical CBOR.
 *
 * It takes a DEFINED code: §11.3's procedure emits "the applicable code", which
 * is always one of the three, and a sender that emitted a reserved code would
 * be telling its peer nothing it could act on. Reserved codes are decodable but
 * not encodable, exactly as §11.3 states the registry from each side.
 */
export function encodeE2eeErrorRecordBody(errorCode: E2eeErrorCode): Uint8Array {
  if (!isE2eeErrorCode(errorCode)) {
    throw new TypeError("Relay E2EE error records carry a defined §11.3 error code.");
  }
  return Uint8Array.from(encode([errorCode], rfc8949EncodeOptions));
}

/**
 * Decode a §11.3 body under the bound §11.3 fixes and the strict canonical
 * profile of §3.6, including the re-encode byte-equality rule.
 *
 * Every failure here is §11.3 Q11 — "`E2EEError` body oversized, non-canonical,
 * or structurally invalid" — which is a FATAL-POST condition of its own and NOT
 * a valid terminal record: an endpoint that accepted any authenticated `0x03`
 * envelope as the peer's terminal error would close silently on bytes the
 * protocol calls a violation.
 */
export function decodeE2eeErrorRecordBody(
  body: Uint8Array,
): E2eeDecodeResult<E2eeErrorRecordBody, E2eeErrorBodyDecodeError> {
  if (!(body instanceof Uint8Array)) return { kind: "error", reason: "malformed" };
  if (body.byteLength > E2EE_ERROR_BODY_MAX_BYTES) return { kind: "error", reason: "oversized" };
  const decoded = decodeCanonicalE2eeCbor(body);
  if (decoded.kind === "error") return { kind: "error", reason: decoded.reason };
  const elements = decoded.value;
  if (!Array.isArray(elements) || elements.length !== ERROR_BODY_ELEMENTS) {
    return { kind: "error", reason: "shape" };
  }
  const errorCode: unknown = elements[0];
  if (typeof errorCode !== "number" || !Number.isSafeInteger(errorCode) || errorCode < 0) {
    return { kind: "error", reason: "shape" };
  }
  return { kind: "ok", value: { errorCode, defined: isE2eeErrorCode(errorCode) } };
}

// ─── §10.2 the close state machine ───────────────────────────────────────────

/**
 * The branch and role §10.2 assigns an endpoint. `undefined` until the exchange
 * determines it: an endpoint that has sent `E2EEClose` is a sequential initiator
 * or a simultaneous side depending on what arrives next, which is exactly why the
 * anchor is frozen at the record rather than derived from the role.
 */
export type E2eeCloseBranch = "sequential_initiator" | "sequential_responder" | "simultaneous";

export type E2eeCloseState =
  /** The application phase; the close machine has not started. */
  | "open"
  /** Own `E2EEClose` sent; awaiting the peer (wait 1). */
  | "awaiting_ack"
  /** Peer's `E2EEClose` validated with nothing sent; owes `E2EECloseAck` (§10.2 step 2). */
  | "close_received"
  /** Sequential responder: its ack is sent; awaiting the final confirmation (wait 1). */
  | "awaiting_confirmation"
  /** Simultaneous: own close sent and peer's close validated; owes `E2EECloseAck`. */
  | "simultaneous_pending"
  /** Simultaneous: own ack sent; awaiting the peer's ack (wait 2). */
  | "awaiting_simultaneous_ack"
  /** Sequential initiator: peer's ack validated; owes the final confirmation (§10.2 step 3). */
  | "confirmation_due"
  /** The endpoint's exchange is complete (§10.2). */
  | "complete"
  /** Terminal: a fatal condition, a `T_CLOSE` expiry, or the channel ending. */
  | "ended";

/** What the machine currently owes, if anything (§10.2). */
export type E2eeClosePendingRecord = "close_ack" | "final_confirmation";

export interface E2eeCloseRecordToSend {
  readonly innerType: E2eeCloseRecordType;
  /** The §10.1 body to protect, unchanged, at `position`. */
  readonly body: Uint8Array;
  /** The position the body declares; `noteTransmitted` requires the same one. */
  readonly position: E2eeSequencePosition;
  /** Which §10.2 record this is, for diagnosis and for the §10.3 role rules. */
  readonly purpose: "close" | "close_ack" | "final_confirmation";
}

export interface E2eeCloseBuildInput {
  /** The session's CURRENT next-send position; it becomes fields 0–1 (§10.1). */
  readonly sendPosition: E2eeSequencePosition;
  /** The session's §9.2 expected-next receive position; it becomes fields 2–3. */
  readonly expectedRecv: E2eeSequencePosition;
}

export interface E2eeCloseTransmittedInput {
  readonly record: E2eeCloseRecordToSend;
  /** The pair the record actually consumed (§9.3) — the carrying envelope's. */
  readonly epoch: bigint;
  readonly counter: bigint;
  /** §9.4: the record reached a threshold and is the last of its epoch. */
  readonly epochCompleted: boolean;
  /** The instant it was transmitted; a wait this record opens starts here. */
  readonly at: number;
}

export type E2eeCloseFatalReason =
  | E2eeCloseValidationFailure
  | "record_beyond_machine"
  /** §11.3 Q11: an `E2EEError` body that is not a conforming §11.3 record. */
  | "malformed_error_body";

export type E2eeCloseReceiveResult =
  /** An authentic RPC record the close phase still permits to be delivered (§10.2). */
  | { readonly kind: "application" }
  | {
      readonly kind: "close";
      readonly branch: "sequential" | "simultaneous";
      readonly value: E2eeCloseRecordBody;
    }
  | {
      readonly kind: "close_ack";
      /** True once this endpoint's own exchange is complete (§10.2). */
      readonly exchangeComplete: boolean;
      readonly value: E2eeCloseRecordBody;
    }
  /**
   * The peer's terminal `E2EEError` (§11.3), its body decoded and validated. It
   * is NOT a Q7 envelope: the receiver erases secrets and closes WITHOUT
   * replying, and its verdict is **Failed**, which supersedes a **Clean**
   * already recorded (§10.4).
   */
  | { readonly kind: "terminal_error"; readonly value: E2eeErrorRecordBody }
  /**
   * §11.3 Q7, or Q11 for an `E2EEError` body that is not a conforming §11.3
   * record; every reason here yields verdict **Failed** (§10.4).
   */
  | {
      readonly kind: "fatal";
      readonly row: "Q7" | "Q11";
      readonly reason: E2eeCloseFatalReason;
      /** Present for `malformed_error_body`, for local diagnosis only. */
      readonly decodeError?: E2eeErrorBodyDecodeError;
    };

export interface E2eeCloseReceiveInput {
  /** The AUTHENTICATED inner record type (§4.3 step 3). */
  readonly innerType: E2eeInnerRecordType;
  readonly body: Uint8Array;
  /** The carrying envelope's header fields. */
  readonly envelope: E2eeSequencePosition;
  /**
   * §9.4: this record reached a threshold and was the last of its epoch — the
   * flag `relayE2eeSession.unprotect` reports. It is what makes the receiver's
   * expected-next advance across an epoch boundary computable here.
   */
  readonly epochCompleted: boolean;
  /** The receiver's CURRENT next-send, for the passed-through rule only. */
  readonly currentNextSend: E2eeSequencePosition;
  readonly at: number;
}

/** §10.2, §15: at most two `T_CLOSE`-bounded waits per endpoint per close phase. */
const MAX_CLOSE_WAITS = 2;

export interface E2eeCloseMachineOptions {
  /** §8.8 `sessionBindingHash`; it binds every close commitment to this session. */
  readonly sessionBindingHash: Uint8Array;
  /** §3.4: `"c2n"` on a client, `"n2c"` on a node. The other direction is received. */
  readonly sendDirection: E2eeDirection;
}

/**
 * One channel's close machine (§10.2): both branches, the wait-count rule, the
 * anchor, the terminal-`E2EEError` carve-out, the §10.3 ordering inputs, and the
 * §10.4 verdict.
 *
 * PER CHANNEL, SINGLE USE. A close phase ends the channel; there is no reopening.
 *
 * WAIT COUNTING IS NORMATIVE (§10.2). An endpoint's close phase contains exactly
 * one `T_CLOSE`-bounded wait on either sequential path and exactly two on the
 * simultaneous path — the transition into the simultaneous branch does not end
 * the first wait's obligation, and the wait for the peer's ack is a second step.
 * No path admits a third, and NO EVENT RESTARTS OR EXTENDS A WAIT: `#armWait` is
 * the only writer of the deadline, it is reachable only from the transitions
 * §10.2 names, and a third call throws. §3.2.2 L5 charges `T_CLOSE` twice for
 * exactly this reason.
 *
 * The one trace that arms fewer waits than its branch's nominal count is the
 * batched simultaneous read — the peer's close and ack processed before this
 * endpoint sends its own ack — which is the race §10.1.1 makes irrelevant by
 * validating against the anchor. It waits once because there is nothing left to
 * wait for, never three times, and its verdict is unchanged.
 */
export class E2eeCloseMachine {
  readonly #sessionBindingHash: Uint8Array;
  readonly #sendDirection: E2eeDirection;
  readonly #receiveDirection: E2eeDirection;
  #state: E2eeCloseState = "open";
  #branch: E2eeCloseBranch | undefined;
  #anchor: E2eeSequencePosition | undefined;
  #anchorRecord: E2eeCloseRecordType | undefined;
  #anchorUnavailable = false;
  #pending: E2eeCloseRecordToSend | undefined;
  #ackExpectedRecv: E2eeSequencePosition | undefined;
  #ackExpectedRecvUnavailable = false;
  #closeRecordsSent = 0;
  #completed = false;
  #peerAckValidated = false;
  #peerCloseValidated = false;
  #waitsArmed = 0;
  #waitDeadlineAt: number | undefined;
  #lastRecordSender = false;
  #lingerDeadlineAt: number | undefined;
  #terminalErrorSent = false;
  #peerTerminalError = false;
  #verdict: E2eeCloseVerdict | undefined;

  constructor(options: E2eeCloseMachineOptions) {
    this.#sessionBindingHash = Uint8Array.from(
      requireSessionBindingHash(options.sessionBindingHash),
    );
    this.#sendDirection = requireDirection(options.sendDirection);
    this.#receiveDirection =
      this.#sendDirection === E2EE_DIRECTION_CLIENT_TO_NODE
        ? E2EE_DIRECTION_NODE_TO_CLIENT
        : E2EE_DIRECTION_CLIENT_TO_NODE;
  }

  get state(): E2eeCloseState {
    return this.#state;
  }

  /** The §10.2 branch and role, once the exchange has determined it. */
  get branch(): E2eeCloseBranch | undefined {
    return this.#branch;
  }

  /**
   * §10.1.1: the advance of the position at which this endpoint transmitted its
   * OWN FIRST close-machine record, frozen at that instant. Never recomputed.
   */
  get closeAnchor(): E2eeSequencePosition | undefined {
    return this.#anchor;
  }

  /**
   * Which record the anchor names (§10.1.1's per-role table): the endpoint's
   * `E2EEClose` for a sequential initiator and for either side of a simultaneous
   * close, and its `E2EECloseAck` for a sequential responder.
   */
  get closeAnchorRecord(): E2eeCloseRecordType | undefined {
    return this.#anchorRecord;
  }

  /**
   * §9.6's degenerate state: this endpoint's first close-machine record was
   * transmitted at the last position its send direction had, so there is no
   * expected-next position and therefore no §10.1.1 anchor — no peer ack can be
   * validated against one, and the close is already recorded **Unclean —
   * abrupt** (§10.4). Distinct from "no close-machine record sent yet", which
   * leaves `closeAnchor` undefined with this `false`.
   */
  get closeAnchorUnavailable(): boolean {
    return this.#anchorUnavailable;
  }

  /**
   * §10.2, §10.1.1: the `expectedRecv` an owed `E2EECloseAck` MUST declare — this
   * endpoint's §9.2 expected-next receive AS OF PROCESSING THE PEER'S
   * `E2EEClose`, which is the record the ack answers and which is exactly the
   * peer's close anchor.
   *
   * It differs from the endpoint's current expected-next in one case only: the
   * peer's `E2EEClose` and `E2EECloseAck` were read in the same batch and the
   * later one was authenticated before this ack was built. §10.1.1 fixes the
   * VALIDATING side against that race with the anchor; this getter fixes the
   * DECLARING side, so a batching driver cannot emit an ack that declares a
   * position past the peer's anchor and be rejected as Q7 for it.
   *
   * `undefined` when no ack is owed in answer to a peer close — including the
   * sequential initiator's final confirmation, which answers the peer's ack and
   * declares the endpoint's expected-next at that moment — and when §9.6 leaves
   * no such position at all, which `ackExpectedRecvUnavailable` distinguishes.
   *
   * IT IS A PURE READ. The value is resolved once, when the peer's `E2EEClose`
   * is authenticated, by the one advance function §10.1.1 names; recomputing it
   * here through the throwing form would let a peer sitting at the boundary of
   * its own sequence space raise an exception inside this endpoint, one
   * authenticated record after the point where that could still be a rejection.
   */
  get ackExpectedRecv(): E2eeSequencePosition | undefined {
    return this.#ackExpectedRecv;
  }

  /**
   * §9.6's degenerate state, mirrored on the receive side: the peer's
   * `E2EEClose` was carried at the last position its direction had, so this
   * endpoint has no §9.2 expected-next receive to declare and therefore owes no
   * `E2EECloseAck` it could conformingly build. The close is already recorded
   * **Unclean — abrupt** (§10.4) and §9.6 requires NO wire record for it — which
   * is also the only disposition that leaves the peer's own verdict at
   * **Unclean — abrupt**, since a peer whose anchor is likewise unavailable
   * rejects every ack it receives. Distinct from "no ack owed", which leaves
   * `ackExpectedRecv` undefined with this `false`.
   */
  get ackExpectedRecvUnavailable(): boolean {
    return this.#ackExpectedRecvUnavailable;
  }

  /** What §10.2 currently obliges this endpoint to send, if anything. */
  get pendingRecord(): E2eeClosePendingRecord | undefined {
    if (this.#state === "close_received" || this.#state === "simultaneous_pending") {
      // §9.6: with no expected-next to declare there is no conforming ack to
      // build, so nothing is owed and nothing is emitted.
      return this.#ackExpectedRecvUnavailable ? undefined : "close_ack";
    }
    return this.#state === "confirmation_due" ? "final_confirmation" : undefined;
  }

  /** §10.2: close-machine records this endpoint has protected (at most `E2EE_CLOSE_RECORDS_RESERVED`). */
  get closeRecordsSent(): number {
    return this.#closeRecordsSent;
  }

  /** §10.2, §15: `T_CLOSE`-bounded waits armed so far. At most two, never three. */
  get waitsArmed(): number {
    return this.#waitsArmed;
  }

  get waitDeadlineAt(): number | undefined {
    return this.#waitDeadlineAt;
  }

  /** True from this endpoint's first close-machine record, or the peer's, to the end. */
  get closePhaseActive(): boolean {
    return this.#state !== "open";
  }

  /**
   * §10.2: this endpoint's exchange is complete — it survives the channel ending,
   * because §10.4 fixes the verdict when the exchange completes and never at the
   * outer `channel.close`.
   */
  get exchangeComplete(): boolean {
    return this.#completed;
  }

  /**
   * §10.2: after sending `E2EEClose` — and, for every role, after this endpoint's
   * first close-machine record — no further application RPC record may be
   * protected. THE KEEPALIVE `Ping` IS AN APPLICATION RPC RECORD for the purposes
   * of §10 and is covered by this: a `Ping` the close phase stalls is DISCARDED,
   * not buffered, because the channel ends when the phase ends. An implementation
   * that exempted it would move the peer's expected-receive state past this
   * endpoint's §10.1.1 anchor and break every close it participated in.
   */
  get mayProtectApplicationRecord(): boolean {
    return this.#state === "open";
  }

  /**
   * §10.2's carve-out: after its last close-machine record an endpoint MAY — and
   * per §11.3 MUST while the send path is usable — protect EXACTLY ONE
   * `E2EEError`, and nothing after it. Receiving the peer's terminal error ends
   * the channel in both directions, so nothing is protected after that either.
   */
  get mayProtectTerminalError(): boolean {
    return !this.#terminalErrorSent && !this.#peerTerminalError;
  }

  get terminalErrorSent(): boolean {
    return this.#terminalErrorSent;
  }

  /**
   * §10.3: this endpoint transmitted the last close-machine record of the
   * exchange — the sequential initiator's final confirmation, or either side's
   * ack in the simultaneous branch — and therefore holds a proof its peer does
   * not. The sequential responder is deliberately NOT a last-record sender: on
   * validating the final confirmation its exchange is complete and it SHOULD
   * close immediately, which is what ends the initiator's linger.
   */
  get isLastRecordSender(): boolean {
    return this.#lastRecordSender;
  }

  /** §10.3: the implementation-chosen linger bound, at most `T_CLOSE_LINGER_MAX`. */
  get lingerDeadlineAt(): number | undefined {
    return this.#lingerDeadlineAt;
  }

  /** §10.4: the verdict recorded so far, at the instant its condition was met. */
  get verdict(): E2eeCloseVerdict | undefined {
    return this.#verdict;
  }

  /**
   * §10.2 step 1: the initiating `E2EEClose`, the endpoint's final
   * application-phase record. Only from the application phase — an endpoint that
   * has already received the peer's close is the responder of §10.2 step 2 and
   * owes an ack, not a close.
   */
  buildClose(input: E2eeCloseBuildInput): E2eeCloseRecordToSend {
    if (this.#state !== "open") {
      throw new TypeError("Relay E2EE close machine may only initiate from the application phase.");
    }
    return this.#build(E2EE_INNER_TYPE_CLOSE, "close", input);
  }

  /**
   * The `E2EECloseAck` §10.2 currently obliges this endpoint to send: the
   * sequential responder's ack (step 2), either simultaneous side's ack, or the
   * sequential initiator's final confirmation (step 3). All three are inner type
   * `0x04` with strict fields; `purpose` names which one.
   *
   * An ack that answers the peer's `E2EEClose` MUST declare `ackExpectedRecv` —
   * the expected-next as of processing that close (§10.2: "computed after
   * processing the peer's close"). Supplying anything else is a driver ordering
   * error and throws here, rather than producing a record the peer rejects as
   * Q7 one round trip later.
   */
  buildCloseAck(input: E2eeCloseBuildInput): E2eeCloseRecordToSend {
    const pending = this.pendingRecord;
    if (pending === undefined) {
      throw new TypeError("Relay E2EE close machine owes no close acknowledgement in this state.");
    }
    const declaration = this.ackExpectedRecv;
    if (
      declaration !== undefined &&
      !e2eeSequencePositionsEqual(requirePosition(input.expectedRecv), declaration)
    ) {
      throw new TypeError(
        "Relay E2EE close acknowledgement declares the expected-next as of the peer's close.",
      );
    }
    return this.#build(E2EE_INNER_TYPE_CLOSE_ACK, pending, input);
  }

  #build(
    innerType: E2eeCloseRecordType,
    purpose: E2eeCloseRecordToSend["purpose"],
    input: E2eeCloseBuildInput,
  ): E2eeCloseRecordToSend {
    if (this.#terminalErrorSent || this.#peerTerminalError) {
      throw new TypeError("Relay E2EE close machine is terminal; no further record may follow.");
    }
    if (this.#closeRecordsSent >= E2EE_CLOSE_RECORDS_RESERVED) {
      throw new TypeError("Relay E2EE close machine exceeded E2EE_CLOSE_RECORDS_RESERVED records.");
    }
    const position: E2eeSequencePosition = {
      epoch: requirePosition(input.sendPosition).epoch,
      counter: input.sendPosition.counter,
    };
    const expectedRecv: E2eeSequencePosition = {
      epoch: requirePosition(input.expectedRecv).epoch,
      counter: input.expectedRecv.counter,
    };
    const record: E2eeCloseRecordToSend = {
      innerType,
      body: encodeE2eeCloseRecordBody({
        innerType,
        senderDirection: this.#sendDirection,
        sessionBindingHash: this.#sessionBindingHash,
        finalSend: position,
        expectedRecv,
      }),
      position,
      purpose,
    };
    this.#pending = record;
    return record;
  }

  /**
   * Commit a built record that has been protected and handed to the relay. This
   * is where §10.1.1 freezes the anchor — at the endpoint's FIRST close-machine
   * record, from the pair that record actually consumed and the §9.4 flag that
   * says whether it completed its epoch — and where the §10.2 waits are armed.
   *
   * The transmitted pair MUST equal the position the built body declared (§10.1
   * fields 0–1); a mismatch is a local programming error and throws, because a
   * body that disagrees with its own header is a record the peer rejects as Q7.
   */
  noteTransmitted(input: E2eeCloseTransmittedInput): void {
    // EVERY PRECONDITION FIRST, WHILE A THROW IS STILL FREE. From the first
    // mutation below this method is committing a record that is already on the
    // wire, so an argument this method would reject MUST be rejected before the
    // anchor is fixed, the record is counted, or a wait is armed — an
    // exception in the middle of that would leave the machine holding half a
    // transition for a record the peer has already seen.
    const pending = this.#pending;
    if (pending === undefined || pending !== input.record) {
      throw new TypeError("Relay E2EE close machine was told of a record it did not build.");
    }
    requireTimestamp(input.at);
    const transmitted: E2eeSequencePosition = { epoch: input.epoch, counter: input.counter };
    if (!e2eeSequencePositionsEqual(transmitted, pending.position)) {
      throw new TypeError(
        "Relay E2EE close record was protected at a position it does not declare.",
      );
    }
    // The state this record answers MUST still be the state the machine is in.
    // A driver that authenticated an inbound close-machine record between
    // building this one and transmitting it has changed what it owes, and
    // committing the stale transition here would silently lose that obligation.
    if (
      (pending.purpose === "close" && this.#state !== "open") ||
      (pending.purpose === "close_ack" &&
        this.#state !== "close_received" &&
        this.#state !== "simultaneous_pending") ||
      (pending.purpose === "final_confirmation" && this.#state !== "confirmation_due")
    ) {
      throw new TypeError("Relay E2EE close machine left the state this record answers.");
    }
    this.#pending = undefined;
    this.#closeRecordsSent += 1;
    if (this.#anchor === undefined && !this.#anchorUnavailable) {
      // §10.1.1: the anchor is the §9.2/§9.4 expected-next advance of THIS
      // position — so a close-machine record that completes an epoch advances to
      // `(e + 1, 0)` and never to counter + 1 — fixed here and never recomputed
      // from later next-send state.
      const anchor = nextE2eeSequencePosition(transmitted, input.epochCompleted);
      if (anchor === undefined) {
        // §9.6's degenerate state, reached at the exhaustion boundary: this
        // record spent the last of the direction's sequence space, so no
        // expected-next position exists and there is no anchor for a peer ack to
        // equal. §9.6 fixes the outcome as **Unclean — abrupt** and requires no
        // wire record for it; the record itself is already transmitted, so this
        // is a close outcome and never an exception raised mid-close.
        this.#anchorUnavailable = true;
        this.#recordVerdict("unclean_abrupt");
      } else {
        this.#anchor = anchor;
        this.#anchorRecord = pending.innerType;
      }
    }

    switch (pending.purpose) {
      case "close":
        this.#state = "awaiting_ack";
        this.#armWait(input.at);
        return;
      case "close_ack":
        this.#ackExpectedRecv = undefined;
        if (this.#state === "close_received") {
          // §10.2 step 2: the sequential responder waits for the final confirmation.
          this.#branch = "sequential_responder";
          this.#state = "awaiting_confirmation";
          this.#armWait(input.at);
          return;
        }
        // Simultaneous (§10.2): four records total, no final-confirmation step.
        this.#branch = "simultaneous";
        this.#lastRecordSender = true;
        this.#lingerDeadlineAt = input.at + T_CLOSE_LINGER_MAX;
        if (this.#peerAckValidated) {
          this.#complete();
          return;
        }
        this.#state = "awaiting_simultaneous_ack";
        this.#armWait(input.at);
        return;
      case "final_confirmation":
        // §10.2 step 3: the initiator's exchange is complete on sending it, and
        // the record is itself unacknowledged by construction (§10.4).
        this.#branch = "sequential_initiator";
        this.#lastRecordSender = true;
        this.#lingerDeadlineAt = input.at + T_CLOSE_LINGER_MAX;
        this.#complete();
        return;
    }
  }

  /**
   * §10.2's carve-out, from the sending side: the single terminal `E2EEError`.
   * Nothing may be protected after it.
   */
  noteTerminalErrorTransmitted(): void {
    if (!this.mayProtectTerminalError) {
      throw new TypeError("Relay E2EE close machine permits exactly one terminal E2EEError.");
    }
    this.#terminalErrorSent = true;
    this.#pending = undefined;
    this.#recordVerdict("failed");
    this.#end();
  }

  /**
   * Process one AUTHENTICATED inner record (§4.3 step 3) against the close
   * machine. The caller has already applied §9.1 and §9.2; what is decided here
   * is whether the machine expects this record at all, and — for a close-machine
   * record — the whole of §10.1.
   */
  receive(input: E2eeCloseReceiveInput): E2eeCloseReceiveResult {
    // The precondition checks are all here, ahead of every state transition:
    // the record is already authenticated when this method is called, so from
    // the first mutation a throw would escape after a commitment (§9.2's
    // receiver advance has already happened) and leave the machine re-enterable
    // on a record it has half-processed.
    if (!isE2eeInnerRecordType(input.innerType)) {
      throw new TypeError("Relay E2EE inner record type must be a registered type.");
    }
    requirePosition(input.envelope);
    requirePosition(input.currentNextSend);
    requireTimestamp(input.at);

    if (input.innerType === E2EE_INNER_TYPE_ERROR) {
      // §11.3 fixes the body of this record and its bounded code registry, so
      // the carve-out applies to a CONFORMING `E2EEError` and not to every
      // authenticated `0x03` envelope. A body that is oversized, non-canonical,
      // or structurally invalid is Q11 — a fatal condition of its own, which
      // takes §11.3's ordinary procedure — and not a terminal record the
      // receiver must answer with silence.
      const decoded = decodeE2eeErrorRecordBody(input.body);
      if (decoded.kind === "error") {
        return this.#fatal("malformed_error_body", "Q11", decoded.reason);
      }
      // §10.2, §11.3: the peer's terminal record. NOT a Q7 envelope beyond the
      // machine's expectation — it is answered with nothing at all, because a
      // reply would be a second error record that §11.3 forbids and §9.6 does not
      // reserve, and two endpoints answering each other's terminal errors is the
      // reading this rule exists to remove. A RESERVED code is still such a
      // record: §11.3 says the channel closes and the code is not separately
      // actionable, which is a disposition and not a rejection.
      this.#peerTerminalError = true;
      this.#pending = undefined;
      this.#recordVerdict("failed");
      this.#end();
      return { kind: "terminal_error", value: decoded.value };
    }
    if (this.#state === "ended") return this.#fatal("record_beyond_machine");

    if (input.innerType === E2EE_INNER_TYPE_RPC) {
      // §10.2: inbound records are still authenticated in order and authentic RPC
      // records MAY still be delivered — but only while the peer has not itself
      // protected a close-machine record. From the peer's own first such record
      // it is under the same prohibition this endpoint is, so every later record
      // in that direction is beyond what the machine expects. Either of the
      // peer's two close-machine record types proves it started: an ack reaches
      // this endpoint without a preceding close in the sequential-initiator role.
      if (this.#peerCloseValidated || this.#peerAckValidated || this.#state === "complete") {
        return this.#fatal("record_beyond_machine");
      }
      return { kind: "application" };
    }

    if (input.innerType === E2EE_INNER_TYPE_CLOSE) return this.#receiveClose(input);
    return this.#receiveCloseAck(input);
  }

  #receiveClose(input: E2eeCloseReceiveInput): E2eeCloseReceiveResult {
    if (this.#state !== "open" && this.#state !== "awaiting_ack") {
      // A second `E2EEClose`, or one after this endpoint's exchange advanced past
      // the point where the peer could still be opening the machine.
      return this.#fatal("record_beyond_machine");
    }
    // PASSED-THROUGH RULE: against the receiver's CURRENT next-send (§10.1).
    const validated = validateE2eeCloseRecord({
      innerType: E2EE_INNER_TYPE_CLOSE,
      body: input.body,
      envelope: input.envelope,
      sessionBindingHash: this.#sessionBindingHash,
      senderDirection: this.#receiveDirection,
      currentNextSend: input.currentNextSend,
    });
    if (validated.kind === "invalid") return this.#fatal(validated.reason);

    this.#peerCloseValidated = true;
    // §10.2, §10.1.1: the ack this endpoint now owes declares its expected-next
    // AS OF THIS RECORD — the §9.2/§9.4 advance of the position that carried the
    // peer's close, which is precisely the peer's close anchor. Resolved here,
    // by the one function §10.1.1 names, and NOT recomputed later: the record is
    // already authenticated, so the non-throwing form is the only admissible
    // one (§9.6).
    const ackExpectedRecv = nextE2eeSequencePosition(
      { epoch: input.envelope.epoch, counter: input.envelope.counter },
      input.epochCompleted === true,
    );
    if (ackExpectedRecv === undefined) {
      // §9.6's degenerate state at the receive boundary: the peer spent the last
      // position of its direction on this close, so no expected-next exists for
      // an ack to declare, nothing further can ever authenticate in that
      // direction, and the outcome is **Unclean — abrupt** with no wire record.
      this.#ackExpectedRecvUnavailable = true;
      this.#recordVerdict("unclean_abrupt");
    } else {
      this.#ackExpectedRecv = ackExpectedRecv;
    }
    if (this.#state === "open") {
      this.#branch = "sequential_responder";
      this.#state = "close_received";
      // §10.2 step 2 gives the responder exactly one `T_CLOSE`-bounded wait, and
      // it is armed at its ack. In the degenerate state that ack never exists,
      // so the same single wait is armed here instead — nothing is restarted or
      // extended, and §10.3's lower bound is then satisfied by expiry rather
      // than by a peer proof that can no longer arrive (§9.6).
      if (this.#ackExpectedRecvUnavailable) this.#armWait(input.at);
      return { kind: "close", branch: "sequential", value: validated.value };
    }
    // §10.2: an endpoint that receives `E2EEClose` after having sent its own
    // treats the exchange as simultaneous. The first wait's obligation is NOT
    // ended here — it stands until the second wait replaces it — and nothing
    // restarts or extends it, which is also why the degenerate state arms
    // nothing on this path: the wait that expires is the one this endpoint's own
    // `E2EEClose` opened.
    this.#branch = "simultaneous";
    this.#state = "simultaneous_pending";
    return { kind: "close", branch: "simultaneous", value: validated.value };
  }

  #receiveCloseAck(input: E2eeCloseReceiveInput): E2eeCloseReceiveResult {
    const anchor = this.#anchor;
    const expectsAck =
      anchor !== undefined &&
      !this.#peerAckValidated &&
      (this.#state === "awaiting_ack" ||
        this.#state === "awaiting_confirmation" ||
        this.#state === "simultaneous_pending" ||
        this.#state === "awaiting_simultaneous_ack");
    if (!expectsAck) return this.#fatal("record_beyond_machine");

    // STRICT RULE: against the receiver's CLOSE ANCHOR (§10.1.1), never its
    // current next-send. `currentNextSend` is carried for the passed-through rule
    // and is deliberately not consulted on this path.
    const validated = validateE2eeCloseRecord({
      innerType: E2EE_INNER_TYPE_CLOSE_ACK,
      body: input.body,
      envelope: input.envelope,
      sessionBindingHash: this.#sessionBindingHash,
      senderDirection: this.#receiveDirection,
      currentNextSend: input.currentNextSend,
      closeAnchor: anchor,
    });
    if (validated.kind === "invalid") return this.#fatal(validated.reason);

    this.#peerAckValidated = true;
    if (this.#state === "awaiting_ack") {
      // §10.2 step 3: the sequential initiator still owes the final confirmation;
      // its exchange completes when that record is transmitted.
      this.#branch = "sequential_initiator";
      this.#state = "confirmation_due";
      return { kind: "close_ack", exchangeComplete: false, value: validated.value };
    }
    if (this.#state === "simultaneous_pending") {
      // The batched read (§10.1.1): the peer's close and ack arrived before this
      // endpoint sent its own ack. The anchor makes the outcome independent of
      // that ordering; the ack is still owed, and completion waits for it.
      return { kind: "close_ack", exchangeComplete: false, value: validated.value };
    }
    // §10.2 step 4 (sequential responder) and the simultaneous branch: this
    // endpoint's exchange is complete.
    this.#complete();
    return { kind: "close_ack", exchangeComplete: true, value: validated.value };
  }

  /** §10.2, §10.3: has the current `T_CLOSE`-bounded wait expired? */
  waitExpired(now: number): boolean {
    return this.#waitDeadlineAt !== undefined && now > this.#waitDeadlineAt;
  }

  /**
   * §10.2, §10.4: the wait expired. The exchange ends with **Unclean — abrupt**,
   * which is unattributed — it may be ordinary network failure, denial of
   * service, or the peer's own local send failure — and the endpoint emits NO
   * wire record for it.
   */
  noteWaitExpired(now: number): E2eeCloseVerdict {
    if (!this.waitExpired(now)) {
      throw new TypeError("Relay E2EE close machine has no expired T_CLOSE wait.");
    }
    this.#pending = undefined;
    this.#recordVerdict("unclean_abrupt");
    this.#end();
    return this.#verdict!;
  }

  /**
   * §10.4: the channel, connection, or socket ended — including an outer
   * `channel.close` arriving. Records **Unclean — truncation** when the relay
   * chunk assembler still holds an incomplete reassembled message (which is
   * truncation regardless of any other state, and therefore supersedes a
   * **Clean** recorded at completion), and **Unclean — abrupt** when no exchange
   * had completed. A completed exchange with no partial reassembly keeps its
   * **Clean** verdict: §10.3 makes the linger a courtesy, and losing the socket
   * during it changes the peer's verdict, never this endpoint's.
   */
  noteChannelEnded(input: {
    readonly at: number;
    readonly incompleteReassembly?: boolean | undefined;
  }): E2eeCloseVerdict {
    if (input.incompleteReassembly === true) {
      this.#recordVerdict("unclean_truncation");
    } else if (!this.exchangeComplete) {
      this.#recordVerdict("unclean_abrupt");
    }
    this.#pending = undefined;
    this.#end();
    return this.#verdict ?? "unclean_abrupt";
  }

  /**
   * A fatal condition detected outside the close machine — a §4.4 row, a §9
   * sequence or authentication failure, or the §11.3 Q6 rows the close phase
   * grants no exemption from. Verdict **Failed** (§10.4).
   */
  noteFatal(): E2eeCloseVerdict {
    this.#pending = undefined;
    this.#recordVerdict("failed");
    // The channel is over, but §11.3 still obliges one terminal `E2EEError` while
    // the send path is usable, so the carve-out state is left untouched here.
    this.#end();
    return this.#verdict!;
  }

  /**
   * §10.3 lower bound (MUST): an endpoint MUST NOT emit the outer
   * `channel.close` — nor otherwise tear down the channel or connection — until
   * it has received the encrypted peer proof its role requires, or `T_CLOSE`
   * expires. Enqueueing one's own final records is never sufficient: the relay
   * may discard queued channel data at close, so only the encrypted peer proof
   * demonstrates delivery.
   *
   * Outside a close phase this is not a §10.3 question and the answer is `true`;
   * such a teardown is an abrupt close and §10.4 records it as one.
   */
  outerCloseAllowed(now: number): boolean {
    if (!this.closePhaseActive) return true;
    if (this.#state === "ended" || this.#state === "complete") return true;
    return this.waitExpired(now);
  }

  /**
   * §10.3 last-record linger (SHOULD): after transmitting the last close-machine
   * record of the exchange, delay the outer `channel.close` until the earliest of
   * the peer's `channel.close`, the transport ending, or this bound. It is a
   * courtesy to the peer's verdict and never a wait for anything owed — this
   * endpoint's own verdict is already determined (§10.4) and MUST NOT depend on
   * which of the three ends the linger.
   */
  shouldLinger(now: number): boolean {
    if (!this.#lastRecordSender) return false;
    return this.#lingerDeadlineAt !== undefined && now < this.#lingerDeadlineAt;
  }

  #armWait(at: number): void {
    if (this.#waitsArmed >= MAX_CLOSE_WAITS) {
      throw new TypeError("Relay E2EE close phase admits at most two T_CLOSE-bounded waits.");
    }
    // Kept as a guard on the one writer of the deadline, even though every
    // caller validates the timestamp before it mutates anything.
    requireTimestamp(at);
    this.#waitsArmed += 1;
    this.#waitDeadlineAt = at + T_CLOSE;
  }

  #complete(): void {
    this.#state = "complete";
    this.#completed = true;
    // §10.4: the verdict is determined and recorded at the instant the exchange
    // completes, before and independently of the outer `channel.close`.
    this.#waitDeadlineAt = undefined;
    this.#recordVerdict("clean");
  }

  #end(): void {
    this.#state = "ended";
    this.#waitDeadlineAt = undefined;
  }

  #fatal(
    reason: E2eeCloseFatalReason,
    row: "Q7" | "Q11" = "Q7",
    decodeError?: E2eeErrorBodyDecodeError,
  ): E2eeCloseReceiveResult {
    this.#pending = undefined;
    this.#recordVerdict("failed");
    this.#end();
    return decodeError === undefined
      ? { kind: "fatal", row, reason }
      : { kind: "fatal", row, reason, decodeError };
  }

  #recordVerdict(candidate: E2eeCloseVerdict): void {
    this.#verdict =
      this.#verdict === undefined ? candidate : resolveE2eeCloseVerdict(this.#verdict, candidate);
  }
}

// ─── shared input validation ─────────────────────────────────────────────────

function requireCloseRecordType(innerType: number): E2eeCloseRecordType {
  if (!isE2eeCloseRecordType(innerType)) {
    throw new TypeError("Relay E2EE close records are inner type 0x02 or 0x04 only.");
  }
  return innerType;
}

function requireDirection(direction: E2eeDirection): E2eeDirection {
  if (!isE2eeDirection(direction)) {
    throw new TypeError("Relay E2EE direction must be a registered direction label.");
  }
  return direction;
}

function requireTimestamp(at: number): number {
  if (typeof at !== "number" || !Number.isFinite(at)) {
    throw new TypeError("Relay E2EE close machine requires a finite timestamp.");
  }
  return at;
}

function requireSessionBindingHash(hash: Uint8Array): Uint8Array {
  if (!(hash instanceof Uint8Array) || hash.byteLength !== E2EE_SESSION_BINDING_HASH_BYTES) {
    throw new TypeError("Relay E2EE close records require a full-length session binding hash.");
  }
  return hash;
}
