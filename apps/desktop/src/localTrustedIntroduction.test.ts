import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";

import { encodeBase64Url, uncompressedPointToJwk } from "@ryco/client-runtime/relay";
import type {
  NativeNodeClaimFinishResponse,
  NativeNodeClaimStartResponse,
} from "@ryco/contracts/hosted-identity";
import {
  decodeLocalIntroductionRequestTbs,
  encodeLocalIntroductionApprovalTbs,
} from "@ryco/shared/relayE2eeLocalIntroduction";
import {
  e2eeKeyFingerprint,
  formatE2eeKeyFingerprint,
  generateE2eeAgreementKeyPair,
} from "@ryco/shared/relayE2eeKeys";
import { describe, expect, it, vi } from "vite-plus/test";

import type { DesktopHubControlClient } from "./desktopHubControl.ts";
import { DesktopE2eeTrustStore } from "./desktopE2eeTrust.ts";
import {
  runDesktopLocalTrustedIntroduction,
  type DesktopLocalIntroductionSecurity,
} from "./localTrustedIntroduction.ts";
import type { DesktopProtectedRecordStore } from "./protectedRecordStore.ts";

const rawEd25519 = (key: KeyObject) =>
  Uint8Array.from((key.export({ format: "der", type: "spki" }) as Buffer).subarray(12));
const rawP256 = (key: KeyObject) => {
  const jwk = key.export({ format: "jwk" });
  return Uint8Array.from([
    0x04,
    ...Buffer.from(jwk.x!, "base64url"),
    ...Buffer.from(jwk.y!, "base64url"),
  ]);
};

function memoryStore(): {
  readonly values: Map<string, string>;
  readonly store: DesktopProtectedRecordStore;
} {
  const values = new Map<string, string>();
  return {
    values,
    store: {
      read: async (name) => values.get(name) ?? null,
      create: async (name, value) => {
        if (values.has(name)) return false;
        values.set(name, value);
        return true;
      },
      write: async (name, value) => {
        values.set(name, value);
      },
      delete: async (name) => {
        values.delete(name);
      },
    },
  };
}

const nodeKeys = generateKeyPairSync("ed25519");
const clientKeys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const nodePublic = rawEd25519(nodeKeys.publicKey);
const clientPublic = rawP256(clientKeys.publicKey);
const agreement = generateE2eeAgreementKeyPair();
const agreementPublic = agreement.publicKey;
agreement.secretKey.fill(0);
const hubOrigin = "https://hub.example.test";
const environmentId = `env_${"A".repeat(22)}`;
const nodeId = `node_${"B".repeat(22)}`;
const fingerprint = formatE2eeKeyFingerprint(e2eeKeyFingerprint("node-identity", nodePublic));
const claim = {
  protocolVersion: 1,
  transcriptVersion: 1,
  claimId: `nclaim_${"C".repeat(22)}`,
  challenge: "A".repeat(43),
  accountId: `acct_${"D".repeat(22)}`,
  spaceId: `space_${"E".repeat(22)}`,
  sessionId: `sess_${"F".repeat(22)}`,
  dpopKeyThumbprint: "A".repeat(43),
  installationId: `install_${"G".repeat(22)}`,
  environmentId,
  nodeFingerprint: fingerprint,
  issuedAt: 1_800_000_000_000,
  expiresAt: 1_800_000_300_000,
} as unknown as NativeNodeClaimStartResponse;
const result = {
  status: "claimed",
  disposition: "created",
  node: {
    id: nodeId,
    activeKeyId: `nkey_${"H".repeat(22)}`,
    environmentId,
    label: "Ada's Mac",
    fingerprint,
    effectiveRole: "owner",
  },
} as unknown as NativeNodeClaimFinishResponse;
const nodeClaimDescriptor = {
  protocolVersion: 1,
  state: "active",
  hubOrigin,
  environmentId,
  label: result.node.label,
  platformOs: "darwin",
  platformArch: "arm64",
  clientVersion: "0.1.8",
  algorithm: "ed25519",
  publicKey: encodeBase64Url(nodePublic),
  fingerprint,
} as const;
const localDescriptor = {
  protocolVersion: 1,
  hubOrigin,
  environmentId,
  nodeId,
  nodeIdentityPublicKey: encodeBase64Url(nodePublic),
  nodeIdentityFingerprint: encodeBase64Url(e2eeKeyFingerprint("node-identity", nodePublic)),
  nodeContinuityId: `nct_${"I".repeat(22)}`,
  nodePolicyGeneration: 7,
} as const;

