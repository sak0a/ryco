import {
  E2EE_NODE_IDENTITY_ALGORITHM,
  e2eeBytesEqual,
  e2eeKeyFingerprint,
  invalidRelayE2eeInput,
  validateE2eeClientIdentityPublicKey,
  validateE2eeNodeIdentityPublicKey,
  verifyE2eeSignature,
} from "./relayE2eeKeys.ts";
import {
  assertE2eeAccountId,
  assertRelayCapabilityLiteral,
  assertRelayEffectiveRoleLiteral,
  canonicalizeE2eeHubOrigin,
  decodeCanonicalE2eeCbor,
  encodeCanonicalE2eeCbor,
} from "./relayE2eeTranscripts.ts";

// Canonical cross-device approval transcripts for
// docs/relay-e2ee-cross-device-approval-protocol.md. This module has no Node,
// DOM, React, or React Native imports so the node and every native client share
// one byte-exact encoder and verifier.

export const CROSS_DEVICE_APPROVAL_PROTOCOL_VERSION = 1 as const;
export const CROSS_DEVICE_APPROVAL_DOMAIN = "ryco.e2ee.cross-device-approval.v1" as const;
export const CROSS_DEVICE_APPROVAL_ENVELOPE_DOMAIN =
  "ryco.e2ee.cross-device-approval-envelope.v1" as const;
export const CROSS_DEVICE_APPROVAL_QR_PREFIX = "ryco-e2ee-approval-v1:" as const;
export const CROSS_DEVICE_APPROVAL_ID_BYTES = 32;
export const CROSS_DEVICE_APPROVAL_FINGERPRINT_BYTES = 32;
export const CROSS_DEVICE_APPROVAL_SIGNATURE_BYTES = 64;
// These are QR-capacity bounds as well as parser bounds. A 1,200-byte envelope
// becomes at most 1,600 base64url characters; with the fixed prefix it still
// fits a version-40 QR at medium error correction, which both owner surfaces use.
export const CROSS_DEVICE_APPROVAL_MAX_TBS_BYTES = 1_024;
export const CROSS_DEVICE_APPROVAL_MAX_ENVELOPE_BYTES = 1_200;
export const CROSS_DEVICE_APPROVAL_MAX_LIFETIME_MS = 300_000;
export const CROSS_DEVICE_APPROVAL_CLOCK_SKEW_MS = 30_000;
export const CROSS_DEVICE_APPROVAL_MAX_CAPABILITIES = 32;

const NODE_ID = /^node_[A-Za-z0-9_-]{22,43}$/;
const CONTINUITY_ID = /^nct_[A-Za-z0-9_-]{22}$/;
const BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export interface CrossDeviceApprovalInput {
  readonly hubOrigin: string;
  readonly accountId: string;
  readonly nodeId: string;
  readonly nodeIdentityPublicKey: Uint8Array;
  readonly clientIdentityFingerprint: Uint8Array;
  readonly maxRole: string;
  readonly capabilitySet: readonly string[];
  readonly nodeContinuityId: string;
  readonly nodePolicyGeneration: number;
  readonly approvedAt: number;
  readonly approvalId: Uint8Array;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

export interface CrossDeviceApproval extends CrossDeviceApprovalInput {
  readonly hubOrigin: string;
  readonly nodeIdentityPublicKey: Uint8Array;
  readonly clientIdentityFingerprint: Uint8Array;
  readonly capabilitySet: readonly string[];
  readonly approvalId: Uint8Array;
}

export interface CrossDeviceApprovalEnvelope {
  readonly tbs: Uint8Array;
  readonly signature: Uint8Array;
}

export interface VerifyCrossDeviceApprovalQrInput {
  readonly payload: string;
  readonly hubOrigin: string;
  readonly accountId: string;
  readonly nodeId: string;
  readonly nodeIdentityPublicKey: Uint8Array;
  readonly clientIdentityPublicKey: Uint8Array;
  readonly nodeContinuityId: string;
  readonly nodePolicyGeneration: number;
  readonly now: number;
}

function requireBytes(value: Uint8Array, length: number): Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength !== length) {
    return invalidRelayE2eeInput();
  }
  return Uint8Array.from(value);
}

