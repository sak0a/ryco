import { createPublicKey, verify } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { encodeNodeAuthenticationTranscript } from "@ryco/shared/nodeIdentity";
import { describe, expect, it } from "vite-plus/test";

import { makeHubNodeChallengeHttpTransport, makeHubNodeProofClient } from "./HubNodeProofClient.ts";
import { makeLocalHubIdentityStateStore } from "./LocalHubIdentityState.ts";
import { makeNodeSigningIdentity } from "./NodeSigningIdentity.ts";
import type { ProtectedSecretStore } from "./ProtectedSecretStore.ts";

function memoryStore(): ProtectedSecretStore & { readonly values: Map<string, Uint8Array> } {
  const values = new Map<string, Uint8Array>();
  return {
    backend: "permissioned-file",
    values,
    get: async (name) => {
      const value = values.get(name);
      return value === undefined ? null : Uint8Array.from(value);
    },
    create: async (name, value) => {
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
const keyId = "nkey_BBBBBBBBBBBBBBBBBBBBBB";

function spki(publicKey: Uint8Array): Buffer {
  return Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), publicKey]);
}

describe("Hub node proof client", () => {
  it("builds the existing relay auth frame over the exact signed challenge transcript", async () => {
    const root = await mkdtemp(join(tmpdir(), "ryco-node-proof-"));
    const statePath = join(root, "identity.json");
    const stateStore = await makeLocalHubIdentityStateStore(statePath);
    const secretStore = memoryStore();
    const signingIdentity = makeNodeSigningIdentity(secretStore);
    const descriptor = await signingIdentity.generate("node-key.active");
    await stateStore.readOrCreate();
    await stateStore.update((state) => ({
      ...state,
      revision: state.revision + 1,
      activeNode: {
        hubOrigin,
        nodeId,
        activeKeyId: keyId,
        activeKeySecretName: "node-key.active",
        cleanupPollingSecretName: null,
        enrolledAt: now - 10_000,
      },
    }));
    const challenge = new Uint8Array(32).fill(0x5a);
    const client = makeHubNodeProofClient({
      transport: {
        request: async () => ({
          protocolMajor: 1,
          protocolMinor: 1,
          challenge,
          challengeExpiresAt: now + 30_000,
        }),
      },
      stateStore,
      signingIdentity,
      keySelector: {
        authenticationKey: async () => ({ keyId, secretName: "node-key.active" }),
      },
      now: () => now,
    });
    const frame = await client.createRelayAuthenticationFrame(hubOrigin, {
      protocolMajor: 1,
      protocolMinor: 1,
    });
    expect(frame).toMatchObject({
      type: "auth",
      peer: "node",
      protocolMajor: 1,
      protocolMinor: 1,
      nodeId,
    });
    expect(frame.nonce).toEqual(challenge);
    const transcript = encodeNodeAuthenticationTranscript({
      hubOrigin,
      protocolMajor: 1,
      protocolMinor: 1,
      nodeId,
      activeKeyId: keyId,
      challengeExpiresAt: now + 30_000,
      challenge,
    });
    expect(
      verify(
        null,
        transcript,
        createPublicKey({ key: spki(descriptor.publicKey), format: "der", type: "spki" }),
        frame.signature,
      ),
    ).toBe(true);
    const persisted = await readFile(statePath, "utf8");
    expect(persisted).not.toContain(Buffer.from(challenge).toString("base64url"));
    expect(persisted).not.toContain(Buffer.from(frame.signature).toString("base64url"));
  });

  it("rejects protocol substitution before signing", async () => {
    const root = await mkdtemp(join(tmpdir(), "ryco-node-proof-version-"));
    const stateStore = await makeLocalHubIdentityStateStore(join(root, "identity.json"));
    const secretStore = memoryStore();
    const realSigningIdentity = makeNodeSigningIdentity(secretStore);
    let signCalls = 0;
    const signingIdentity = {
      ...realSigningIdentity,
      sign: async (...input: Parameters<typeof realSigningIdentity.sign>) => {
        signCalls += 1;
        return realSigningIdentity.sign(...input);
      },
    };
    await signingIdentity.generate("node-key.active");
    await stateStore.readOrCreate();
    await stateStore.update((state) => ({
      ...state,
      revision: state.revision + 1,
      activeNode: {
        hubOrigin,
        nodeId,
        activeKeyId: keyId,
        activeKeySecretName: "node-key.active",
        cleanupPollingSecretName: null,
        enrolledAt: now,
      },
    }));
    const client = makeHubNodeProofClient({
      transport: {
        request: async () => ({
          protocolMajor: 1,
          protocolMinor: 2,
          challenge: new Uint8Array(32),
          challengeExpiresAt: now + 30_000,
        }),
      },
      stateStore,
      signingIdentity,
      keySelector: { authenticationKey: async () => ({ keyId, secretName: "node-key.active" }) },
      now: () => now,
    });
    await expect(
      client.createRelayAuthenticationFrame(hubOrigin, { protocolMajor: 1, protocolMinor: 1 }),
    ).rejects.toMatchObject({ code: "node_proof_failed" });
    expect(signCalls).toBe(0);
  });

  it("uses a credential-free HTTP preflight", async () => {
    let requestInit: RequestInit | undefined;
    const transport = makeHubNodeChallengeHttpTransport(async (_input, init) => {
      requestInit = init;
      return Response.json({
        protocolMajor: 1,
        protocolMinor: 1,
        challenge: Buffer.from(new Uint8Array(32).fill(0x33)).toString("base64url"),
        challengeExpiresAt: now + 30_000,
      });
    });
    expect(
      await transport.request({
        hubOrigin,
        nodeId,
        activeKeyId: keyId,
        protocolMajor: 1,
        protocolMinor: 1,
      }),
    ).toMatchObject({ protocolMajor: 1, protocolMinor: 1 });
    expect(requestInit?.credentials).toBe("omit");
    expect(requestInit?.cache).toBe("no-store");
    expect(requestInit?.headers).not.toHaveProperty("cookie");
    expect(requestInit?.headers).not.toHaveProperty("authorization");

    const malformedLength = makeHubNodeChallengeHttpTransport(
      async () =>
        new Response("{}", {
          headers: { "content-length": "invalid" },
        }),
    );
    await expect(
      malformedLength.request({
        hubOrigin,
        nodeId,
        activeKeyId: keyId,
        protocolMajor: 1,
        protocolMinor: 1,
      }),
    ).rejects.toMatchObject({ code: "node_proof_failed" });
  });
});
