import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { p256 } from "@noble/curves/nist.js";
import { describe, expect, it } from "vite-plus/test";

import { E2EE_HUB_DEVICE_GRANT_MAX_BYTES } from "./relayE2eeConstants.ts";
import {
  E2EE_HUB_DEVICE_GRANT_SIGNATURE_DOMAIN,
  decodeHubDeviceGrant,
  encodeHubDeviceGrantClaims,
  encodeHubDeviceGrantEnvelope,
  encodeHubDeviceGrantSigningEnvelope,
  verifyHubDeviceGrant,
  type HubDeviceGrantClaimsInput,
  type HubDeviceGrantBindings,
  type HubDeviceGrantVerificationKey,
} from "./relayE2eeHubDeviceGrant.ts";
import { e2eeKeyFingerprint } from "./relayE2eeKeys.ts";
import { decodeCanonicalE2eeCbor, encodeCanonicalE2eeCbor } from "./relayE2eeTranscripts.ts";

const NOW = 2_000_000_000_000;
const HUB_SECRET = new Uint8Array(32).fill(1);
const OTHER_HUB_SECRET = new Uint8Array(32).fill(2);
const DEVICE_SECRET = new Uint8Array(32).fill(3);
const DEVICE_AGREEMENT_SECRET = new Uint8Array(32).fill(4);
const NODE_SECRET = new Uint8Array(32).fill(5);
const NODE_AGREEMENT_SECRET = new Uint8Array(32).fill(6);
const HUB_PUBLIC = ed25519.getPublicKey(HUB_SECRET);
const DEVICE_PUBLIC = p256.getPublicKey(DEVICE_SECRET, false);
const DEVICE_AGREEMENT_PUBLIC = x25519.getPublicKey(DEVICE_AGREEMENT_SECRET);
const NODE_PUBLIC = ed25519.getPublicKey(NODE_SECRET);
const NODE_AGREEMENT_PUBLIC = x25519.getPublicKey(NODE_AGREEMENT_SECRET);
const CERTIFICATE_DIGEST = new Uint8Array(32).fill(7);
const STATEMENT_DIGEST = new Uint8Array(32).fill(8);

const baseClaims = {
  issuerHubOrigin: "https://hub.example.test",
  keyId: `hgk_${"k".repeat(22)}`,
  grantId: `hgr_${"g".repeat(22)}`,
  accountId: `acct_${"a".repeat(22)}`,
  accountAuthEpoch: 3,
  enrollmentId: `enr_${"e".repeat(22)}`,
  enrollmentRevision: 4,
  deviceAuthEpoch: 5,
  deviceIdentityPublicKey: DEVICE_PUBLIC,
  deviceAgreementPublicKey: DEVICE_AGREEMENT_PUBLIC,
  clientPrekeyCertificateDigest: CERTIFICATE_DIGEST,
  nodeId: `node_${"n".repeat(22)}`,
  nodeIdentityPublicKey: NODE_PUBLIC,
  nodeAgreementPublicKey: NODE_AGREEMENT_PUBLIC,
  nodeContinuityId: `nct_${"c".repeat(22)}`,
  nodePolicyGeneration: 6,
  nodeCapabilityStatementDigest: STATEMENT_DIGEST,
  relayTicketId: `rtk_${"t".repeat(22)}`,
  maximumRole: "operator",
  capabilities: ["ryco.rpc"],
  issuedAt: NOW,
  notBefore: NOW - 1_000,
  expiresAt: NOW + 60_000,
  nonce: new Uint8Array(32).fill(9),
} as unknown as HubDeviceGrantClaimsInput;

const baseBindings: HubDeviceGrantBindings = {
  issuerHubOrigin: baseClaims.issuerHubOrigin,
  accountId: baseClaims.accountId,
  accountAuthEpoch: baseClaims.accountAuthEpoch,
  enrollmentId: baseClaims.enrollmentId,
  enrollmentRevision: baseClaims.enrollmentRevision,
  deviceAuthEpoch: baseClaims.deviceAuthEpoch,
  enrollmentStatus: "active",
  deviceIdentityPublicKey: DEVICE_PUBLIC,
  deviceAgreementPublicKey: DEVICE_AGREEMENT_PUBLIC,
  clientPrekeyCertificateDigest: CERTIFICATE_DIGEST,
  clientPrekeyCertificateExpiresAt: NOW + 120_000,
  nodeId: baseClaims.nodeId,
  nodeIdentityPublicKey: NODE_PUBLIC,
  nodeAgreementPublicKey: NODE_AGREEMENT_PUBLIC,
  nodeAgreementPrekeyExpiresAt: NOW + 120_000,
  nodeContinuityId: baseClaims.nodeContinuityId,
  nodePolicyGeneration: baseClaims.nodePolicyGeneration,
  nodeCapabilityStatementDigest: STATEMENT_DIGEST,
  nodeCapabilityStatementExpiresAt: NOW + 120_000,
  relayTicketId: baseClaims.relayTicketId,
  relayTicketExpiresAt: NOW + 120_000,
  effectiveRole: "operator",
  effectiveCapabilities: ["ryco.rpc"],
  accountGrantAllowed: true,
  now: NOW,
};

