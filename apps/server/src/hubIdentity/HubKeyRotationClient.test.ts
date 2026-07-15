import { createPublicKey, verify } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { encodeNodeKeyRotationTranscript } from "@ryco/shared/nodeIdentity";
import { describe, expect, it } from "vite-plus/test";

import {
  type HubKeyRotationChallenge,
  type HubKeyRotationStatus,
  type HubKeyRotationTransport,
  makeHubKeyRotationClient,
} from "./HubKeyRotationClient.ts";
import { makeLocalHubIdentityStateStore } from "./LocalHubIdentityState.ts";
import { makeNodeSigningIdentity } from "./NodeSigningIdentity.ts";
import type { ProtectedSecretStore } from "./ProtectedSecretStore.ts";

function memorySecretStore(): ProtectedSecretStore & { readonly values: Map<string, Uint8Array> } {
  const values = new Map<string, Uint8Array>();
  return {
    backend: "permissioned-file",
    values,
    get: async (name) => {
      const value = values.get(name);
      return value === undefined ? null : Uint8Array.from(value);
    },
    create: async (name, value) => {
      if (values.has(name))
        throw Object.assign(new Error("conflict"), { code: "protected_store_conflict" });
      values.set(name, Uint8Array.from(value));
    },
    remove: async (name) => {
      values.delete(name);
    },
  };
}

const now = 1_784_160_000_000;
const hubOrigin = "https://hub.example.com";
const nodeId = "node_AAAAAAAAAAAAAAAAAAAAAA";
const oldKeyId = "nkey_BBBBBBBBBBBBBBBBBBBBBB";
const newKeyId = "nkey_DDDDDDDDDDDDDDDDDDDDDD";
const rotationRequestId = "nrot_CCCCCCCCCCCCCCCCCCCCCC";
const challengeBytes = new Uint8Array(32).fill(0xa5);

function challenge(value = challengeBytes): HubKeyRotationChallenge {
  return {
    rotationRequestId,
    newKeyId,
    protocolMajor: 1,
    protocolMinor: 1,
    challenge: Uint8Array.from(value),
    challengeExpiresAt: now + 30_000,
  };
}

function spki(publicKey: Uint8Array): Buffer {
  return Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), publicKey]);
}

async function harness(transport: HubKeyRotationTransport) {
  const root = await mkdtemp(join(tmpdir(), "ryco-rotation-client-"));
  const stateStore = await makeLocalHubIdentityStateStore(join(root, "identity.json"));
  const secretStore = memorySecretStore();
  const signingIdentity = makeNodeSigningIdentity(secretStore);
  const initial = await stateStore.readOrCreate();
  const oldDescriptor = await signingIdentity.generate("node-key.active");
  await stateStore.update((current) => ({
    ...current,
    revision: current.revision + 1,
    activeNode: {
      hubOrigin,
      nodeId,
      activeKeyId: oldKeyId,
      activeKeySecretName: "node-key.active",
      cleanupPollingSecretName: null,
      enrolledAt: now - 100_000,
    },
  }));
  const makeClient = () =>
    makeHubKeyRotationClient({ transport, stateStore, signingIdentity, now: () => now });
  return { initial, stateStore, secretStore, signingIdentity, oldDescriptor, makeClient };
}

