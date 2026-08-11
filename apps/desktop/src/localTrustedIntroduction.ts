import * as Crypto from "node:crypto";

import { decodeBase64Url, encodeBase64Url, type DpopSigningKey } from "@ryco/client-runtime/relay";
import type {
  NativeNodeClaimFinishResponse,
  NativeNodeClaimStartResponse,
} from "@ryco/contracts/hosted-identity";
import {
  decodeLocalIntroductionRequestTbs,
  encodeLocalIntroductionRequestTbs,
  LTI_CLOCK_SKEW_MS,
  LTI_MAX_LIFETIME_MS,
  verifyLocalIntroductionApproval,
  verifyLocalIntroductionRequestSignature,
} from "@ryco/shared/relayE2eeLocalIntroduction";
import {
  e2eeBytesEqual,
  e2eeKeyFingerprint,
  formatE2eeKeyFingerprint,
  validateE2eeAgreementPublicKey,
  validateE2eeClientIdentityPublicKey,
  validateE2eeNodeIdentityPublicKey,
} from "@ryco/shared/relayE2eeKeys";

import type { DesktopHubControlClient } from "./desktopHubControl.ts";
import { DesktopE2eeTrustStore, type DesktopVerifiedE2eePin } from "./desktopE2eeTrust.ts";
import type { DesktopProtectedRecordStore } from "./protectedRecordStore.ts";

const PENDING_RECORD = "pending-introduction";

export type DesktopLocalIntroductionErrorCode =
  | "local_introduction_unavailable"
  | "local_introduction_conflict"
  | "local_introduction_custody_unavailable";

export class DesktopLocalIntroductionError extends Error {
  readonly code: DesktopLocalIntroductionErrorCode;

  constructor(code: DesktopLocalIntroductionErrorCode) {
    super("Desktop local E2EE introduction failed.");
    this.name = "DesktopLocalIntroductionError";
    this.code = code;
  }
}

function fail(code: DesktopLocalIntroductionErrorCode): never {
  throw new DesktopLocalIntroductionError(code);
}

export interface DesktopLocalIntroductionSecurity {
  readonly getSigningPublicKey: () => Promise<Uint8Array>;
  readonly getSigningKey: () => Promise<DpopSigningKey>;
  readonly ensureAgreementPublicKey: () => Promise<Uint8Array>;
}

interface PendingIntroduction {
  readonly requestTbs: Uint8Array;
  readonly requestSignature: Uint8Array;
}

function parsePending(value: string | null): PendingIntroduction | null {
  if (value === null) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const record = parsed as { readonly requestTbs?: unknown; readonly requestSignature?: unknown };
    if (
      Object.keys(record).length !== 2 ||
      typeof record.requestTbs !== "string" ||
      typeof record.requestSignature !== "string"
    ) {
      return null;
    }
    const requestTbs = decodeBase64Url(record.requestTbs);
    const requestSignature = decodeBase64Url(record.requestSignature);
    if (requestSignature.byteLength !== 64) return null;
    if (
      verifyLocalIntroductionRequestSignature({ requestTbs, signature: requestSignature }) ===
      undefined
    ) {
      return null;
    }
    return { requestTbs, requestSignature };
  } catch {
    return null;
  }
}

function exactBytes(left: Uint8Array, right: Uint8Array): boolean {
  return e2eeBytesEqual(left, right);
}