function requireBoundedBytes(value: Uint8Array, max: number): Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength === 0 || value.byteLength > max) {
    return invalidRelayE2eeInput();
  }
  return Uint8Array.from(value);
}

function requireIdentifier(value: string, pattern: RegExp): string {
  if (typeof value !== "string" || !pattern.test(value)) return invalidRelayE2eeInput();
  return value;
}

function requireUnsignedSafeInteger(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) return invalidRelayE2eeInput();
  return value;
}

function requireCapabilities(value: readonly string[]): readonly string[] {
  if (!Array.isArray(value) || value.length > CROSS_DEVICE_APPROVAL_MAX_CAPABILITIES) {
    return invalidRelayE2eeInput();
  }
  const validated = value.map((entry) => assertRelayCapabilityLiteral(entry));
  const canonical = [...new Set(validated)].toSorted();
  if (
    canonical.length !== value.length ||
    canonical.some((entry, index) => entry !== value[index])
  ) {
    return invalidRelayE2eeInput();
  }
  return canonical;
}

function validateApproval(input: CrossDeviceApprovalInput): CrossDeviceApproval {
  const approvedAt = requireUnsignedSafeInteger(input.approvedAt);
  const issuedAt = requireUnsignedSafeInteger(input.issuedAt);
  const expiresAt = requireUnsignedSafeInteger(input.expiresAt);
  if (
    approvedAt > issuedAt ||
    expiresAt <= issuedAt ||
    expiresAt - issuedAt > CROSS_DEVICE_APPROVAL_MAX_LIFETIME_MS
  ) {
    return invalidRelayE2eeInput();
  }
  return {
    hubOrigin: canonicalizeE2eeHubOrigin(input.hubOrigin),
    accountId: assertE2eeAccountId(input.accountId),
    nodeId: requireIdentifier(input.nodeId, NODE_ID),
    nodeIdentityPublicKey: validateE2eeNodeIdentityPublicKey(input.nodeIdentityPublicKey),
    clientIdentityFingerprint: requireBytes(
      input.clientIdentityFingerprint,
      CROSS_DEVICE_APPROVAL_FINGERPRINT_BYTES,
    ),
    maxRole: assertRelayEffectiveRoleLiteral(input.maxRole),
    capabilitySet: requireCapabilities(input.capabilitySet),
    nodeContinuityId: requireIdentifier(input.nodeContinuityId, CONTINUITY_ID),
    nodePolicyGeneration: requireUnsignedSafeInteger(input.nodePolicyGeneration),
    approvedAt,
    approvalId: requireBytes(input.approvalId, CROSS_DEVICE_APPROVAL_ID_BYTES),
    issuedAt,
    expiresAt,
  };
}

/** Encode the exact 16-member node-signed approval transcript. */
export function encodeCrossDeviceApprovalTbs(input: CrossDeviceApprovalInput): Uint8Array {
  const value = validateApproval(input);
  return requireBoundedBytes(
    encodeCanonicalE2eeCbor([
      CROSS_DEVICE_APPROVAL_DOMAIN,
      CROSS_DEVICE_APPROVAL_PROTOCOL_VERSION,
      value.hubOrigin,
      value.accountId,
      value.nodeId,
      E2EE_NODE_IDENTITY_ALGORITHM,
      value.nodeIdentityPublicKey,
      value.clientIdentityFingerprint,
      value.maxRole,
      value.capabilitySet,
      value.nodeContinuityId,
      value.nodePolicyGeneration,
      value.approvedAt,
      value.approvalId,
      value.issuedAt,
      value.expiresAt,
    ]),
    CROSS_DEVICE_APPROVAL_MAX_TBS_BYTES,
  );
}

