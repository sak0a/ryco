import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";

import { derSignatureToRaw, uncompressedPointToJwk } from "@ryco/client-runtime/relay";
import { E2eeNodeHandshake } from "@ryco/shared/relayE2eeHandshake";
import { e2eeKeyFingerprint, generateE2eeAgreementKeyPair } from "@ryco/shared/relayE2eeKeys";
import { eraseE2eeSessionSecrets } from "@ryco/shared/relayE2eeSession";
import {
  encodeCanonicalE2eeCbor,
  encodeNodeE2eeCapabilitySigningEnvelope,
  encodeNodeE2eeCapabilityTranscript,
  encodeNodeE2eePrekeyTranscript,
} from "@ryco/shared/relayE2eeTranscripts";
import { E2EE_SUITE_25519_CHACHAPOLY_SHA256 } from "@ryco/shared/relayE2eeWire";
import { describe, expect, it } from "vite-plus/test";

import { DesktopE2eeTrustStore } from "./desktopE2eeTrust.ts";
import {
  DesktopNativeE2eeHandshakeError,
  DesktopNativeE2eeHandshakeService,
} from "./desktopNativeE2eeHandshake.ts";
import type { DesktopHostedIdentityStatus } from "./desktopHostedIdentity.ts";
import type { DesktopProtectedRecordStore } from "./protectedRecordStore.ts";

const rawP256 = (key: KeyObject) => {
  const jwk = key.export({ format: "jwk" });
  return Uint8Array.from([
    0x04,
    ...Buffer.from(jwk.x!, "base64url"),
    ...Buffer.from(jwk.y!, "base64url"),
  ]);
};

const rawEd25519 = (key: KeyObject) =>
  Uint8Array.from((key.export({ format: "der", type: "spki" }) as Buffer).subarray(12));

function memoryStore(): DesktopProtectedRecordStore {
  const values = new Map<string, string>();
  return {
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
  };
}

