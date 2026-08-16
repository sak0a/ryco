import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { p256 } from "@noble/curves/nist.js";
import { expand, extract } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { concatBytes } from "@noble/hashes/utils.js";
import { Tokenizer, Type, decode, encode, rfc8949EncodeOptions } from "cborg";

const EMPTY = new Uint8Array(0);
const utf8 = new TextEncoder();

export interface IndependentNoiseInput {
  readonly pattern: "IK" | "NX";
  readonly prologue: Uint8Array;
  readonly initiatorStaticSecret?: Uint8Array;
  readonly initiatorEphemeralSecret: Uint8Array;
  readonly responderStaticSecret: Uint8Array;
  readonly responderEphemeralSecret: Uint8Array;
  readonly message1Payload: Uint8Array;
  readonly message2Payload: Uint8Array;
}

export interface IndependentNoiseResult {
  readonly message1: Uint8Array;
  readonly message2: Uint8Array;
  readonly handshakeHash: Uint8Array;
  readonly chainingKeyFinal: Uint8Array;
  readonly splitFirst: Uint8Array;
  readonly splitSecond: Uint8Array;
  readonly exporterSecret: Uint8Array;
}

export type IndependentCanonicalDecode =
  | { readonly kind: "ok"; readonly value: unknown }
  | { readonly kind: "error"; readonly reason: "malformed" | "non_canonical" | "float_forbidden" };

const STRICT_CBOR_OPTIONS = {
  allowIndefinite: false,
  allowUndefined: false,
  allowInfinity: false,
  allowNaN: false,
  allowBigInt: false,
  strict: true,
  useMaps: true,
  rejectDuplicateMapKeys: true,
  tags: {},
} as const;

function equal(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}

export function decodeIndependentCanonicalCbor(bytes: Uint8Array): IndependentCanonicalDecode {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
    return { kind: "error", reason: "malformed" };
  }
  let value: unknown;
  try {
    value = decode(bytes, STRICT_CBOR_OPTIONS);
    const tokenizer = new Tokenizer(bytes, STRICT_CBOR_OPTIONS);
    while (!tokenizer.done()) {
      if (Type.equals(tokenizer.next().type, Type.float)) {
        return { kind: "error", reason: "float_forbidden" };
      }
    }
  } catch {
    return { kind: "error", reason: "malformed" };
  }
  try {
    if (!equal(encode(value, rfc8949EncodeOptions), bytes)) {
      return { kind: "error", reason: "non_canonical" };
    }
  } catch {
    return { kind: "error", reason: "non_canonical" };
  }
  return { kind: "ok", value };
}

export function validateIndependentP256PublicKey(publicKey: Uint8Array): boolean {
  if (publicKey.byteLength !== 65 || publicKey[0] !== 0x04) return false;
  const fieldPrime = p256.Point.Fp.ORDER;
  const integer = (bytes: Uint8Array): bigint =>
    bytes.reduce((value, byte) => (value << 8n) | BigInt(byte), 0n);
  const x = integer(publicKey.subarray(1, 33));
  const y = integer(publicKey.subarray(33, 65));
  if (x >= fieldPrime || y >= fieldPrime) return false;
  try {
    return !p256.Point.fromBytes(publicKey).is0();
  } catch {
    return false;
  }
}

export function validateIndependentP256Signature(signature: Uint8Array): boolean {
  if (signature.byteLength !== 64) return false;
  const integer = (bytes: Uint8Array): bigint =>
    bytes.reduce((value, byte) => (value << 8n) | BigInt(byte), 0n);
  const r = integer(signature.subarray(0, 32));
  const s = integer(signature.subarray(32));
  const groupOrder = p256.Point.Fn.ORDER;
  return r > 0n && r < groupOrder && s > 0n && s < groupOrder;
}

