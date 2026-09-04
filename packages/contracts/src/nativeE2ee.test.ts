import { Schema } from "effect";
import { describe, expect, it } from "vite-plus/test";

import {
  ACCOUNT_E2EE_DEVICE_PATH_PREFIX,
  ACCOUNT_E2EE_DEVICES_PATH,
  AccountE2eeDeviceListResponse,
  AccountE2eeDeviceRenameRequest,
  AccountE2eeDeviceRevokeRequest,
  HubDeviceGrantClaims,
  HubGrantVerificationKeysetResponse,
  NATIVE_ACCOUNT_GRANT_RELAY_TICKET_PATH,
  NATIVE_E2EE_CURRENT_DEVICE_PATH,
  NATIVE_E2EE_GRANT_KEYS_PATH,
  NativeAccountGrantRelayTicketRequest,
  NativeAccountGrantRelayTicketResponse,
  NativeE2eeEnrollmentUpsertRequest,
  NativeE2eeEnrollmentUpsertResponse,
} from "./nativeE2ee.ts";

const now = 1_788_451_200_000;
const digest = new Uint8Array(32).fill(1);
const otherDigest = new Uint8Array(32).fill(2);
const p256 = Uint8Array.from([4, ...new Uint8Array(64).fill(3)]);
const x25519 = new Uint8Array(32).fill(4);
const ed25519 = new Uint8Array(32).fill(5);
const opaque = "A".repeat(43);

const decode = <S extends Schema.Top>(schema: S, value: unknown): S["Type"] =>
  Schema.decodeUnknownSync(schema as unknown as Schema.Decoder<unknown>)(value, {
    onExcessProperty: "error",
  }) as S["Type"];

const enrollmentRequest = {
  protocolVersion: 1,
  hubOrigin: "https://hub.example.test",
  accountId: `acct_${"a".repeat(22)}`,
  enrollmentId: `enr_${"e".repeat(22)}`,
  expectedEnrollmentRevision: 1,
  identityPublicKey: "B".repeat(87),
  identityFingerprint: opaque,
  agreementPublicKey: opaque,
  agreementFingerprint: opaque,
  clientPrekeyCertificate: "C".repeat(120),
  clientPrekeyCertificateDigest: opaque,
  certificateExpiresAt: now + 86_400_000,
  platform: "darwin",
  appVersion: "0.1.20",
  reportedKeyBacking: "secure-enclave",
  deviceLabel: "Laurin's Mac",
  requestedMaximumRole: "owner",
  requestedCapabilities: ["ryco.rpc"],
  enrollmentNonce: opaque,
  idempotencyKey: opaque,
} as const;

const enrollmentSummary = {
  enrollmentId: enrollmentRequest.enrollmentId,
  enrollmentRevision: 1,
  accountAuthEpoch: 3,
  deviceAuthEpoch: 2,
  platform: enrollmentRequest.platform,
  appVersion: enrollmentRequest.appVersion,
  reportedKeyBacking: enrollmentRequest.reportedKeyBacking,
  deviceLabel: enrollmentRequest.deviceLabel,
  identityFingerprint: opaque,
  agreementFingerprint: opaque,
  clientPrekeyCertificateDigest: opaque,
  certificateExpiresAt: enrollmentRequest.certificateExpiresAt,
  status: "active",
  createdAt: now,
  updatedAt: now,
  lastUsedAt: null,
  revokedAt: null,
} as const;