describe("Desktop native E2EE handshake service", () => {
  it("prepares only the exact introduced node and rejects unverified statements", async () => {
    const origin = "https://hub.example.test";
    const accountId = `acct_${"A".repeat(22)}`;
    const nodeId = `node_${"B".repeat(22)}`;
    const records = memoryStore();
    const trust = new DesktopE2eeTrustStore(records);
    const nodeKeys = generateKeyPairSync("ed25519");
    const clientKeys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const clientPublic = rawP256(clientKeys.publicKey);
    const agreement = generateE2eeAgreementKeyPair();
    const nodeAgreement = generateE2eeAgreementKeyPair();
    const pin = await trust.promoteLocal({
      hubOrigin: origin,
      accountId,
      nodeId,
      environmentId: `env_${"C".repeat(22)}`,
      nodeIdentityPublicKey: rawEd25519(nodeKeys.publicKey),
      nodeContinuityId: `nct_${"D".repeat(22)}`,
      nodePolicyGeneration: 1,
      clientIdentityPublicKey: clientPublic,
      approvedAt: 1_800_000_000_000,
      randomHandle: () => "E".repeat(22),
    });
    let identity: DesktopHostedIdentityStatus = {
      status: "ready",
      accountId,
      nodeId,
      localNodeHandle: pin.localNodeHandle,
    };
    let borrowCount = 0;
    const borrow = async <A>(use: (secret: Uint8Array) => Promise<A> | A): Promise<A> => {
      borrowCount += 1;
      const copy = Uint8Array.from(agreement.secretKey);
      try {
        return await use(copy);
      } finally {
        copy.fill(0);
      }
    };
    const service = new DesktopNativeE2eeHandshakeService({
      origin,
      records,
      trust,
      identityStatus: () => identity,
      now: () => 1_800_000_100_000,
      security: {
        getSigningPublicKey: async () => clientPublic,
        getSigningKey: async () => ({
          algorithm: "ES256",
          publicJwk: uncompressedPointToJwk(clientPublic),
          sign: async (message) =>
            derSignatureToRaw(Uint8Array.from(sign("sha256", message, clientKeys.privateKey))),
        }),
        ensureAgreementPublicKey: async () => agreement.publicKey,
        withAgreementSecretKey: borrow,
      },
    });

    const prepared = await service.prepare({ accountId, nodeId });
    expect(prepared).toMatchObject({
      kind: "native",
      acceptedPolicyGeneration: 1,
      credentials: { tier: "native", accountId },
    });
    if (prepared.kind !== "native") throw new Error("Expected a native preparation.");
    expect(prepared.verifiedPin.identityFingerprint).toEqual(
      e2eeKeyFingerprint("node-identity", rawEd25519(nodeKeys.publicKey)),
    );
    await expect(service.prepare({ accountId, nodeId })).resolves.toMatchObject({
      kind: "native",
      attemptHandle: prepared.attemptHandle,
    });

    await expect(
      service.start(prepared.attemptHandle, {
        statement: Uint8Array.of(0),
        channel: {
          hubOrigin: origin,
          channelId: `channel_${"F".repeat(22)}`,
          relayProtocolMajor: 1,
          relayProtocolMinor: 2,
          channelOpenCapability: "ryco.rpc",
          channelOpenEffectiveRole: "owner",
        },
        selectedSuite: E2EE_SUITE_25519_CHACHAPOLY_SHA256,
        offeredSuites: [E2EE_SUITE_25519_CHACHAPOLY_SHA256],
        intendedCapability: "ryco.rpc",
        intendedRole: "owner",
        now: 0,
      }),
    ).rejects.toBeInstanceOf(DesktopNativeE2eeHandshakeError);
    expect(borrowCount).toBe(0);

    const identityKeyId = `nkey_${"H".repeat(22)}`;
    const prekeyId = `epk_${"I".repeat(22)}`;
    const nodePublic = rawEd25519(nodeKeys.publicKey);
    const now = 1_800_000_100_000;
    const createdAt = now - 1_000;
    const expiresAt = now + 60_000;
    const crossSignature = Uint8Array.from(
      sign(
        null,
        encodeNodeE2eePrekeyTranscript({
          hubOrigin: origin,
          nodeId,
          identityKeyId,
          prekeyId,
          identityPublicKey: nodePublic,
          agreementPublicKey: nodeAgreement.publicKey,
          createdAt,
          expiresAt,
        }),
        nodeKeys.privateKey,
      ),
    );
    const transcript = encodeNodeE2eeCapabilityTranscript({
      hubOrigin: origin,
      nodeId,
      identityKeyId,
      identityPublicKey: nodePublic,
      e2eeVersionMin: 1,
      e2eeVersionMax: 1,
      suiteRegistry: [E2EE_SUITE_25519_CHACHAPOLY_SHA256],
      prekeyCertificate: {
        prekeyId,
        agreementPublicKey: nodeAgreement.publicKey,
        crossSignature,
        createdAt,
        expiresAt,
      },
      continuityChain: [],
      requireE2EE: true,
      requireApprovedClientE2EE: true,
      policyGeneration: 1,
      issuedAt: now,
      expiresAt,
      continuityId: pin.recordedContinuityId,
    });
    const statement = encodeCanonicalE2eeCbor([
      transcript,
      Uint8Array.from(
        sign(null, encodeNodeE2eeCapabilitySigningEnvelope(transcript), nodeKeys.privateKey),
      ),
    ]);
    const channel = {
      hubOrigin: origin,
      channelId: `ch_${"J".repeat(22)}`,
      relayProtocolMajor: 1,
      relayProtocolMinor: 2,
      channelOpenCapability: "ryco.rpc",
      channelOpenEffectiveRole: "owner",
    } as const;
    const started = await service.start(prepared.attemptHandle, {
      statement,
      channel,
      selectedSuite: E2EE_SUITE_25519_CHACHAPOLY_SHA256,
      offeredSuites: [E2EE_SUITE_25519_CHACHAPOLY_SHA256],
      intendedCapability: "ryco.rpc",
      intendedRole: "owner",
      now: 0,
    });
    expect(started.kind).toBe("hello");
    if (started.kind !== "hello") throw new Error("Expected a Desktop IK hello.");
    const node = new E2eeNodeHandshake({
      channel,
      advertised: {
        nodeId,
        nodeIdentityFingerprint: e2eeKeyFingerprint("node-identity", nodePublic),
        prekeyId,
        agreementPublicKey: nodeAgreement.publicKey,
        continuityChainTranscripts: [],
        continuityId: pin.recordedContinuityId,
      },
      advertisedVersionMin: 1,
      advertisedVersionMax: 1,
      agreementSecretKey: nodeAgreement.secretKey,
      advertisementEmittedAt: now,
      readPolicy: () => ({
        requireApprovedClientE2EE: true,
        suiteRegistry: [E2EE_SUITE_25519_CHACHAPOLY_SHA256],
      }),
      lookupClientAuthorization: () => ({
        status: "approved",
        maxRole: "owner",
        capabilitySet: ["ryco.rpc"],
      }),
    });
    const accepted = node.receiveHello(started.result.record, now);
    expect(accepted.kind).toBe("accepted");
    if (accepted.kind !== "accepted") throw new Error("Expected the node to accept Desktop IK.");
    const established = service.finish(started.handle, accepted.record);
    expect(established.kind).toBe("established");
    if (established.kind === "established") eraseE2eeSessionSecrets(established.secrets);
    eraseE2eeSessionSecrets(accepted.secrets);

    identity = { status: "signed-out" };
    await expect(service.prepare({ accountId, nodeId })).resolves.toEqual({
      kind: "strict-unavailable",
    });
    await expect(service.prepare({ accountId, nodeId: `node_${"G".repeat(22)}` })).resolves.toEqual(
      { kind: "strict-unavailable" },
    );
    agreement.secretKey.fill(0);
    nodeAgreement.secretKey.fill(0);
  });
});