describe("Hub key rotation client", () => {
  it("proves with the old key, selects the activated new key, and deletes old custody after proof", async () => {
    let newPublicKey: Uint8Array | undefined;
    let proofChallenge: Uint8Array | undefined;
    let proofSignature: Uint8Array | undefined;
    let status: HubKeyRotationStatus = { status: "awaiting_owner" };
    const transport: HubKeyRotationTransport = {
      begin: async (request) => {
        newPublicKey = Uint8Array.from(request.newKey.publicKey);
        return challenge();
      },
      prove: async (request) => {
        proofChallenge = Uint8Array.from(request.challenge);
        proofSignature = Uint8Array.from(request.signature);
        return { status: "awaiting_owner" };
      },
      status: async () => status,
    };
    const stateful = await harness(transport);
    const client = stateful.makeClient();
    expect(await client.stage(hubOrigin)).toEqual({ status: "awaiting_owner" });
    const transcript = encodeNodeKeyRotationTranscript({
      hubOrigin,
      protocolMajor: 1,
      protocolMinor: 1,
      rotationRequestId,
      nodeId,
      oldActiveKeyId: oldKeyId,
      newKeyId,
      newKey: { algorithm: "ed25519", publicKey: newPublicKey ?? new Uint8Array() },
      challengeExpiresAt: now + 30_000,
      challenge: challengeBytes,
    });
    expect(
      verify(
        null,
        transcript,
        createPublicKey({
          key: spki(stateful.oldDescriptor.publicKey),
          format: "der",
          type: "spki",
        }),
        proofSignature ?? new Uint8Array(),
      ),
    ).toBe(true);
    expect(proofChallenge).toEqual(challengeBytes);
    expect(await client.authenticationKey(hubOrigin)).toEqual({
      keyId: oldKeyId,
      secretName: "node-key.active",
    });

    status = { status: "activated", activatedAt: now + 20_000 };
    expect(await stateful.makeClient().resume(hubOrigin)).toEqual(status);
    const selected = await client.authenticationKey(hubOrigin);
    expect(selected.keyId).toBe(newKeyId);
    expect(selected.secretName).not.toBe("node-key.active");
    expect(stateful.secretStore.values.has("node-key.active")).toBe(true);

    await client.confirmNewKeyAuthenticated(hubOrigin, newKeyId);
    expect(stateful.secretStore.values.has("node-key.active")).toBe(false);
    expect((await stateful.stateStore.readOrCreate()).stagedRotation).toBeNull();
    expect((await stateful.stateStore.readOrCreate()).activeNode?.activeKeyId).toBe(newKeyId);
  });

  it("keeps the old key and deletes a rejected staged key", async () => {
    const transport: HubKeyRotationTransport = {
      begin: async () => challenge(),
      prove: async () => ({ status: "rejected" }),
      status: async () => ({ status: "rejected" }),
    };
    const test = await harness(transport);
    expect(await test.makeClient().stage(hubOrigin)).toEqual({ status: "rejected" });
    expect((await test.stateStore.readOrCreate()).stagedRotation).toBeNull();
    expect(test.secretStore.values.has("node-key.active")).toBe(true);
    expect(test.secretStore.values.size).toBe(1);
  });

  it("resumes cleanly after a committed proof response is lost", async () => {
    let proveAttempts = 0;
    const transport: HubKeyRotationTransport = {
      begin: async () => challenge(),
      prove: async () => {
        proveAttempts += 1;
        throw new Error("response lost after proof commit");
      },
      status: async () => ({ status: "awaiting_owner" }),
    };
    const test = await harness(transport);
    await expect(test.makeClient().stage(hubOrigin)).rejects.toMatchObject({
      code: "rotation_transport_failed",
    });
    expect((await test.stateStore.readOrCreate()).stagedRotation?.rotationRequestId).toBe(
      rotationRequestId,
    );
    expect(await test.makeClient().resume(hubOrigin)).toEqual({ status: "awaiting_owner" });
    expect(proveAttempts).toBe(1);
  });

  it("obtains a fresh challenge when an interrupted proof was not committed", async () => {
    let beginCount = 0;
    let proveCount = 0;
    const transport: HubKeyRotationTransport = {
      begin: async () => {
        beginCount += 1;
        return challenge(new Uint8Array(32).fill(beginCount));
      },
      prove: async () => {
        proveCount += 1;
        if (proveCount === 1) throw new Error("request never committed");
        return { status: "awaiting_owner" };
      },
      status: async () => ({ status: "proof_required" }),
    };
    const test = await harness(transport);
    await expect(test.makeClient().stage(hubOrigin)).rejects.toMatchObject({
      code: "rotation_transport_failed",
    });
    expect(await test.makeClient().resume(hubOrigin)).toEqual({ status: "awaiting_owner" });
    expect(beginCount).toBe(2);
    expect(proveCount).toBe(2);
  });

  it("gives concurrent staging attempts one local winner", async () => {
    const transport: HubKeyRotationTransport = {
      begin: async () => challenge(),
      prove: async () => ({ status: "awaiting_owner" }),
      status: async () => ({ status: "awaiting_owner" }),
    };
    const test = await harness(transport);
    const results = await Promise.allSettled([
      test.makeClient().stage(hubOrigin),
      test.makeClient().stage(hubOrigin),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect((await test.stateStore.readOrCreate()).stagedRotation).not.toBeNull();
    expect(test.secretStore.values.size).toBe(2);
  });
});