/** Complete and durably promote a same-machine introduction, replaying safely after crashes. */
export async function runDesktopLocalTrustedIntroduction(input: {
  readonly control: DesktopHubControlClient;
  readonly security: DesktopLocalIntroductionSecurity;
  readonly records: DesktopProtectedRecordStore;
  readonly trust: DesktopE2eeTrustStore;
  readonly installationId: string;
  readonly expectedHubOrigin: string;
  readonly claim: NativeNodeClaimStartResponse;
  readonly result: NativeNodeClaimFinishResponse;
  readonly now?: () => number;
  readonly randomBytes?: (length: number) => Uint8Array;
}): Promise<DesktopVerifiedE2eePin> {
  const now = input.now ?? Date.now;
  const randomBytes =
    input.randomBytes ?? ((length: number) => Uint8Array.from(Crypto.randomBytes(length)));
  const claimDescriptor = await input.control
    .nodeClaimDescriptor()
    .catch(() => fail("local_introduction_unavailable"));
  const descriptor = await input.control
    .localIntroductionDescriptor()
    .catch(() => fail("local_introduction_unavailable"));
  if (
    claimDescriptor.state !== "active" ||
    claimDescriptor.hubOrigin !== input.expectedHubOrigin ||
    claimDescriptor.environmentId !== input.result.node.environmentId ||
    claimDescriptor.fingerprint !== input.result.node.fingerprint ||
    descriptor.hubOrigin !== input.expectedHubOrigin ||
    descriptor.environmentId !== input.result.node.environmentId ||
    descriptor.nodeId !== input.result.node.id
  ) {
    return fail("local_introduction_conflict");
  }

  let nodeIdentityPublicKey: Uint8Array;
  let clientIdentityPublicKey: Uint8Array;
  let clientAgreementPublicKey: Uint8Array;
  try {
    nodeIdentityPublicKey = validateE2eeNodeIdentityPublicKey(
      decodeBase64Url(descriptor.nodeIdentityPublicKey),
    );
    const claimedPublicKey = validateE2eeNodeIdentityPublicKey(
      decodeBase64Url(claimDescriptor.publicKey),
    );
    if (!exactBytes(nodeIdentityPublicKey, claimedPublicKey)) {
      return fail("local_introduction_conflict");
    }
    if (
      encodeBase64Url(e2eeKeyFingerprint("node-identity", nodeIdentityPublicKey)) !==
        descriptor.nodeIdentityFingerprint ||
      formatE2eeKeyFingerprint(e2eeKeyFingerprint("node-identity", nodeIdentityPublicKey)) !==
        claimDescriptor.fingerprint
    ) {
      return fail("local_introduction_conflict");
    }
    clientIdentityPublicKey = validateE2eeClientIdentityPublicKey(
      await input.security.getSigningPublicKey(),
    );
    clientAgreementPublicKey = validateE2eeAgreementPublicKey(
      await input.security.ensureAgreementPublicKey(),
    );
  } catch (cause) {
    if (cause instanceof DesktopLocalIntroductionError) throw cause;
    return fail("local_introduction_custody_unavailable");
  }

  let pending = parsePending(
    await input.records.read(PENDING_RECORD).catch(() => fail("local_introduction_unavailable")),
  );
  if (pending !== null) {
    const request = decodeLocalIntroductionRequestTbs(pending.requestTbs);
    const stillCurrent =
      request.expiresAt > now() - LTI_CLOCK_SKEW_MS &&
      request.hubOrigin === input.expectedHubOrigin &&
      request.accountId === input.claim.accountId &&
      request.installationId === input.installationId &&
      request.environmentId === descriptor.environmentId &&
      request.nodeId === descriptor.nodeId &&
      exactBytes(request.nodeIdentityPublicKey, nodeIdentityPublicKey) &&
      exactBytes(request.clientIdentityPublicKey, clientIdentityPublicKey) &&
      exactBytes(request.clientAgreementPublicKey, clientAgreementPublicKey);
    if (!stillCurrent) {
      await input.records
        .delete(PENDING_RECORD)
        .catch(() => fail("local_introduction_unavailable"));
      pending = null;
    }
  }

  if (pending === null) {
    const issuedAt = now();
    const requestTbs = encodeLocalIntroductionRequestTbs({
      hubOrigin: input.expectedHubOrigin,
      accountId: input.claim.accountId,
      claimId: input.claim.claimId,
      installationId: input.installationId,
      environmentId: descriptor.environmentId,
      nodeId: descriptor.nodeId,
      nodeIdentityPublicKey,
      clientIdentityPublicKey,
      clientAgreementPublicKey,
      introductionId: randomBytes(32),
      nonce: randomBytes(32),
      maxRole: "owner",
      capabilitySet: ["ryco.rpc"],
      displayLabel: "Ryco Desktop",
      nodeContinuityId: descriptor.nodeContinuityId,
      nodePolicyGeneration: descriptor.nodePolicyGeneration,
      claimDisposition: input.result.disposition,
      issuedAt,
      expiresAt: issuedAt + LTI_MAX_LIFETIME_MS,
    });
    let requestSignature: Uint8Array;
    try {
      requestSignature = await (await input.security.getSigningKey()).sign(requestTbs);
    } catch {
      return fail("local_introduction_custody_unavailable");
    }
    if (
      requestSignature.byteLength !== 64 ||
      verifyLocalIntroductionRequestSignature({ requestTbs, signature: requestSignature }) ===
        undefined
    ) {
      return fail("local_introduction_custody_unavailable");
    }
    pending = { requestTbs, requestSignature };
    await input.records
      .write(
        PENDING_RECORD,
        JSON.stringify({
          requestTbs: encodeBase64Url(requestTbs),
          requestSignature: encodeBase64Url(requestSignature),
        }),
      )
      .catch(() => fail("local_introduction_unavailable"));
  }

  const completed = await input.control
    .completeLocalIntroduction({
      requestTbs: encodeBase64Url(pending.requestTbs),
      requestSignature: encodeBase64Url(pending.requestSignature),
    })
    .catch(() => fail("local_introduction_unavailable"));
  const approval = verifyLocalIntroductionApproval({
    requestTbs: pending.requestTbs,
    approvalTbs: decodeBase64Url(completed.approvalTbs),
    signature: decodeBase64Url(completed.approvalSignature),
  });
  if (approval === undefined) return fail("local_introduction_conflict");
  const request = decodeLocalIntroductionRequestTbs(pending.requestTbs);
  const pin = await input.trust
    .promoteLocal({
      hubOrigin: request.hubOrigin,
      accountId: request.accountId,
      nodeId: request.nodeId,
      environmentId: request.environmentId,
      nodeIdentityPublicKey: request.nodeIdentityPublicKey,
      nodeContinuityId: request.nodeContinuityId,
      nodePolicyGeneration: request.nodePolicyGeneration,
      clientIdentityPublicKey: request.clientIdentityPublicKey,
      approvedAt: approval.approvedAt,
    })
    .catch(() => fail("local_introduction_unavailable"));
  await input.records.delete(PENDING_RECORD).catch(() => fail("local_introduction_unavailable"));
  return pin;
}
