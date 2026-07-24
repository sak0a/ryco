import { encodeBase64Url, type DpopPublicJwk } from "@ryco/client-runtime/relay";

/**
 * Pure P-256 encoding conversions between what the platform keystores emit and
 * what JWS/JWK require. Both conversions are easy to get subtly wrong in ways
 * that typecheck and unit-test green but fail only against a real server, so
 * each is exhaustively tested here.
 *
 * Neither platform emits what JWS wants directly:
 *  - Both `SecKeyCreateSignature` and `Signature("SHA256withECDSA")` return an
 *    ASN.1 DER `SEQUENCE { INTEGER r, INTEGER s }`. JWS ES256 requires the raw
 *    64-byte `r ‖ s`. `createDpopProofSigner` base64url-encodes exactly the
 *    bytes returned by the signing key, so returning DER produces a proof the
 *    Hub rejects as a signature failure.
 *  - Coordinates must be left-padded to exactly 32 bytes. Trimming a leading
 *    zero byte changes the JWK thumbprint, which breaks the session binding on
 *    every request after login.
 */

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

/**
 * Left-pad a big-endian integer to exactly 32 bytes.
 *
 * DER strips leading zero bytes and adds one back only to keep an integer
 * positive, so `r`/`s` and the affine coordinates arrive at any length from 1
 * to 33 bytes. Both directions must be normalized.
 */
function leftPadCoordinate(bytes: Uint8Array, onInvalid: () => never): Uint8Array {
  let start = 0;
  while (start < bytes.length && bytes[start] === 0) start += 1;
  const significant = bytes.subarray(start);
  if (significant.length > P256_COORDINATE_BYTES) onInvalid();
  const padded = new Uint8Array(P256_COORDINATE_BYTES);
  padded.set(significant, P256_COORDINATE_BYTES - significant.length);
  return padded;
}

/** Read a DER length at `offset`, returning the length and the next offset. */
function readDerLength(der: Uint8Array, offset: number): { length: number; next: number } {
  if (offset >= der.length) invalidSignature();
  const first = der[offset]!;
  if (first < 0x80) return { length: first, next: offset + 1 };
  const byteCount = first & 0x7f;
  // A P-256 signature is ~70 bytes; anything needing more than two length bytes
  // is not one, and indefinite length (0x80) is not valid DER.
  if (byteCount === 0 || byteCount > 2) invalidSignature();
  if (offset + 1 + byteCount > der.length) invalidSignature();
  let length = 0;
  for (let index = 0; index < byteCount; index += 1) {
    length = (length << 8) | der[offset + 1 + index]!;
  }
  return { length, next: offset + 1 + byteCount };
}

/** Read a DER INTEGER at `offset`, returning its bytes and the next offset. */
function readDerInteger(der: Uint8Array, offset: number): { value: Uint8Array; next: number } {
  if (der[offset] !== DER_INTEGER_TAG) invalidSignature();
  const { length, next } = readDerLength(der, offset + 1);
  if (length === 0 || next + length > der.length) invalidSignature();
  return { value: der.subarray(next, next + length), next: next + length };
}

/**
 * Convert an ASN.1 DER ECDSA signature into the raw `r ‖ s` form JWS ES256
 * requires. Always returns exactly 64 bytes.
 */
export function derSignatureToRaw(der: Uint8Array): Uint8Array {
  if (der.length < 8) invalidSignature();
  if (der[0] !== DER_SEQUENCE_TAG) invalidSignature();
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

/**
 * Build the public JWK from affine coordinates, left-padding each to 32 bytes.
 * Carries no private members, so `createDpopProofSigner`'s private-JWK
 * rejection can never trip on a key built here.
 */
export function ecPublicKeyJwk(x: Uint8Array, y: Uint8Array): DpopPublicJwk {
  return {
    kty: "EC",
    crv: "P-256",
    x: encodeBase64Url(leftPadCoordinate(x, invalidPublicKey)),
    y: encodeBase64Url(leftPadCoordinate(y, invalidPublicKey)),
  };
}

/**
 * Convert an X9.63 uncompressed point (`0x04 ‖ X(32) ‖ Y(32)`) into a public
 * JWK. This is what `SecKeyCopyExternalRepresentation` returns on iOS and what
 * the Android module reassembles from the keystore's affine coordinates.
 */
export function uncompressedPointToJwk(point: Uint8Array): DpopPublicJwk {
  if (point.length !== UNCOMPRESSED_POINT_BYTES) invalidPublicKey();
  if (point[0] !== UNCOMPRESSED_POINT_PREFIX) invalidPublicKey();
  return ecPublicKeyJwk(
    point.subarray(1, 1 + P256_COORDINATE_BYTES),
    point.subarray(1 + P256_COORDINATE_BYTES),
  );
}