function noiseNonce(value: bigint): Uint8Array {
  const nonce = new Uint8Array(12);
  let remaining = value;
  for (let index = 4; index < nonce.byteLength; index += 1) {
    nonce[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return nonce;
}

function writeBigEndian(target: Uint8Array, offset: number, bytes: number, value: bigint): void {
  let remaining = value;
  for (let index = offset + bytes - 1; index >= offset; index -= 1) {
    target[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  if (remaining !== 0n) throw new Error("independent integer exceeds field");
}

function readBigEndian(source: Uint8Array, offset: number, bytes: number): bigint {
  let value = 0n;
  for (let index = offset; index < offset + bytes; index += 1) {
    value = (value << 8n) | BigInt(source[index]!);
  }
  return value;
}

function hkdf2(chainingKey: Uint8Array, input: Uint8Array): readonly [Uint8Array, Uint8Array] {
  const temporary = extract(sha256, input, chainingKey);
  const outputs = expand(sha256, temporary, EMPTY, 64);
  return [outputs.slice(0, 32), outputs.slice(32, 64)];
}

class SymmetricState {
  readonly #protocolName: string;
  #chainingKey: Uint8Array;
  #hash: Uint8Array;
  #key: Uint8Array | undefined;
  #nonce = 0n;

  constructor(protocolName: string) {
    this.#protocolName = protocolName;
    const name = utf8.encode(protocolName);
    this.#hash =
      name.byteLength <= 32
        ? Uint8Array.from({ length: 32 }, (_value, index) => name[index] ?? 0)
        : sha256(name);
    this.#chainingKey = Uint8Array.from(this.#hash);
  }

  mixHash(data: Uint8Array): void {
    this.#hash = sha256(concatBytes(this.#hash, data));
  }

  mixKey(input: Uint8Array): void {
    const [chainingKey, key] = hkdf2(this.#chainingKey, input);
    this.#chainingKey = chainingKey;
    this.#key = key;
    this.#nonce = 0n;
  }

  encryptAndHash(plaintext: Uint8Array): Uint8Array {
    const ciphertext =
      this.#key === undefined
        ? Uint8Array.from(plaintext)
        : chacha20poly1305(this.#key, noiseNonce(this.#nonce), this.#hash).encrypt(plaintext);
    if (this.#key !== undefined) this.#nonce += 1n;
    this.mixHash(ciphertext);
    return ciphertext;
  }

  finish(): Omit<IndependentNoiseResult, "message1" | "message2"> {
    const [splitFirst, splitSecond] = hkdf2(this.#chainingKey, EMPTY);
    return {
      handshakeHash: Uint8Array.from(this.#hash),
      chainingKeyFinal: Uint8Array.from(this.#chainingKey),
      splitFirst,
      splitSecond,
      exporterSecret: expand(
        sha256,
        this.#chainingKey,
        utf8.encode("ryco.relay-e2ee.exporter.v1"),
        32,
      ),
    };
  }

  get protocolName(): string {
    return this.#protocolName;
  }
}

function dh(secret: Uint8Array, publicKey: Uint8Array): Uint8Array {
  const shared = x25519.getSharedSecret(secret, publicKey);
  if (shared.every((byte) => byte === 0)) throw new Error("independent Noise DH was all zero");
  return shared;
}

export function composeIndependentNoise(input: IndependentNoiseInput): IndependentNoiseResult {
  const protocolName = `Noise_${input.pattern}_25519_ChaChaPoly_SHA256`;
  const state = new SymmetricState(protocolName);
  state.mixHash(input.prologue);
  const initiatorEphemeralPublic = x25519.getPublicKey(input.initiatorEphemeralSecret);
  const responderEphemeralPublic = x25519.getPublicKey(input.responderEphemeralSecret);
  const responderStaticPublic = x25519.getPublicKey(input.responderStaticSecret);
  const initiatorStaticPublic =
    input.initiatorStaticSecret === undefined
      ? undefined
      : x25519.getPublicKey(input.initiatorStaticSecret);

  if (input.pattern === "IK") state.mixHash(responderStaticPublic);

  const message1Parts: Uint8Array[] = [initiatorEphemeralPublic];
  state.mixHash(initiatorEphemeralPublic);
  if (input.pattern === "IK") {
    if (input.initiatorStaticSecret === undefined || initiatorStaticPublic === undefined) {
      throw new Error("IK requires an initiator static key");
    }
    state.mixKey(dh(input.initiatorEphemeralSecret, responderStaticPublic));
    message1Parts.push(state.encryptAndHash(initiatorStaticPublic));
    state.mixKey(dh(input.initiatorStaticSecret, responderStaticPublic));
  }
  message1Parts.push(state.encryptAndHash(input.message1Payload));
  const message1 = concatBytes(...message1Parts);

  const message2Parts: Uint8Array[] = [responderEphemeralPublic];
  state.mixHash(responderEphemeralPublic);
  state.mixKey(dh(input.responderEphemeralSecret, initiatorEphemeralPublic));
  if (input.pattern === "IK") {
    if (initiatorStaticPublic === undefined) throw new Error("IK requires an initiator static key");
    state.mixKey(dh(input.responderEphemeralSecret, initiatorStaticPublic));
  } else {
    message2Parts.push(state.encryptAndHash(responderStaticPublic));
    state.mixKey(dh(input.responderStaticSecret, initiatorEphemeralPublic));
  }
  message2Parts.push(state.encryptAndHash(input.message2Payload));
  const message2 = concatBytes(...message2Parts);
  const result = state.finish();
  if (state.protocolName !== protocolName || equal(message1, EMPTY) || equal(message2, EMPTY)) {
    throw new Error("independent Noise composition failed");
  }
  return { message1, message2, ...result };
}

export function expandIndependentEpoch(
  epochSecret: Uint8Array,
  directionLabel: Uint8Array,
): { readonly aeadKey: Uint8Array; readonly nextEpochSecret: Uint8Array } {
  return {
    aeadKey: expand(
      sha256,
      epochSecret,
      concatBytes(utf8.encode("ryco.relay-e2ee.aead-key.v1"), directionLabel),
      32,
    ),
    nextEpochSecret: expand(
      sha256,
      epochSecret,
      concatBytes(utf8.encode("ryco.relay-e2ee.ratchet.v1"), directionLabel),
      32,
    ),
  };
}

export function ratchetIndependentEpoch(
  ownedEpochSecret: Uint8Array,
  directionLabel: Uint8Array,
): { readonly aeadKey: Uint8Array; readonly nextEpochSecret: Uint8Array } {
  const result = expandIndependentEpoch(ownedEpochSecret, directionLabel);
  ownedEpochSecret.fill(0);
  return result;
}

export function protectIndependentRecord(input: {
  readonly aeadKey: Uint8Array;
  readonly sessionBindingHash: Uint8Array;
  readonly directionLabel: Uint8Array;
  readonly suite: number;
  readonly epoch: bigint;
  readonly counter: bigint;
  readonly innerType: number;
  readonly body: Uint8Array;
}): Uint8Array {
  if (
    input.aeadKey.byteLength !== 32 ||
    input.sessionBindingHash.byteLength !== 32 ||
    input.directionLabel.byteLength !== 3 ||
    input.suite !== 1 ||
    input.innerType < 1 ||
    input.innerType > 255
  ) {
    throw new Error("invalid independent record input");
  }
  const header = new Uint8Array(15);
  header.set([1, 1, input.suite]);
  writeBigEndian(header, 3, 4, input.epoch);
  writeBigEndian(header, 7, 8, input.counter);
  const aad = concatBytes(header, input.sessionBindingHash, input.directionLabel);
  const plaintext = new Uint8Array(1 + input.body.byteLength);
  plaintext[0] = input.innerType;
  plaintext.set(input.body, 1);
  const ciphertext = chacha20poly1305(input.aeadKey, header.subarray(3), aad).encrypt(plaintext);
  plaintext.fill(0);
  return concatBytes(header, ciphertext);
}

export function unprotectIndependentRecord(input: {
  readonly aeadKey: Uint8Array;
  readonly sessionBindingHash: Uint8Array;
  readonly directionLabel: Uint8Array;
  readonly envelope: Uint8Array;
  readonly expectedEpoch: bigint;
  readonly expectedCounter: bigint;
}): Uint8Array {
  if (
    input.aeadKey.byteLength !== 32 ||
    input.sessionBindingHash.byteLength !== 32 ||
    input.directionLabel.byteLength !== 3 ||
    input.envelope.byteLength < 32
  ) {
    throw new Error("invalid independent record input");
  }
  const header = input.envelope.subarray(0, 15);
  if (header[1] !== 1) throw new IndependentRecordRejection("version_mismatch");
  if (header[2] !== 1) throw new IndependentRecordRejection("suite_mismatch");
  if (
    readBigEndian(header, 3, 4) !== input.expectedEpoch ||
    readBigEndian(header, 7, 8) !== input.expectedCounter
  ) {
    throw new IndependentRecordRejection("sequence_mismatch");
  }
  const aad = concatBytes(header, input.sessionBindingHash, input.directionLabel);
  try {
    return chacha20poly1305(input.aeadKey, header.subarray(3), aad).decrypt(
      input.envelope.subarray(15),
    );
  } catch {
    throw new IndependentRecordRejection("authentication_failed");
  }
}

export type IndependentRecordRejectionReason =
  | "version_mismatch"
  | "suite_mismatch"
  | "sequence_mismatch"
  | "authentication_failed";

export class IndependentRecordRejection extends Error {
  constructor(readonly reason: IndependentRecordRejectionReason) {
    super("Independent record rejected.");
    this.name = "IndependentRecordRejection";
  }
}

export function independentRecordAad(input: {
  readonly suite: number;
  readonly epoch: bigint;
  readonly counter: bigint;
  readonly sessionBindingHash: Uint8Array;
  readonly directionLabel: Uint8Array;
}): { readonly header: Uint8Array; readonly nonce: Uint8Array; readonly aad: Uint8Array } {
  const header = new Uint8Array(15);
  header.set([1, 1, input.suite]);
  writeBigEndian(header, 3, 4, input.epoch);
  writeBigEndian(header, 7, 8, input.counter);
  return {
    header,
    nonce: Uint8Array.from(header.subarray(3)),
    aad: concatBytes(header, input.sessionBindingHash, input.directionLabel),
  };
}