describe("native E2EE account contracts", () => {
  it("pins the public route vocabulary", () => {
    expect({
      ACCOUNT_E2EE_DEVICE_PATH_PREFIX,
      ACCOUNT_E2EE_DEVICES_PATH,
      NATIVE_ACCOUNT_GRANT_RELAY_TICKET_PATH,
      NATIVE_E2EE_CURRENT_DEVICE_PATH,
      NATIVE_E2EE_GRANT_KEYS_PATH,
    }).toEqual({
      ACCOUNT_E2EE_DEVICE_PATH_PREFIX: "/api/account/e2ee/devices",
      ACCOUNT_E2EE_DEVICES_PATH: "/api/account/e2ee/devices",
      NATIVE_ACCOUNT_GRANT_RELAY_TICKET_PATH: "/api/native/relay/tickets/account-grant",
      NATIVE_E2EE_CURRENT_DEVICE_PATH: "/api/native/e2ee/devices/current",
      NATIVE_E2EE_GRANT_KEYS_PATH: "/api/native/e2ee/grant-keys",
    });
  });

  it("strictly decodes enrollment upsert and result", () => {
    expect(decode(NativeE2eeEnrollmentUpsertRequest, enrollmentRequest)).toEqual(enrollmentRequest);
    const { expectedEnrollmentRevision: _revision, ...freshEnrollmentRequest } = enrollmentRequest;
    expect(decode(NativeE2eeEnrollmentUpsertRequest, freshEnrollmentRequest)).toEqual(
      freshEnrollmentRequest,
    );
    expect(
      decode(NativeE2eeEnrollmentUpsertResponse, {
        protocolVersion: 1,
        enrollment: enrollmentSummary,
      }),
    ).toEqual({ protocolVersion: 1, enrollment: enrollmentSummary });

    expect(() =>
      decode(NativeE2eeEnrollmentUpsertRequest, { ...enrollmentRequest, secretKey: opaque }),
    ).toThrow();
    expect(() =>
      decode(NativeE2eeEnrollmentUpsertRequest, {
        ...enrollmentRequest,
        requestedCapabilities: ["ryco.rpc", "ryco.rpc"],
      }),
    ).toThrow();
    expect(() =>
      decode(NativeE2eeEnrollmentUpsertRequest, {
        ...enrollmentRequest,
        agreementPublicKey: "x",
      }),
    ).toThrow();
  });

  it("bounds account device management", () => {
    expect(
      decode(AccountE2eeDeviceListResponse, {
        protocolVersion: 1,
        devices: [enrollmentSummary],
      }).devices,
    ).toHaveLength(1);
    expect(
      decode(AccountE2eeDeviceRenameRequest, {
        expectedEnrollmentRevision: 1,
        deviceLabel: "Phone",
      }),
    ).toEqual({ expectedEnrollmentRevision: 1, deviceLabel: "Phone" });
    expect(
      decode(AccountE2eeDeviceRevokeRequest, {
        expectedEnrollmentRevision: 1,
        reasonCode: "owner_requested",
      }),
    ).toEqual({ expectedEnrollmentRevision: 1, reasonCode: "owner_requested" });
    expect(() =>
      decode(AccountE2eeDeviceRenameRequest, {
        expectedEnrollmentRevision: 1,
        deviceLabel: "x".repeat(101),
      }),
    ).toThrow();
  });

  it("strictly decodes bounded Hub verification keysets", () => {
    expect(
      decode(HubGrantVerificationKeysetResponse, {
        protocolVersion: 1,
        generation: 7,
        keys: [
          {
            keyId: `hgk_${"k".repeat(22)}`,
            publicKey: opaque,
            notBefore: now - 1_000,
            notAfter: now + 60_000,
          },
        ],
      }).generation,
    ).toBe(7);
    expect(() =>
      decode(HubGrantVerificationKeysetResponse, {
        protocolVersion: 1,
        generation: 7,
        keys: Array.from({ length: 5 }, (_, index) => ({
          keyId: `hgk_${String(index).repeat(22)}`,
          publicKey: opaque,
          notBefore: now,
          notAfter: now + 1,
        })),
      }),
    ).toThrow();
  });

  it("keeps native grant tickets distinct from browser tickets", () => {
    const request = {
      protocolVersion: 1,
      nodeId: `node_${"n".repeat(22)}`,
      capability: "ryco.rpc",
      protocolMajor: 1,
      protocolMinor: 3,
      suiteId: 2,
      enrollmentId: enrollmentRequest.enrollmentId,
      enrollmentRevision: 1,
      clientPrekeyCertificateDigest: opaque,
    } as const;
    expect(decode(NativeAccountGrantRelayTicketRequest, request)).toEqual(request);

    const response = {
      protocolVersion: 1,
      ticket: opaque,
      ticketId: `rtk_${"t".repeat(22)}`,
      expiresAt: now + 60_000,
      protocolMajor: 1,
      protocolMinor: 3,
      suiteId: 2,
      deviceGrant: "G".repeat(200),
      deviceGrantDigest: opaque,
      nodeCapabilityStatement: "S".repeat(200),
      nodeCapabilityStatementDigest: opaque,
      keysetGeneration: 7,
      capability: "ryco.rpc",
      effectiveRole: "operator",
    } as const;
    expect(decode(NativeAccountGrantRelayTicketResponse, response)).toEqual(response);
    expect(() =>
      decode(NativeAccountGrantRelayTicketResponse, { ...response, protocolMinor: 2 }),
    ).toThrow();
  });

  it("models the exact semantic grant claims without accepting extra fields", () => {
    const claims = {
      version: 1,
      suiteId: 2,
      issuerHubOrigin: "https://hub.example.test",
      keyId: `hgk_${"k".repeat(22)}`,
      grantId: `hgr_${"g".repeat(22)}`,
      accountId: `acct_${"a".repeat(22)}`,
      accountAuthEpoch: 3,
      enrollmentId: enrollmentRequest.enrollmentId,
      enrollmentRevision: 1,
      deviceAuthEpoch: 2,
      deviceIdentityAlgorithm: "p256",
      deviceIdentityPublicKey: p256,
      deviceIdentityFingerprint: digest,
      deviceAgreementAlgorithm: "x25519",
      deviceAgreementPublicKey: x25519,
      deviceAgreementFingerprint: digest,
      clientPrekeyCertificateDigest: otherDigest,
      nodeId: `node_${"n".repeat(22)}`,
      nodeIdentityAlgorithm: "ed25519",
      nodeIdentityPublicKey: ed25519,
      nodeIdentityFingerprint: digest,
      nodeAgreementAlgorithm: "x25519",
      nodeAgreementPublicKey: x25519,
      nodeAgreementFingerprint: otherDigest,
      nodeContinuityId: `cont_${"c".repeat(22)}`,
      nodePolicyGeneration: 4,
      nodeCapabilityStatementDigest: digest,
      relayTicketId: `rtk_${"t".repeat(22)}`,
      maximumRole: "operator",
      capabilities: ["ryco.rpc"],
      issuedAt: now,
      notBefore: now,
      expiresAt: now + 60_000,
      nonce: new Uint8Array(32).fill(9),
    } as const;
    expect(decode(HubDeviceGrantClaims, claims)).toEqual(claims);
    expect(() => decode(HubDeviceGrantClaims, { ...claims, plaintext: "no" })).toThrow();
    expect(() => decode(HubDeviceGrantClaims, { ...claims, suiteId: 1 })).toThrow();
    expect(() => decode(HubDeviceGrantClaims, { ...claims, expiresAt: now + 120_001 })).toThrow();
  });
});