/** Strict canonical decoder for a node-signed approval transcript. */
export function decodeCrossDeviceApprovalTbs(bytes: Uint8Array): CrossDeviceApproval {
  const bounded = requireBoundedBytes(bytes, CROSS_DEVICE_APPROVAL_MAX_TBS_BYTES);
  const decoded = decodeCanonicalE2eeCbor(bounded);
  if (decoded.kind !== "ok" || !Array.isArray(decoded.value) || decoded.value.length !== 16) {
    return invalidRelayE2eeInput();
  }
  const value = decoded.value;
  if (
    value[0] !== CROSS_DEVICE_APPROVAL_DOMAIN ||
    value[1] !== CROSS_DEVICE_APPROVAL_PROTOCOL_VERSION ||
    value[5] !== E2EE_NODE_IDENTITY_ALGORITHM
  ) {
    return invalidRelayE2eeInput();
  }
  const approval = validateApproval({
    hubOrigin: value[2] as string,
    accountId: value[3] as string,
    nodeId: value[4] as string,
    nodeIdentityPublicKey: value[6] as Uint8Array,
    clientIdentityFingerprint: value[7] as Uint8Array,
    maxRole: value[8] as string,
    capabilitySet: value[9] as readonly string[],
    nodeContinuityId: value[10] as string,
    nodePolicyGeneration: value[11] as number,
    approvedAt: value[12] as number,
    approvalId: value[13] as Uint8Array,
    issuedAt: value[14] as number,
    expiresAt: value[15] as number,
  });
  if (!e2eeBytesEqual(bounded, encodeCrossDeviceApprovalTbs(approval))) {
    return invalidRelayE2eeInput();
  }
  return approval;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let out = "";
  for (let index = 0; index < bytes.byteLength; index += 3) {
    const first = bytes[index]!;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    out += BASE64URL_ALPHABET[first >> 2];
    out += BASE64URL_ALPHABET[((first & 0x03) << 4) | ((second ?? 0) >> 4)];
    if (second === undefined) break;
    out += BASE64URL_ALPHABET[((second & 0x0f) << 2) | ((third ?? 0) >> 6)];
    if (third === undefined) break;
    out += BASE64URL_ALPHABET[third & 0x3f];
  }
  return out;
}

function decodeBase64Url(value: string): Uint8Array {
  if (typeof value !== "string" || value.length === 0 || value.includes("=")) {
    return invalidRelayE2eeInput();
  }
  const bytes: number[] = [];
  let accumulator = 0;
  let bits = 0;
  for (const character of value) {
    const digit = BASE64URL_ALPHABET.indexOf(character);
    if (digit < 0) return invalidRelayE2eeInput();
    accumulator = (accumulator << 6) | digit;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((accumulator >> bits) & 0xff);
    }
  }
  if (bits >= 6 || (bits > 0 && (accumulator & ((1 << bits) - 1)) !== 0)) {
    return invalidRelayE2eeInput();
  }
  const decoded = Uint8Array.from(bytes);
  if (encodeBase64Url(decoded) !== value) return invalidRelayE2eeInput();
  return decoded;
}

/** Encode the signed envelope as the complete QR scanner payload. */
export function encodeCrossDeviceApprovalQr(input: CrossDeviceApprovalEnvelope): string {
  const tbs = decodeCrossDeviceApprovalTbs(input.tbs);
  const signature = requireBytes(input.signature, CROSS_DEVICE_APPROVAL_SIGNATURE_BYTES);
  if (
    !verifyE2eeSignature({
      algorithm: E2EE_NODE_IDENTITY_ALGORITHM,
      publicKey: tbs.nodeIdentityPublicKey,
      message: input.tbs,
      signature,
    })
  ) {
    return invalidRelayE2eeInput();
  }
  const envelope = requireBoundedBytes(
    encodeCanonicalE2eeCbor([
      CROSS_DEVICE_APPROVAL_ENVELOPE_DOMAIN,
      CROSS_DEVICE_APPROVAL_PROTOCOL_VERSION,
      input.tbs,
      signature,
    ]),
    CROSS_DEVICE_APPROVAL_MAX_ENVELOPE_BYTES,
  );
  return `${CROSS_DEVICE_APPROVAL_QR_PREFIX}${encodeBase64Url(envelope)}`;
}