function security(): DesktopLocalIntroductionSecurity {
  return {
    getSigningPublicKey: async () => clientPublic,
    getSigningKey: async () => ({
      algorithm: "ES256",
      publicJwk: uncompressedPointToJwk(clientPublic),
      sign: async (payload) =>
        Uint8Array.from(
          sign("sha256", payload, { key: clientKeys.privateKey, dsaEncoding: "ieee-p1363" }),
        ),
    }),
    ensureAgreementPublicKey: async () => agreementPublic,
  };
}

function control(
  complete: DesktopHubControlClient["completeLocalIntroduction"],
): DesktopHubControlClient {
  return {
    nodeClaimDescriptor: async () => nodeClaimDescriptor,
    localIntroductionDescriptor: async () => localDescriptor,
    completeLocalIntroduction: complete,
  } as unknown as DesktopHubControlClient;
}

function approval(request: Parameters<DesktopHubControlClient["completeLocalIntroduction"]>[0]) {
  const requestTbs = Uint8Array.from(Buffer.from(request.requestTbs, "base64url"));
  const decoded = decodeLocalIntroductionRequestTbs(requestTbs);
  const approvalTbs = encodeLocalIntroductionApprovalTbs({
    requestTbs,
    approvedAt: decoded.issuedAt + 1,
  });
  return {
    protocolVersion: 1 as const,
    disposition: "created" as const,
    approvalTbs: encodeBase64Url(approvalTbs),
    approvalSignature: encodeBase64Url(
      Uint8Array.from(sign(null, approvalTbs, nodeKeys.privateKey)),
    ),
  };
}

describe("Desktop Local Trusted Introduction", () => {
  it("mutually verifies the child and atomically promotes native trust", async () => {
    const records = memoryStore();
    const complete = vi.fn(async (request) => approval(request));
    const pin = await runDesktopLocalTrustedIntroduction({
      control: control(complete),
      security: security(),
      records: records.store,
      trust: new DesktopE2eeTrustStore(records.store),
      installationId: claim.installationId,
      expectedHubOrigin: hubOrigin,
      claim,
      result,
      now: () => claim.issuedAt,
      randomBytes: (length) => new Uint8Array(length).fill(0x42),
    });
    expect(pin).toMatchObject({
      hubOrigin,
      accountId: claim.accountId,
      nodeId,
      verificationMethod: "local-trusted-introduction-v1",
    });
    expect(records.values.has("pending-introduction")).toBe(false);
    expect(records.values.has("e2ee-trust")).toBe(true);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("keeps the exact signed request across a lost response and replays it", async () => {
    const records = memoryStore();
    const complete = vi
      .fn<DesktopHubControlClient["completeLocalIntroduction"]>()
      .mockRejectedValueOnce(new Error("lost"))
      .mockImplementationOnce(async (request) => approval(request));
    const input = {
      control: control(complete),
      security: security(),
      records: records.store,
      trust: new DesktopE2eeTrustStore(records.store),
      installationId: claim.installationId,
      expectedHubOrigin: hubOrigin,
      claim,
      result,
      now: () => claim.issuedAt,
      randomBytes: (length: number) => new Uint8Array(length).fill(0x43),
    };
    await expect(runDesktopLocalTrustedIntroduction(input)).rejects.toMatchObject({
      code: "local_introduction_unavailable",
    });
    const pending = records.values.get("pending-introduction");
    expect(pending).toBeTruthy();
    await expect(runDesktopLocalTrustedIntroduction(input)).resolves.toMatchObject({ nodeId });
    expect(complete.mock.calls[1]?.[0]).toEqual(complete.mock.calls[0]?.[0]);
    expect(records.values.has("pending-introduction")).toBe(false);
  });
});