const baseKey: HubDeviceGrantVerificationKey = {
  keyId: baseClaims.keyId,
  publicKey: HUB_PUBLIC,
  notBefore: NOW - 60_000,
  notAfter: NOW + 120_000,
};

function signedGrant(
  claims: HubDeviceGrantClaimsInput = baseClaims,
  secret: Uint8Array = HUB_SECRET,
): { claimsBytes: Uint8Array; signature: Uint8Array; envelope: Uint8Array } {
  const claimsBytes = encodeHubDeviceGrantClaims(claims);
  const signature = ed25519.sign(encodeHubDeviceGrantSigningEnvelope(claimsBytes), secret);
  return { claimsBytes, signature, envelope: encodeHubDeviceGrantEnvelope(claimsBytes, signature) };
}

function resignArray(array: readonly unknown[]): Uint8Array {
  const claimsBytes = encodeCanonicalE2eeCbor(array);
  return encodeHubDeviceGrantEnvelope(
    claimsBytes,
    ed25519.sign(encodeHubDeviceGrantSigningEnvelope(claimsBytes), HUB_SECRET),
  );
}

function claimsArray(envelope: Uint8Array): unknown[] {
  const outer = decodeCanonicalE2eeCbor(envelope);
  if (outer.kind !== "ok" || !Array.isArray(outer.value)) throw new Error("test fixture");
  const inner = decodeCanonicalE2eeCbor(outer.value[0] as Uint8Array);
  if (inner.kind !== "ok" || !Array.isArray(inner.value)) throw new Error("test fixture");
  return [...inner.value];
}

function verify(
  overrides: {
    envelope?: Uint8Array;
    verificationKeys?: readonly HubDeviceGrantVerificationKey[];
    bindings?: HubDeviceGrantBindings;
  } = {},
) {
  return verifyHubDeviceGrant({
    envelope: overrides.envelope ?? signedGrant().envelope,
    verificationKeys: overrides.verificationKeys ?? [baseKey],
    bindings: overrides.bindings ?? baseBindings,
  });
}

describe("Hub device grant canonical encoding", () => {
  it("derives all algorithm labels and fingerprints in the fixed 35-element array", () => {
    const first = signedGrant();
    const second = signedGrant();
    expect(first.claimsBytes).toEqual(second.claimsBytes);
    const array = claimsArray(first.envelope);
    expect(array).toHaveLength(35);
    expect(array.slice(0, 3)).toEqual(["ryco.hub-device-grant-claims.v1", 1, 2]);
    expect(array[11]).toBe("p256");
    expect(array[13]).toEqual(e2eeKeyFingerprint("client-identity", DEVICE_PUBLIC));
    expect(array[14]).toBe("x25519");
    expect(array[16]).toEqual(e2eeKeyFingerprint("agreement", DEVICE_AGREEMENT_PUBLIC));
    expect(array[19]).toBe("ed25519");
    expect(array[21]).toEqual(e2eeKeyFingerprint("node-identity", NODE_PUBLIC));
    expect(array[22]).toBe("x25519");
    expect(array[24]).toEqual(e2eeKeyFingerprint("agreement", NODE_AGREEMENT_PUBLIC));
  });

  it("signs only the domain-separated digest envelope", () => {
    const { claimsBytes, signature } = signedGrant();
    const signingEnvelope = encodeHubDeviceGrantSigningEnvelope(claimsBytes);
    const decoded = decodeCanonicalE2eeCbor(signingEnvelope);
    expect(decoded).toMatchObject({ kind: "ok" });
    if (decoded.kind !== "ok" || !Array.isArray(decoded.value)) return;
    expect(decoded.value[0]).toBe(E2EE_HUB_DEVICE_GRANT_SIGNATURE_DOMAIN);
    expect(decoded.value[1]).toHaveLength(32);
    expect(ed25519.verify(signature, signingEnvelope, HUB_PUBLIC, { zip215: false })).toBe(true);
    expect(ed25519.verify(signature, claimsBytes, HUB_PUBLIC, { zip215: false })).toBe(false);
  });

  it("keeps maximum-width conforming identifiers below the 2,048-byte envelope bound", () => {
    const max = signedGrant({
      ...baseClaims,
      keyId: `hgk_${"k".repeat(43)}`,
      grantId: `hgr_${"g".repeat(43)}`,
      accountId: `acct_${"a".repeat(43)}`,
      enrollmentId: `enr_${"e".repeat(43)}`,
      nodeId: `node_${"n".repeat(43)}`,
      relayTicketId: `rtk_${"t".repeat(43)}`,
    } as HubDeviceGrantClaimsInput);
    expect(max.envelope.byteLength).toBeLessThanOrEqual(E2EE_HUB_DEVICE_GRANT_MAX_BYTES);
  });
});

