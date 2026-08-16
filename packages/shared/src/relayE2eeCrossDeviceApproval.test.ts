import { ed25519 } from "@noble/curves/ed25519.js";
import { p256 } from "@noble/curves/nist.js";
import { describe, expect, it } from "vitest";

import {
  CROSS_DEVICE_APPROVAL_CLOCK_SKEW_MS,
  CROSS_DEVICE_APPROVAL_MAX_LIFETIME_MS,
  CROSS_DEVICE_APPROVAL_QR_PREFIX,
  crossDeviceApprovalIsCurrent,
  decodeCrossDeviceApprovalQr,
  decodeCrossDeviceApprovalTbs,
  encodeCrossDeviceApprovalQr,
  encodeCrossDeviceApprovalTbs,
  type CrossDeviceApprovalInput,
  verifyCrossDeviceApprovalQr,
} from "./relayE2eeCrossDeviceApproval.ts";
import { RelayE2eeValidationError, e2eeKeyFingerprint } from "./relayE2eeKeys.ts";

const NODE_SECRET = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const OTHER_NODE_SECRET = Uint8Array.from({ length: 32 }, (_, index) => 0x40 + index);
const CLIENT_SECRET = Uint8Array.from({ length: 32 }, (_, index) => 0xa0 + index);
const OTHER_CLIENT_SECRET = Uint8Array.from({ length: 32 }, (_, index) => 0x20 + index);
const NODE_PUBLIC = ed25519.getPublicKey(NODE_SECRET);
const OTHER_NODE_PUBLIC = ed25519.getPublicKey(OTHER_NODE_SECRET);
const CLIENT_PUBLIC = p256.getPublicKey(CLIENT_SECRET, false);
const OTHER_CLIENT_PUBLIC = p256.getPublicKey(OTHER_CLIENT_SECRET, false);
const ISSUED_AT = 1_800_000_000_000;

const approvalInput = (
  overrides: Partial<CrossDeviceApprovalInput> = {},
): CrossDeviceApprovalInput => ({
  hubOrigin: "https://hub.example.test",
  accountId: `acct_${"A".repeat(22)}`,
  nodeId: `node_${"B".repeat(22)}`,
  nodeIdentityPublicKey: NODE_PUBLIC,
  clientIdentityFingerprint: e2eeKeyFingerprint("client-identity", CLIENT_PUBLIC),
  maxRole: "owner",
  capabilitySet: ["ryco.rpc"],
  nodeContinuityId: `nct_${"C".repeat(22)}`,
  nodePolicyGeneration: 7,
  approvedAt: ISSUED_AT - 1_000,
  approvalId: Uint8Array.from({ length: 32 }, (_, index) => 0xff - index),
  issuedAt: ISSUED_AT,
  expiresAt: ISSUED_AT + CROSS_DEVICE_APPROVAL_MAX_LIFETIME_MS,
  ...overrides,
});

const signedQr = (overrides: Partial<CrossDeviceApprovalInput> = {}) => {
  const tbs = encodeCrossDeviceApprovalTbs(approvalInput(overrides));
  const signature = ed25519.sign(tbs, NODE_SECRET);
  return { tbs, signature, payload: encodeCrossDeviceApprovalQr({ tbs, signature }) };
};

const verificationInput = (payload: string) => ({
  payload,
  hubOrigin: approvalInput().hubOrigin,
  accountId: approvalInput().accountId,
  nodeId: approvalInput().nodeId,
  nodeIdentityPublicKey: NODE_PUBLIC,
  clientIdentityPublicKey: CLIENT_PUBLIC,
  nodeContinuityId: approvalInput().nodeContinuityId,
  nodePolicyGeneration: approvalInput().nodePolicyGeneration,
  now: ISSUED_AT,
});

