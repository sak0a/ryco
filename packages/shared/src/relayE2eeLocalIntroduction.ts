import { sha256 } from "@noble/hashes/sha2";

import { E2EE_CLIENT_DISPLAY_LABEL_MAX_CHARS } from "./relayE2eeConstants.ts";
import {
  E2EE_AGREEMENT_ALGORITHM,
  E2EE_CLIENT_IDENTITY_ALGORITHM,
  E2EE_NODE_IDENTITY_ALGORITHM,
  e2eeBytesEqual,
  e2eeKeyFingerprint,
  invalidRelayE2eeInput,
  validateE2eeAgreementPublicKey,
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

// The canonical transcript implementation for
// docs/relay-e2ee-local-introduction-protocol.md. This module deliberately has
// no Node, DOM, React, or React Native imports: the node, Electron main, and
// native clients must encode and verify byte-identical structures.

export const LTI_PROTOCOL_VERSION = 1 as const;
export const LTI_REQUEST_DOMAIN = "ryco.e2ee.local-introduction.request.v1" as const;
export const LTI_APPROVAL_DOMAIN = "ryco.e2ee.local-introduction.approval.v1" as const;
export const LTI_DIGEST_DOMAIN = "ryco.e2ee.local-introduction.digest.v1" as const;
export const LTI_ID_BYTES = 32;
export const LTI_NONCE_BYTES = 32;
export const LTI_DIGEST_BYTES = 32;
export const LTI_MAX_TRANSCRIPT_BYTES = 4_096;
export const LTI_MAX_LIFETIME_MS = 300_000;
export const LTI_CLOCK_SKEW_MS = 30_000;
export const LTI_MAX_CAPABILITIES = 32;
export const LTI_LEDGER_MAX_ENTRIES = 64;
export const LTI_LEDGER_RETENTION_MS = 86_400_000;

const CLAIM_ID = /^nclaim_[A-Za-z0-9_-]{22,43}$/;
const INSTALLATION_ID = /^install_[A-Za-z0-9_-]{22,43}$/;
const ENVIRONMENT_ID = /^env_[A-Za-z0-9_-]{22}$/;
const NODE_ID = /^node_[A-Za-z0-9_-]{22,43}$/;
const CONTINUITY_ID = /^nct_[A-Za-z0-9_-]{22}$/;

export type LocalIntroductionClaimDisposition = "created" | "reconnected";

export interface LocalIntroductionRequestInput {
  readonly hubOrigin: string;
  readonly accountId: string;
  readonly claimId: string;
  readonly installationId: string;
  readonly environmentId: string;
  readonly nodeId: string;
  readonly nodeIdentityPublicKey: Uint8Array;
  readonly clientIdentityPublicKey: Uint8Array;
  readonly clientAgreementPublicKey: Uint8Array;
  readonly introductionId: Uint8Array;
  readonly nonce: Uint8Array;
  readonly maxRole: string;
  readonly capabilitySet: readonly string[];
  readonly displayLabel?: string | undefined;
  readonly nodeContinuityId: string;
  readonly nodePolicyGeneration: number;
  readonly claimDisposition: LocalIntroductionClaimDisposition;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

export interface LocalIntroductionRequest extends LocalIntroductionRequestInput {
  readonly hubOrigin: string;
  readonly accountId: string;
  readonly nodeIdentityPublicKey: Uint8Array;
  readonly clientIdentityPublicKey: Uint8Array;
  readonly clientAgreementPublicKey: Uint8Array;
  readonly introductionId: Uint8Array;
  readonly nonce: Uint8Array;
  readonly capabilitySet: readonly string[];
}

export interface LocalIntroductionApprovalInput {
  readonly requestTbs: Uint8Array;
  readonly approvedAt: number;
}

export interface LocalIntroductionApproval {
  readonly requestDigest: Uint8Array;
  readonly nodeIdentityPublicKey: Uint8Array;
  readonly nodeIdentityFingerprint: Uint8Array;
  readonly clientIdentityFingerprint: Uint8Array;
  readonly clientAgreementFingerprint: Uint8Array;
  readonly maxRole: string;
  readonly capabilitySet: readonly string[];
  readonly nodeContinuityId: string;
  readonly nodePolicyGeneration: number;
  readonly approvedAt: number;
  readonly requestExpiresAt: number;
}

function requireBytes(value: Uint8Array, length: number): Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength !== length) {
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

function requireDisplayLabel(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > E2EE_CLIENT_DISPLAY_LABEL_MAX_CHARS ||
    value.trim() !== value
  ) {
    return invalidRelayE2eeInput();
  }
  return value;
}

function requireClaimDisposition(value: string): LocalIntroductionClaimDisposition {
  if (value !== "created" && value !== "reconnected") return invalidRelayE2eeInput();
  return value;
}

function requireCapabilitySet(value: readonly string[]): readonly string[] {
  if (!Array.isArray(value) || value.length > LTI_MAX_CAPABILITIES) {
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

function requireLifetime(issuedAt: number, expiresAt: number): void {
  if (expiresAt <= issuedAt || expiresAt - issuedAt > LTI_MAX_LIFETIME_MS) {
    invalidRelayE2eeInput();
  }
}

function requireTranscriptBound(value: Uint8Array): Uint8Array {
  if (
    !(value instanceof Uint8Array) ||
    value.byteLength === 0 ||
    value.byteLength > LTI_MAX_TRANSCRIPT_BYTES
  ) {
    return invalidRelayE2eeInput();
  }
  return Uint8Array.from(value);
}

function validateRequest(input: LocalIntroductionRequestInput): LocalIntroductionRequest {
  const issuedAt = requireUnsignedSafeInteger(input.issuedAt);
  const expiresAt = requireUnsignedSafeInteger(input.expiresAt);
  requireLifetime(issuedAt, expiresAt);
  return {
    hubOrigin: canonicalizeE2eeHubOrigin(input.hubOrigin),
    accountId: assertE2eeAccountId(input.accountId),
    claimId: requireIdentifier(input.claimId, CLAIM_ID),
    installationId: requireIdentifier(input.installationId, INSTALLATION_ID),
    environmentId: requireIdentifier(input.environmentId, ENVIRONMENT_ID),
    nodeId: requireIdentifier(input.nodeId, NODE_ID),
    nodeIdentityPublicKey: validateE2eeNodeIdentityPublicKey(input.nodeIdentityPublicKey),
    clientIdentityPublicKey: validateE2eeClientIdentityPublicKey(input.clientIdentityPublicKey),
    clientAgreementPublicKey: validateE2eeAgreementPublicKey(input.clientAgreementPublicKey),
    introductionId: requireBytes(input.introductionId, LTI_ID_BYTES),
    nonce: requireBytes(input.nonce, LTI_NONCE_BYTES),
    maxRole: assertRelayEffectiveRoleLiteral(input.maxRole),
    capabilitySet: requireCapabilitySet(input.capabilitySet),
    ...(requireDisplayLabel(input.displayLabel) === undefined
      ? {}
      : { displayLabel: requireDisplayLabel(input.displayLabel) }),
    nodeContinuityId: requireIdentifier(input.nodeContinuityId, CONTINUITY_ID),
    nodePolicyGeneration: requireUnsignedSafeInteger(input.nodePolicyGeneration),
    claimDisposition: requireClaimDisposition(input.claimDisposition),
    issuedAt,
    expiresAt,
  };
}

/** Encode the exact 24-member LTI request transcript (§6). */
export function encodeLocalIntroductionRequestTbs(
  input: LocalIntroductionRequestInput,
): Uint8Array {
  const value = validateRequest(input);
  return requireTranscriptBound(
    encodeCanonicalE2eeCbor([
      LTI_REQUEST_DOMAIN,
      LTI_PROTOCOL_VERSION,
      value.hubOrigin,
      value.accountId,
      value.claimId,
      value.installationId,
      value.environmentId,
      value.nodeId,
      E2EE_NODE_IDENTITY_ALGORITHM,
      value.nodeIdentityPublicKey,
      E2EE_CLIENT_IDENTITY_ALGORITHM,
      value.clientIdentityPublicKey,
      E2EE_AGREEMENT_ALGORITHM,
      value.clientAgreementPublicKey,
      value.introductionId,
      value.nonce,
      value.maxRole,
      value.capabilitySet,
      value.displayLabel ?? null,
      value.nodeContinuityId,
      value.nodePolicyGeneration,
      value.claimDisposition,
      value.issuedAt,
      value.expiresAt,
    ]),
  );
}

/** Decode and re-encode a request, rejecting every alternate representation. */
export function decodeLocalIntroductionRequestTbs(bytes: Uint8Array): LocalIntroductionRequest {
  const bounded = requireTranscriptBound(bytes);
  const decoded = decodeCanonicalE2eeCbor(bounded);
  if (decoded.kind !== "ok" || !Array.isArray(decoded.value) || decoded.value.length !== 24) {
    return invalidRelayE2eeInput();
  }
  const value = decoded.value;
  if (
    value[0] !== LTI_REQUEST_DOMAIN ||
    value[1] !== LTI_PROTOCOL_VERSION ||
    value[8] !== E2EE_NODE_IDENTITY_ALGORITHM ||
    value[10] !== E2EE_CLIENT_IDENTITY_ALGORITHM ||
    value[12] !== E2EE_AGREEMENT_ALGORITHM ||
    (value[18] !== null && typeof value[18] !== "string")
  ) {
    return invalidRelayE2eeInput();
  }
  const request = validateRequest({
    hubOrigin: value[2] as string,
    accountId: value[3] as string,
    claimId: value[4] as string,
    installationId: value[5] as string,
    environmentId: value[6] as string,
    nodeId: value[7] as string,
    nodeIdentityPublicKey: value[9] as Uint8Array,
    clientIdentityPublicKey: value[11] as Uint8Array,
    clientAgreementPublicKey: value[13] as Uint8Array,
    introductionId: value[14] as Uint8Array,
    nonce: value[15] as Uint8Array,
    maxRole: value[16] as string,
    capabilitySet: value[17] as readonly string[],
    ...(value[18] === null ? {} : { displayLabel: value[18] as string }),
    nodeContinuityId: value[19] as string,
    nodePolicyGeneration: value[20] as number,
    claimDisposition: value[21] as LocalIntroductionClaimDisposition,
    issuedAt: value[22] as number,
    expiresAt: value[23] as number,
  });
  const canonical = encodeLocalIntroductionRequestTbs(request);
  if (!e2eeBytesEqual(bounded, canonical)) return invalidRelayE2eeInput();
  return request;
}

/** The domain-separated digest used as the approval's request commitment (§5). */
export function localIntroductionRequestDigest(requestTbs: Uint8Array): Uint8Array {
  const canonical = encodeLocalIntroductionRequestTbs(
    decodeLocalIntroductionRequestTbs(requestTbs),
  );
  return sha256(encodeCanonicalE2eeCbor([LTI_DIGEST_DOMAIN, canonical]));
}

/** Check the request lifetime at a node's receipt boundary (§6). */
export function localIntroductionRequestIsCurrent(
  request: Pick<LocalIntroductionRequest, "issuedAt" | "expiresAt">,
  now: number,
): boolean {
  if (!Number.isSafeInteger(now) || now < 0) return false;
  return request.issuedAt <= now + LTI_CLOCK_SKEW_MS && request.expiresAt > now - LTI_CLOCK_SKEW_MS;
}

/** Verify the P-256 request signature after strict transcript decoding. */
export function verifyLocalIntroductionRequestSignature(input: {
  readonly requestTbs: Uint8Array;
  readonly signature: Uint8Array;
}): LocalIntroductionRequest | undefined {
  try {
    const request = decodeLocalIntroductionRequestTbs(input.requestTbs);
    return verifyE2eeSignature({
      algorithm: E2EE_CLIENT_IDENTITY_ALGORITHM,
      publicKey: request.clientIdentityPublicKey,
      message: input.requestTbs,
      signature: input.signature,
    })
      ? request
      : undefined;
  } catch {
    return undefined;
  }
}

/** Encode the exact 14-member node approval attestation (§9). */
export function encodeLocalIntroductionApprovalTbs(
  input: LocalIntroductionApprovalInput,
): Uint8Array {
  const request = decodeLocalIntroductionRequestTbs(input.requestTbs);
  const approvedAt = requireUnsignedSafeInteger(input.approvedAt);
  const requestDigest = localIntroductionRequestDigest(input.requestTbs);
  return requireTranscriptBound(
    encodeCanonicalE2eeCbor([
      LTI_APPROVAL_DOMAIN,
      LTI_PROTOCOL_VERSION,
      requestDigest,
      "approved",
      request.nodeIdentityPublicKey,
      e2eeKeyFingerprint("node-identity", request.nodeIdentityPublicKey),
      e2eeKeyFingerprint("client-identity", request.clientIdentityPublicKey),
      e2eeKeyFingerprint("agreement", request.clientAgreementPublicKey),
      request.maxRole,
      request.capabilitySet,
      request.nodeContinuityId,
      request.nodePolicyGeneration,
      approvedAt,
      request.expiresAt,
    ]),
  );
}

function requireFingerprint(value: Uint8Array): Uint8Array {
  return requireBytes(value, LTI_DIGEST_BYTES);
}

/** Decode and re-encode a node approval attestation (§9). */
export function decodeLocalIntroductionApprovalTbs(bytes: Uint8Array): LocalIntroductionApproval {
  const bounded = requireTranscriptBound(bytes);
  const decoded = decodeCanonicalE2eeCbor(bounded);
  if (decoded.kind !== "ok" || !Array.isArray(decoded.value) || decoded.value.length !== 14) {
    return invalidRelayE2eeInput();
  }
  const value = decoded.value;
  if (
    value[0] !== LTI_APPROVAL_DOMAIN ||
    value[1] !== LTI_PROTOCOL_VERSION ||
    value[3] !== "approved"
  ) {
    return invalidRelayE2eeInput();
  }
  const approval: LocalIntroductionApproval = {
    requestDigest: requireFingerprint(value[2] as Uint8Array),
    nodeIdentityPublicKey: validateE2eeNodeIdentityPublicKey(value[4] as Uint8Array),
    nodeIdentityFingerprint: requireFingerprint(value[5] as Uint8Array),
    clientIdentityFingerprint: requireFingerprint(value[6] as Uint8Array),
    clientAgreementFingerprint: requireFingerprint(value[7] as Uint8Array),
    maxRole: assertRelayEffectiveRoleLiteral(value[8] as string),
    capabilitySet: requireCapabilitySet(value[9] as readonly string[]),
    nodeContinuityId: requireIdentifier(value[10] as string, CONTINUITY_ID),
    nodePolicyGeneration: requireUnsignedSafeInteger(value[11] as number),
    approvedAt: requireUnsignedSafeInteger(value[12] as number),
    requestExpiresAt: requireUnsignedSafeInteger(value[13] as number),
  };
  const canonical = encodeCanonicalE2eeCbor([
    LTI_APPROVAL_DOMAIN,
    LTI_PROTOCOL_VERSION,
    approval.requestDigest,
    "approved",
    approval.nodeIdentityPublicKey,
    approval.nodeIdentityFingerprint,
    approval.clientIdentityFingerprint,
    approval.clientAgreementFingerprint,
    approval.maxRole,
    approval.capabilitySet,
    approval.nodeContinuityId,
    approval.nodePolicyGeneration,
    approval.approvedAt,
    approval.requestExpiresAt,
  ]);
  if (!e2eeBytesEqual(bounded, canonical)) return invalidRelayE2eeInput();
  return approval;
}

/**
 * Verify the complete mutual binding: request digest, all key fingerprints,
 * authority, classification state, and the node's Ed25519 signature (§9).
 */
export function verifyLocalIntroductionApproval(input: {
  readonly requestTbs: Uint8Array;
  readonly approvalTbs: Uint8Array;
  readonly signature: Uint8Array;
}): LocalIntroductionApproval | undefined {
  try {
    const request = decodeLocalIntroductionRequestTbs(input.requestTbs);
    const approval = decodeLocalIntroductionApprovalTbs(input.approvalTbs);
    const expectedDigest = localIntroductionRequestDigest(input.requestTbs);
    if (
      !e2eeBytesEqual(approval.requestDigest, expectedDigest) ||
      !e2eeBytesEqual(approval.nodeIdentityPublicKey, request.nodeIdentityPublicKey) ||
      !e2eeBytesEqual(
        approval.nodeIdentityFingerprint,
        e2eeKeyFingerprint("node-identity", request.nodeIdentityPublicKey),
      ) ||
      !e2eeBytesEqual(
        approval.clientIdentityFingerprint,
        e2eeKeyFingerprint("client-identity", request.clientIdentityPublicKey),
      ) ||
      !e2eeBytesEqual(
        approval.clientAgreementFingerprint,
        e2eeKeyFingerprint("agreement", request.clientAgreementPublicKey),
      ) ||
      approval.maxRole !== request.maxRole ||
      approval.capabilitySet.length !== request.capabilitySet.length ||
      approval.capabilitySet.some((entry, index) => entry !== request.capabilitySet[index]) ||
      approval.nodeContinuityId !== request.nodeContinuityId ||
      approval.nodePolicyGeneration !== request.nodePolicyGeneration ||
      approval.requestExpiresAt !== request.expiresAt
    ) {
      return undefined;
    }
    return verifyE2eeSignature({
      algorithm: E2EE_NODE_IDENTITY_ALGORITHM,
      publicKey: request.nodeIdentityPublicKey,
      message: input.approvalTbs,
      signature: input.signature,
    })
      ? approval
      : undefined;
  } catch {
    return undefined;
  }
}
