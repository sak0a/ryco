import { describe, expect, it } from "vite-plus/test";
import { ed25519 } from "@noble/curves/ed25519.js";
import { p256 } from "@noble/curves/nist.js";

import {
  encodeCrossDeviceApprovalQr,
  encodeCrossDeviceApprovalTbs,
} from "@ryco/shared/relayE2eeCrossDeviceApproval";
import { e2eeKeyFingerprint } from "@ryco/shared/relayE2eeKeys";

import {
  INITIAL_NATIVE_TRUST_ONBOARDING_STATE,
  NATIVE_TRUST_APPROVAL_TTL_MS,
  reduceNativeTrustOnboarding,
  verifyNativeTrustApprovalQr,
} from "./nativeTrustOnboarding.ts";

const target = {
  environmentId: `env_${"E".repeat(22)}`,
  hubOrigin: "https://hub.example.test",
  accountId: `acct_${"A".repeat(22)}`,
  nodeId: `node_${"N".repeat(22)}`,
  clientFingerprint: `SHA256:${"A".repeat(43)}`,
  requestedRole: "owner",
} as const;

describe("native trust onboarding", () => {
  it("advances through one approval, one scan, reconnect, and the first IK channel", () => {
    let state = reduceNativeTrustOnboarding(INITIAL_NATIVE_TRUST_ONBOARDING_STATE, {
      type: "begin",
      target,
    });
    expect(state.stage).toBe("requesting-approval");
    state = reduceNativeTrustOnboarding(state, { type: "approval-requested" });
    expect(state.stage).toBe("waiting-for-approval");
    state = reduceNativeTrustOnboarding(state, {
      type: "approval-ready",
      now: 1_000,
      expiresAt: 1_000 + NATIVE_TRUST_APPROVAL_TTL_MS,
    });
    state = reduceNativeTrustOnboarding(state, { type: "start-scan", now: 1_001 });
    state = reduceNativeTrustOnboarding(state, { type: "scan-read" });
    state = reduceNativeTrustOnboarding(state, { type: "approval-verified" });
    expect(state.stage).toBe("reconnecting");
    state = reduceNativeTrustOnboarding(state, { type: "channel-ready" });
    expect(state.stage).toBe("ready");
  });

  it("cannot skip verification or reuse an expired approval", () => {
    let state = reduceNativeTrustOnboarding(INITIAL_NATIVE_TRUST_ONBOARDING_STATE, {
      type: "begin",
      target,
    });
    expect(reduceNativeTrustOnboarding(state, { type: "approval-verified" })).toEqual(state);
    state = reduceNativeTrustOnboarding(state, { type: "approval-requested" });
    state = reduceNativeTrustOnboarding(state, {
      type: "approval-ready",
      now: 1_000,
      expiresAt: 1_000 + NATIVE_TRUST_APPROVAL_TTL_MS,
    });
    state = reduceNativeTrustOnboarding(state, {
      type: "start-scan",
      now: 1_000 + NATIVE_TRUST_APPROVAL_TTL_MS,
    });
    expect(state).toMatchObject({
      stage: "waiting-for-approval",
      approvalExpiresAt: null,
      failure: "approval-expired",
    });
  });

  it("keeps the manual ceremony behind an explicit recovery transition", () => {
    const started = reduceNativeTrustOnboarding(INITIAL_NATIVE_TRUST_ONBOARDING_STATE, {
      type: "begin",
      target,
    });
    expect(started.stage).not.toBe("recovery-required");
    expect(reduceNativeTrustOnboarding(started, { type: "use-recovery" }).stage).toBe(
      "recovery-required",
    );
  });
});

describe("native approval verification", () => {
  const nodePrivateKey = new Uint8Array(32).fill(7);
  const nodeIdentityPublicKey = ed25519.getPublicKey(nodePrivateKey);
  const clientIdentityPublicKey = p256.getPublicKey(new Uint8Array(32).fill(9), false);
  const tbs = encodeCrossDeviceApprovalTbs({
    hubOrigin: target.hubOrigin,
    accountId: target.accountId,
    nodeId: target.nodeId,
    nodeIdentityPublicKey,
    clientIdentityFingerprint: e2eeKeyFingerprint("client-identity", clientIdentityPublicKey),
    maxRole: "owner",
    capabilitySet: ["ryco.rpc"],
    nodeContinuityId: `nct_${"C".repeat(22)}`,
    nodePolicyGeneration: 4,
    approvedAt: 1_000,
    approvalId: new Uint8Array(32).fill(3),
    issuedAt: 1_000,
    expiresAt: 2_000,
  });
  const payload = encodeCrossDeviceApprovalQr({
    tbs,
    signature: ed25519.sign(tbs, nodePrivateKey),
  });
  const input = {
    payload,
    hubOrigin: target.hubOrigin,
    accountId: target.accountId,
    nodeId: target.nodeId,
    nodeIdentityPublicKey,
    clientIdentityPublicKey,
    nodeContinuityId: `nct_${"C".repeat(22)}`,
    nodePolicyGeneration: 4,
    now: 1_500,
    requiredRole: "owner",
    requiredCapability: "ryco.rpc",
  } as const;

  it("accepts the exact node/account/client/origin/current-statement envelope", () => {
    expect(verifyNativeTrustApprovalQr(input)).toMatchObject({
      ok: true,
      approval: { maxRole: "owner", approvedAt: 1_000 },
    });
  });

  it("rejects wrong client, node, account, origin, role, capability, and expiry", () => {
    const rejected = [
      {
        ...input,
        clientIdentityPublicKey: p256.getPublicKey(new Uint8Array(32).fill(10), false),
      },
      { ...input, nodeId: `node_${"X".repeat(22)}` },
      { ...input, accountId: "acct_other" },
      { ...input, hubOrigin: "https://other.example.test" },
      { ...input, requiredRole: "viewer" },
      { ...input, requiredCapability: "ryco.other" },
      { ...input, now: 1_000_000 },
    ];
    for (const candidate of rejected) {
      expect(verifyNativeTrustApprovalQr(candidate)).toEqual({
        ok: false,
        failure: "approval-mismatch",
      });
    }
  });
});