describe("Hub device grant decoding", () => {
  it("strict-decodes a valid grant and exposes only public verified structure", () => {
    const result = decodeHubDeviceGrant(signedGrant().envelope);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.claims.relayTicketId).toBe(baseClaims.relayTicketId);
      expect(result.grantDigest).toHaveLength(32);
    }
  });

  it("rejects one byte over the hard limit before attempting CBOR", () => {
    expect(decodeHubDeviceGrant(new Uint8Array(E2EE_HUB_DEVICE_GRANT_MAX_BYTES + 1))).toEqual({
      kind: "error",
      reason: "grant_oversize",
    });
  });

  it("separates malformed, non-canonical, and unsupported-version failures", () => {
    expect(decodeHubDeviceGrant(new Uint8Array([0xff]))).toEqual({
      kind: "error",
      reason: "grant_malformed",
    });
    const canonical = signedGrant().envelope;
    const nonCanonical = new Uint8Array(canonical.byteLength + 1);
    nonCanonical.set([0x98, 0x02]);
    nonCanonical.set(canonical.subarray(1), 2);
    expect(decodeHubDeviceGrant(nonCanonical)).toEqual({
      kind: "error",
      reason: "grant_non_canonical",
    });
    const version = claimsArray(canonical);
    version[1] = 2;
    expect(decodeHubDeviceGrant(resignArray(version))).toEqual({
      kind: "error",
      reason: "grant_version",
    });
  });

  it("rejects wrong array shapes and carried fingerprints", () => {
    const short = claimsArray(signedGrant().envelope).slice(0, 34);
    expect(decodeHubDeviceGrant(resignArray(short))).toEqual({
      kind: "error",
      reason: "grant_malformed",
    });
    const fingerprint = claimsArray(signedGrant().envelope);
    fingerprint[13] = new Uint8Array(32).fill(0xaa);
    expect(decodeHubDeviceGrant(resignArray(fingerprint))).toEqual({
      kind: "error",
      reason: "grant_binding",
    });
  });
});

