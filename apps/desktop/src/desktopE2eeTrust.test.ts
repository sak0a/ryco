import { generateKeyPairSync, type KeyObject } from "node:crypto";

import type { NodeE2eeCapabilityVerification } from "@ryco/shared/relayE2eeCapabilityVerify";
import { e2eeKeyFingerprint } from "@ryco/shared/relayE2eeKeys";
import { E2EE_SUITE_25519_CHACHAPOLY_SHA256 } from "@ryco/shared/relayE2eeWire";
import type { DesktopProtectedRecordStore } from "./protectedRecordStore.ts";
import { DesktopE2eeTrustStore } from "./desktopE2eeTrust.ts";
import { describe, expect, it } from "vite-plus/test";

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
  readonly records: Map<string, string>;
  readonly store: DesktopProtectedRecordStore;
} {
  const records = new Map<string, string>();
  return {
    records,
    store: {
      read: async (name) => records.get(name) ?? null,
      create: async (name, value) => {
        if (records.has(name)) return false;
        records.set(name, value);
        return true;
      },
      write: async (name, value) => {
        records.set(name, value);
      },
      delete: async (name) => {
        records.delete(name);
      },
    },
  };
}

const nodeIdentityPublicKey = rawEd25519(generateKeyPairSync("ed25519").publicKey);
const otherNodeIdentityPublicKey = rawEd25519(generateKeyPairSync("ed25519").publicKey);
const clientIdentityPublicKey = rawP256(
  generateKeyPairSync("ec", { namedCurve: "prime256v1" }).publicKey,
);
const promotion = {
  hubOrigin: "https://hub.example.test",
  accountId: `acct_${"A".repeat(22)}`,
  nodeId: `node_${"B".repeat(22)}`,
  environmentId: `env_${"C".repeat(22)}`,
  nodeIdentityPublicKey,
  nodeContinuityId: `nct_${"D".repeat(22)}`,
  nodePolicyGeneration: 7,
  clientIdentityPublicKey,
  approvedAt: 1_800_000_000_000,
  randomHandle: () => "E".repeat(22),
} as const;

describe("Desktop E2EE trust store", () => {
  it("atomically writes the verified pin and origin marker and replays exactly", async () => {
    const memory = memoryStore();
    const trust = new DesktopE2eeTrustStore(memory.store);
    const first = await trust.promoteLocal(promotion);
    expect(first).toMatchObject({
      localNodeHandle: "E".repeat(22),
      verificationMethod: "local-trusted-introduction-v1",
      acceptedPolicyGeneration: 7,
    });
    const document = JSON.parse(memory.records.get("e2ee-trust")!) as {
      readonly records: readonly unknown[];
      readonly verifiedMarkerOrigins: readonly string[];
    };
    expect(document.records).toHaveLength(1);
    expect(document.verifiedMarkerOrigins).toEqual([promotion.hubOrigin]);

    await expect(trust.promoteLocal(promotion)).resolves.toEqual(first);
    await expect(
      trust.read(promotion.hubOrigin, promotion.accountId, promotion.nodeId),
    ).resolves.toEqual(first);
    expect(JSON.parse(memory.records.get("e2ee-trust")!).records).toHaveLength(1);
  });

  it("refuses a conflicting node key without replacing durable trust", async () => {
    const memory = memoryStore();
    const trust = new DesktopE2eeTrustStore(memory.store);
    await trust.promoteLocal(promotion);
    const before = memory.records.get("e2ee-trust");
    await expect(
      trust.promoteLocal({ ...promotion, nodeIdentityPublicKey: otherNodeIdentityPublicKey }),
    ).rejects.toMatchObject({ code: "trust_conflict" });
    expect(memory.records.get("e2ee-trust")).toBe(before);
  });

  it("advances only the authenticated statement policy for the exact durable pin", async () => {
    const memory = memoryStore();
    const trust = new DesktopE2eeTrustStore(memory.store);
    const pin = await trust.promoteLocal(promotion);
    const verification = {
      kind: "verified",
      anchor: "pin-unchanged",
      selectedSuite: E2EE_SUITE_25519_CHACHAPOLY_SHA256,
      statement: {
        transcript: Uint8Array.of(1),
        signature: Uint8Array.of(2),
        hubOrigin: promotion.hubOrigin,
        nodeId: promotion.nodeId,
        identityKeyId: `nkey_${"F".repeat(22)}`,
        identityPublicKey: promotion.nodeIdentityPublicKey,
        identityFingerprint: e2eeKeyFingerprint("node-identity", promotion.nodeIdentityPublicKey),
        e2eeVersionMin: 1,
        e2eeVersionMax: 1,
        suiteRegistry: [E2EE_SUITE_25519_CHACHAPOLY_SHA256],
        prekeyCertificate: {
          prekeyId: `epk_${"G".repeat(22)}`,
          agreementPublicKey: new Uint8Array(32),
          agreementFingerprint: new Uint8Array(32),
          crossSignature: new Uint8Array(64),
          createdAt: promotion.approvedAt,
          expiresAt: promotion.approvedAt + 60_000,
        },
        continuityChain: [],
        requireE2EE: true,
        requireApprovedClientE2EE: true,
        admittedPatterns: ["IK"],
        policyGeneration: 9,
        issuedAt: promotion.approvedAt,
        expiresAt: promotion.approvedAt + 60_000,
        continuityId: promotion.nodeContinuityId,
      },
    } satisfies Extract<NodeE2eeCapabilityVerification, { readonly kind: "verified" }>;

    await expect(
      trust.recordAuthenticatedStatement({
        hubOrigin: promotion.hubOrigin,
        accountId: promotion.accountId,
        nodeId: promotion.nodeId,
        localNodeHandle: pin.localNodeHandle,
        verification,
      }),
    ).resolves.toMatchObject({ acceptedPolicyGeneration: 9 });
    await expect(trust.hasVerifiedOrigin(promotion.hubOrigin)).resolves.toBe(true);

    await expect(
      trust.recordAuthenticatedStatement({
        hubOrigin: promotion.hubOrigin,
        accountId: promotion.accountId,
        nodeId: promotion.nodeId,
        localNodeHandle: "H".repeat(22),
        verification,
      }),
    ).rejects.toMatchObject({ code: "trust_conflict" });
  });
});
