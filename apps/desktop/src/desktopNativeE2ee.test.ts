import { generateKeyPairSync, type KeyObject } from "node:crypto";

import { e2eeKeyFingerprint, generateE2eeAgreementKeyPair } from "@ryco/shared/relayE2eeKeys";
import { describe, expect, it } from "vite-plus/test";

import { createDesktopNativeE2eePlatform } from "./desktopNativeE2ee.ts";
import type { DesktopE2eePrekeyCertificate } from "./desktopE2eePrekey.ts";
import type { DesktopProtectedRecordStore } from "./protectedRecordStore.ts";

const rawP256 = (key: KeyObject) => {
  const jwk = key.export({ format: "jwk" });
  return Uint8Array.from([
    0x04,
    ...Buffer.from(jwk.x!, "base64url"),
    ...Buffer.from(jwk.y!, "base64url"),
  ]);
};

function memoryStore(): DesktopProtectedRecordStore {
  const values = new Map<string, string>();
  return {
    read: async (name) => values.get(name) ?? null,
    create: async (name, value) => {
      if (values.has(name)) return false;
      values.set(name, value);
      return true;
    },
    write: async (name, value) => void values.set(name, value),
    delete: async (name) => void values.delete(name),
  };
}

describe("Desktop native account E2EE platform", () => {
  it("keeps enrollment stable and account trust public, scoped, and monotonic", async () => {
    const origin = "https://hub.example.test";
    const accountId = `acct_${"a".repeat(22)}`;
    const nodeId = `node_${"n".repeat(22)}`;
    const records = memoryStore();
    const identity = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const identityPublicKey = rawP256(identity.publicKey);
    const agreement = generateE2eeAgreementKeyPair();
    const transcript = new Uint8Array([1, 2, 3]);
    const signature = new Uint8Array(64).fill(4);
    const prekey = {
      ensure: async () =>
        ({
          hubOrigin: origin,
          accountId,
          identityPublicKey,
          agreementPublicKey: agreement.publicKey,
          transcript,
          signature,
          createdAt: 100,
          expiresAt: 200,
        }) satisfies DesktopE2eePrekeyCertificate,
    };
    const platform = createDesktopNativeE2eePlatform({
      origin,
      installationId: `install_${"i".repeat(22)}`,
      appVersion: "1.2.3",
      deviceLabel: () => "Studio Mac",
      records,
      prekey: prekey as never,
      platform: "darwin",
      security: {
        getSigningPublicKey: async () => identityPublicKey,
        getSigningKey: async () => {
          throw new Error("not needed");
        },
        ensureAgreementPublicKey: async () => agreement.publicKey,
        withAgreementSecretKey: async (use) => use(Uint8Array.from(agreement.secretKey)),
      },
      randomBytes: (length) => new Uint8Array(length).fill(7),
    });

    expect(await platform.getOrCreateEnrollmentId()).toMatch(/^enr_[A-Za-z0-9_-]{22}$/u);
    expect(await platform.getOrCreateEnrollmentId()).toBe(await platform.getOrCreateEnrollmentId());
    await expect(platform.ensureIdentity()).resolves.toMatchObject({
      publicKey: identityPublicKey,
      backing: "secure-enclave",
    });
    await expect(
      platform.ensureClientPrekey({ hubOrigin: origin, accountId }),
    ).resolves.toMatchObject({
      agreementPublicKey: agreement.publicKey,
      expiresAt: 200,
    });

    const nodeIdentity = generateKeyPairSync("ed25519");
    const nodePublic = Uint8Array.from(
      (nodeIdentity.publicKey.export({ format: "der", type: "spki" }) as Buffer).subarray(12),
    );
    const record = {
      hubOrigin: origin,
      accountId,
      nodeId,
      identityPublicKey: nodePublic,
      identityFingerprint: e2eeKeyFingerprint("node-identity", nodePublic),
      agreementFingerprint: e2eeKeyFingerprint("agreement", agreement.publicKey),
      continuityId: `nct_${"c".repeat(22)}`,
      acceptedPolicyGeneration: 3,
      firstTrustedAt: 100,
      lastTrustedAt: 200,
      identityChanges: [],
    } as const;
    await platform.writeAccountTrustedNode(record);
    await expect(
      platform.readAccountTrustedNode({ hubOrigin: origin, accountId, nodeId }),
    ).resolves.toEqual(record);
    await expect(
      platform.writeAccountTrustedNode({
        ...record,
        acceptedPolicyGeneration: 2,
        lastTrustedAt: 300,
      }),
    ).rejects.toThrow("Desktop native E2EE platform operation failed.");
    agreement.secretKey.fill(0);
  });
});
