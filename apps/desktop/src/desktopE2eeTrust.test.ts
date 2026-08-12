import { generateKeyPairSync, type KeyObject } from "node:crypto";

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
});