describe("Hub device grant verification", () => {
  it("accepts a fully bound grant", () => {
    expect(verify().kind).toBe("ok");
  });

  it("rejects wrong and cross-domain signatures", () => {
    expect(verify({ envelope: signedGrant(baseClaims, OTHER_HUB_SECRET).envelope })).toEqual({
      kind: "error",
      reason: "grant_signature",
    });
    const claims = encodeHubDeviceGrantClaims(baseClaims);
    const crossDomain = encodeHubDeviceGrantEnvelope(claims, ed25519.sign(claims, HUB_SECRET));
    expect(verify({ envelope: crossDomain })).toEqual({
      kind: "error",
      reason: "grant_signature",
    });
  });

  it("fails closed for unknown, duplicate, malformed, and non-overlapping keysets", () => {
    const unknown = { ...baseKey, keyId: `hgk_${"x".repeat(22)}` };
    expect(verify({ verificationKeys: [unknown] })).toMatchObject({ reason: "grant_unknown_key" });
    expect(verify({ verificationKeys: [baseKey, baseKey] })).toMatchObject({
      reason: "grant_unknown_key",
    });
    expect(
      verify({ verificationKeys: [{ ...baseKey, publicKey: new Uint8Array(31) }] }),
    ).toMatchObject({ reason: "grant_unknown_key" });
    expect(
      verify({ verificationKeys: [{ ...baseKey, notAfter: baseClaims.expiresAt - 1 }] }),
    ).toMatchObject({ reason: "grant_unknown_key" });
  });

  it("permits only early skew and never post-expiry skew", () => {
    expect(
      verify({ bindings: { ...baseBindings, now: baseClaims.notBefore - 30_000 } }),
    ).toMatchObject({ kind: "ok" });
    expect(verify({ bindings: { ...baseBindings, now: baseClaims.notBefore - 30_001 } })).toEqual({
      kind: "error",
      reason: "grant_not_yet_valid",
    });
    expect(verify({ bindings: { ...baseBindings, now: baseClaims.expiresAt } })).toMatchObject({
      kind: "ok",
    });
    expect(verify({ bindings: { ...baseBindings, now: baseClaims.expiresAt + 1 } })).toEqual({
      kind: "error",
      reason: "grant_expired",
    });
  });

  it("checks every caller-owned identity and authorization binding", () => {
    const otherBytes = new Uint8Array(32).fill(0xee);
    const otherDevice = p256.getPublicKey(new Uint8Array(32).fill(10), false);
    const cases: HubDeviceGrantBindings[] = [
      { ...baseBindings, issuerHubOrigin: "https://other.example.test" },
      { ...baseBindings, accountId: `acct_${"z".repeat(22)}` },
      { ...baseBindings, accountAuthEpoch: 4 },
      { ...baseBindings, enrollmentId: `enr_${"z".repeat(22)}` },
      { ...baseBindings, enrollmentRevision: 5 },
      { ...baseBindings, deviceAuthEpoch: 6 },
      { ...baseBindings, deviceIdentityPublicKey: otherDevice },
      { ...baseBindings, deviceAgreementPublicKey: otherBytes },
      { ...baseBindings, clientPrekeyCertificateDigest: otherBytes },
      { ...baseBindings, nodeId: `node_${"z".repeat(22)}` },
      { ...baseBindings, nodeIdentityPublicKey: ed25519.getPublicKey(OTHER_HUB_SECRET) },
      { ...baseBindings, nodeAgreementPublicKey: otherBytes },
      { ...baseBindings, nodeContinuityId: `nct_${"z".repeat(22)}` },
      { ...baseBindings, nodePolicyGeneration: 7 },
      { ...baseBindings, nodeCapabilityStatementDigest: otherBytes },
      { ...baseBindings, relayTicketId: `rtk_${"z".repeat(22)}` },
    ];
    for (const bindings of cases) {
      expect(verify({ bindings })).toEqual({ kind: "error", reason: "grant_binding" });
    }
  });

  it("requires every named carrier to outlive the grant", () => {
    for (const bindings of [
      { ...baseBindings, relayTicketExpiresAt: baseClaims.expiresAt - 1 },
      { ...baseBindings, clientPrekeyCertificateExpiresAt: baseClaims.expiresAt - 1 },
      { ...baseBindings, nodeCapabilityStatementExpiresAt: baseClaims.expiresAt - 1 },
      { ...baseBindings, nodeAgreementPrekeyExpiresAt: baseClaims.expiresAt - 1 },
    ]) {
      expect(verify({ bindings })).toEqual({ kind: "error", reason: "grant_binding" });
    }
  });

  it("distinguishes revocation and policy/authority withdrawal", () => {
    expect(verify({ bindings: { ...baseBindings, enrollmentStatus: "revoked" } })).toEqual({
      kind: "error",
      reason: "grant_revoked",
    });
    expect(verify({ bindings: { ...baseBindings, accountGrantAllowed: false } })).toEqual({
      kind: "error",
      reason: "grant_policy",
    });
    expect(verify({ bindings: { ...baseBindings, effectiveRole: "owner" } })).toEqual({
      kind: "error",
      reason: "grant_policy",
    });
    expect(
      verify({
        bindings: {
          ...baseBindings,
          effectiveCapabilities: ["ryco.rpc", "ryco.rpc"],
        },
      }),
    ).toEqual({ kind: "error", reason: "grant_policy" });
  });

  it("returns closed, input-free failures", () => {
    const result = verify({ envelope: signedGrant(baseClaims, OTHER_HUB_SECRET).envelope });
    expect(Object.keys(result).toSorted()).toEqual(["kind", "reason"]);
    expect(JSON.stringify(result)).not.toContain(baseClaims.accountId);
    expect(JSON.stringify(result)).not.toContain(baseClaims.relayTicketId);
  });
});