describe("relay E2EE cross-device approval", () => {
  it("strictly round-trips the signed QR and verifies every current binding", () => {
    const signed = signedQr();
    expect(signed.payload.startsWith(CROSS_DEVICE_APPROVAL_QR_PREFIX)).toBe(true);
    expect(decodeCrossDeviceApprovalQr(signed.payload)).toEqual({
      tbs: signed.tbs,
      signature: signed.signature,
    });
    expect(encodeCrossDeviceApprovalTbs(decodeCrossDeviceApprovalTbs(signed.tbs))).toEqual(
      signed.tbs,
    );
    expect(verifyCrossDeviceApprovalQr(verificationInput(signed.payload))).toMatchObject({
      maxRole: "owner",
      capabilitySet: ["ryco.rpc"],
      approvedAt: ISSUED_AT - 1_000,
      nodePolicyGeneration: 7,
    });
  });

  it("rejects another node, client, selection, continuity lineage, and policy generation", () => {
    const { payload } = signedQr();
    const baseline = verificationInput(payload);
    const rejected = [
      { ...baseline, nodeIdentityPublicKey: OTHER_NODE_PUBLIC },
      { ...baseline, clientIdentityPublicKey: OTHER_CLIENT_PUBLIC },
      { ...baseline, hubOrigin: "https://other.example.test" },
      { ...baseline, accountId: `acct_${"Z".repeat(22)}` },
      { ...baseline, nodeId: `node_${"Z".repeat(22)}` },
      { ...baseline, nodeContinuityId: `nct_${"Z".repeat(22)}` },
      { ...baseline, nodePolicyGeneration: 8 },
    ];
    for (const input of rejected) expect(verifyCrossDeviceApprovalQr(input)).toBeUndefined();
  });

  it("rejects a corrupt signature, alternate payload encoding, and non-canonical authority", () => {
    const signed = signedQr();
    const corruptSignature = Uint8Array.from(signed.signature);
    corruptSignature[0] = corruptSignature[0]! ^ 0x80;
    expect(() =>
      encodeCrossDeviceApprovalQr({ tbs: signed.tbs, signature: corruptSignature }),
    ).toThrow(RelayE2eeValidationError);
    expect(verifyCrossDeviceApprovalQr(verificationInput(`${signed.payload}=`))).toBeUndefined();
    expect(() =>
      encodeCrossDeviceApprovalTbs(approvalInput({ capabilitySet: ["ryco.rpc", "ryco.rpc"] })),
    ).toThrow(RelayE2eeValidationError);
  });

  it("enforces approval ordering, lifetime, and exact skew boundaries", () => {
    expect(() =>
      encodeCrossDeviceApprovalTbs(approvalInput({ approvedAt: ISSUED_AT + 1 })),
    ).toThrow(RelayE2eeValidationError);
    expect(() =>
      encodeCrossDeviceApprovalTbs(
        approvalInput({ expiresAt: ISSUED_AT + CROSS_DEVICE_APPROVAL_MAX_LIFETIME_MS + 1 }),
      ),
    ).toThrow(RelayE2eeValidationError);

    const approval = decodeCrossDeviceApprovalTbs(signedQr().tbs);
    expect(
      crossDeviceApprovalIsCurrent(approval, ISSUED_AT - CROSS_DEVICE_APPROVAL_CLOCK_SKEW_MS),
    ).toBe(true);
    expect(
      crossDeviceApprovalIsCurrent(approval, ISSUED_AT - CROSS_DEVICE_APPROVAL_CLOCK_SKEW_MS - 1),
    ).toBe(false);
    expect(
      crossDeviceApprovalIsCurrent(
        approval,
        approval.expiresAt + CROSS_DEVICE_APPROVAL_CLOCK_SKEW_MS - 1,
      ),
    ).toBe(true);
    expect(
      crossDeviceApprovalIsCurrent(
        approval,
        approval.expiresAt + CROSS_DEVICE_APPROVAL_CLOCK_SKEW_MS,
      ),
    ).toBe(false);
  });

  it("binds the envelope signature to its exact TBS", () => {
    const signed = signedQr();
    const otherTbs = encodeCrossDeviceApprovalTbs(
      approvalInput({ approvalId: new Uint8Array(32) }),
    );
    expect(() =>
      encodeCrossDeviceApprovalQr({ tbs: otherTbs, signature: signed.signature }),
    ).toThrow(RelayE2eeValidationError);
  });
});