/** Strictly decode a QR payload without yet granting it any trust meaning. */
export function decodeCrossDeviceApprovalQr(payload: string): CrossDeviceApprovalEnvelope {
  if (typeof payload !== "string" || !payload.startsWith(CROSS_DEVICE_APPROVAL_QR_PREFIX)) {
    return invalidRelayE2eeInput();
  }
  const envelope = requireBoundedBytes(
    decodeBase64Url(payload.slice(CROSS_DEVICE_APPROVAL_QR_PREFIX.length)),
    CROSS_DEVICE_APPROVAL_MAX_ENVELOPE_BYTES,
  );
  const decoded = decodeCanonicalE2eeCbor(envelope);
  if (decoded.kind !== "ok" || !Array.isArray(decoded.value) || decoded.value.length !== 4) {
    return invalidRelayE2eeInput();
  }
  const value = decoded.value;
  if (
    value[0] !== CROSS_DEVICE_APPROVAL_ENVELOPE_DOMAIN ||
    value[1] !== CROSS_DEVICE_APPROVAL_PROTOCOL_VERSION
  ) {
    return invalidRelayE2eeInput();
  }
  const result = {
    tbs: requireBoundedBytes(value[2] as Uint8Array, CROSS_DEVICE_APPROVAL_MAX_TBS_BYTES),
    signature: requireBytes(value[3] as Uint8Array, CROSS_DEVICE_APPROVAL_SIGNATURE_BYTES),
  };
  const canonical = encodeCanonicalE2eeCbor([
    CROSS_DEVICE_APPROVAL_ENVELOPE_DOMAIN,
    CROSS_DEVICE_APPROVAL_PROTOCOL_VERSION,
    result.tbs,
    result.signature,
  ]);
  if (!e2eeBytesEqual(envelope, canonical)) return invalidRelayE2eeInput();
  return result;
}

export function crossDeviceApprovalIsCurrent(
  approval: Pick<CrossDeviceApproval, "issuedAt" | "expiresAt">,
  now: number,
): boolean {
  if (!Number.isSafeInteger(now) || now < 0) return false;
  return (
    approval.issuedAt <= now + CROSS_DEVICE_APPROVAL_CLOCK_SKEW_MS &&
    approval.expiresAt > now - CROSS_DEVICE_APPROVAL_CLOCK_SKEW_MS
  );
}

/**
 * Verify the signature and every selection/key binding in one choke point.
 * A caller cannot accidentally validate a QR and omit the current presented
 * node key or this device's client key from the decision.
 */
export function verifyCrossDeviceApprovalQr(
  input: VerifyCrossDeviceApprovalQrInput,
): CrossDeviceApproval | undefined {
  try {
    const envelope = decodeCrossDeviceApprovalQr(input.payload);
    const approval = decodeCrossDeviceApprovalTbs(envelope.tbs);
    const nodeIdentityPublicKey = validateE2eeNodeIdentityPublicKey(input.nodeIdentityPublicKey);
    const clientIdentityPublicKey = validateE2eeClientIdentityPublicKey(
      input.clientIdentityPublicKey,
    );
    if (
      !verifyE2eeSignature({
        algorithm: E2EE_NODE_IDENTITY_ALGORITHM,
        publicKey: approval.nodeIdentityPublicKey,
        message: envelope.tbs,
        signature: envelope.signature,
      }) ||
      approval.hubOrigin !== canonicalizeE2eeHubOrigin(input.hubOrigin) ||
      approval.accountId !== assertE2eeAccountId(input.accountId) ||
      approval.nodeId !== input.nodeId ||
      !e2eeBytesEqual(approval.nodeIdentityPublicKey, nodeIdentityPublicKey) ||
      !e2eeBytesEqual(
        approval.clientIdentityFingerprint,
        e2eeKeyFingerprint("client-identity", clientIdentityPublicKey),
      ) ||
      approval.nodeContinuityId !== input.nodeContinuityId ||
      approval.nodePolicyGeneration !== input.nodePolicyGeneration ||
      !crossDeviceApprovalIsCurrent(approval, input.now)
    ) {
      return undefined;
    }
    return approval;
  } catch {
    return undefined;
  }
}
