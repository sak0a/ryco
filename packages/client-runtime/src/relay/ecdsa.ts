import type { DpopPublicJwk } from "./dpop.ts";
import { encodeBase64Url } from "./base64url.ts";

/** Pure strict P-256 encodings shared by native keystore adapters. */
const P256_COORDINATE_BYTES = 32;
const UNCOMPRESSED_POINT_PREFIX = 0x04;
const UNCOMPRESSED_POINT_BYTES = 1 + P256_COORDINATE_BYTES * 2;
const DER_SEQUENCE_TAG = 0x30;
const DER_INTEGER_TAG = 0x02;

function invalidSignature(): never {
  throw new Error("Invalid ECDSA signature encoding.");
}

function invalidPublicKey(): never {
  throw new Error("Invalid P-256 public key encoding.");
}

function leftPadCoordinate(bytes: Uint8Array, onInvalid: () => never): Uint8Array {
  let start = 0;
  while (start < bytes.length && bytes[start] === 0) start += 1;
  const significant = bytes.subarray(start);
  if (significant.length > P256_COORDINATE_BYTES) onInvalid();
  const padded = new Uint8Array(P256_COORDINATE_BYTES);
  padded.set(significant, P256_COORDINATE_BYTES - significant.length);
  return padded;
}

function readDerLength(der: Uint8Array, offset: number): { length: number; next: number } {
  if (offset >= der.length) invalidSignature();
  const first = der[offset]!;
  if (first < 0x80) return { length: first, next: offset + 1 };
  const byteCount = first & 0x7f;
  if (byteCount === 0 || byteCount > 2) invalidSignature();
  if (offset + 1 + byteCount > der.length) invalidSignature();
  let length = 0;
  for (let index = 0; index < byteCount; index += 1) {
    length = (length << 8) | der[offset + 1 + index]!;
  }
  if (der[offset + 1] === 0 || length < 0x80) invalidSignature();
  return { length, next: offset + 1 + byteCount };
}

function readDerInteger(der: Uint8Array, offset: number): { value: Uint8Array; next: number } {
  if (der[offset] !== DER_INTEGER_TAG) invalidSignature();
  const { length, next } = readDerLength(der, offset + 1);
  if (length === 0 || next + length > der.length) invalidSignature();
  const value = der.subarray(next, next + length);
  if ((value[0]! & 0x80) !== 0) invalidSignature();
  if (value.length > 1 && value[0] === 0 && (value[1]! & 0x80) === 0) invalidSignature();
  if (value.every((byte) => byte === 0)) invalidSignature();
  return { value, next: next + length };
}

/** Convert strict ASN.1 DER ECDSA into fixed-width JWS `r ‖ s`. */
export function derSignatureToRaw(der: Uint8Array): Uint8Array {
  if (der.length < 8 || der[0] !== DER_SEQUENCE_TAG) invalidSignature();
  const sequence = readDerLength(der, 1);
  if (sequence.next + sequence.length !== der.length) invalidSignature();
  const r = readDerInteger(der, sequence.next);
  const s = readDerInteger(der, r.next);
  if (s.next !== der.length) invalidSignature();
  const raw = new Uint8Array(P256_COORDINATE_BYTES * 2);
  raw.set(leftPadCoordinate(r.value, invalidSignature), 0);
  raw.set(leftPadCoordinate(s.value, invalidSignature), P256_COORDINATE_BYTES);
  return raw;
}

/** Build a public P-256 JWK from big-endian affine coordinates. */
export function ecPublicKeyJwk(x: Uint8Array, y: Uint8Array): DpopPublicJwk {
  return {
    kty: "EC",
    crv: "P-256",
    x: encodeBase64Url(leftPadCoordinate(x, invalidPublicKey)),
    y: encodeBase64Url(leftPadCoordinate(y, invalidPublicKey)),
  };
}

/** Convert the X9.63 `0x04 ‖ X ‖ Y` public point emitted by native keystores. */
export function uncompressedPointToJwk(point: Uint8Array): DpopPublicJwk {
  if (point.length !== UNCOMPRESSED_POINT_BYTES || point[0] !== UNCOMPRESSED_POINT_PREFIX) {
    invalidPublicKey();
  }
  return ecPublicKeyJwk(
    point.subarray(1, 1 + P256_COORDINATE_BYTES),
    point.subarray(1 + P256_COORDINATE_BYTES),
  );
}
