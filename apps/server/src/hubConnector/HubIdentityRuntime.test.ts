import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { makeNodeSigningIdentity } from "../hubIdentity/NodeSigningIdentity.ts";
import {
  type ProtectedSecretStore,
  type ProtectedSecretStoreBackend,
  ProtectedSecretStoreError,
} from "../hubIdentity/ProtectedSecretStore.ts";
import {
  HubIdentityRuntimeError,
  HubRelayAuthenticationError,
  makeHubIdentityRuntime,
} from "./HubIdentityRuntime.ts";

const nodeId = `node_${"A".repeat(22)}`;
const activeKeyId = `nkey_${"B".repeat(22)}`;

function makeMemoryStore(
  backend: ProtectedSecretStoreBackend = "keytar",
): ProtectedSecretStore & { readonly values: Map<string, Uint8Array> } {
  const values = new Map<string, Uint8Array>();
  return {
    backend,
    values,
    get: async (name) => {
      const value = values.get(name);
      return value === undefined ? null : Uint8Array.from(value);
    },
    create: async (name, value) => {
      if (values.has(name)) throw new Error("conflict");
      values.set(name, Uint8Array.from(value));
    },
    remove: async (name) => {
      values.delete(name);
    },
  };
}

const enrollmentFetch = async (input: string | URL | Request) => {
  if (String(input).endsWith("/api/node/enrollments")) {
    return Response.json({
      deviceCode: "ABCD-EFGH",
      pollingSecret: Buffer.from(new Uint8Array(32).fill(0x51)).toString("base64url"),
      expiresAt: 160_000,
      pollIntervalMs: 1_000,
    });
  }
  throw new Error("unexpected route");
};

async function writeLegacyActiveState(statePath: string, options?: { readonly staged?: boolean }) {
  await writeFile(
    statePath,
    JSON.stringify({
      version: 1,
      revision: 4,
      environmentId: `env_${"E".repeat(22)}`,
      pendingEnrollment: null,
      activeNode: {
        hubOrigin: "https://relay.example",
        nodeId: `node_${"N".repeat(22)}`,
        activeKeyId: `nkey_${"K".repeat(22)}`,
        activeKeySecretName: "node-key.active",
        cleanupPollingSecretName: null,
        enrolledAt: 1,
      },
      stagedRotation: options?.staged
        ? {
            hubOrigin: "https://relay.example",
            rotationRequestId: `nrot_${"R".repeat(22)}`,
            newKeyId: `nkey_${"Q".repeat(22)}`,
            newKeySecretName: "node-key.staged",
            stagedAt: 2,
            activatedAt: null,
          }
        : null,
      pendingTeardown: null,
    }),
    { mode: 0o600 },
  );
}

describe("HubIdentityRuntime", () => {
  it("enrolls, survives restart, and creates a fresh canonical proof without exporting keys", async () => {
    const root = await mkdtemp(join(tmpdir(), "ryco-hub-identity-runtime-"));
    const store = makeMemoryStore();
    let environmentId = "";
    let challengeRequests = 0;
    let challengeUnavailable = false;
    const fetchImplementation = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/node/enrollments")) {
        const body = JSON.parse(String(init?.body)) as { environmentId: string };
        environmentId = body.environmentId;
        return Response.json({
          deviceCode: "ABCD-EFGH",
          pollingSecret: Buffer.from(new Uint8Array(32).fill(0x51)).toString("base64url"),
          expiresAt: 160_000,
          pollIntervalMs: 1_000,
        });
      }
      if (url.endsWith("/api/node/enrollments/poll")) {
        return Response.json({
          status: "approved",
          nodeId,
          environmentId,
          activeKeyId,
          enrolledAt: 101_000,
        });
      }
      if (url.endsWith("/api/node/auth/challenges")) {
        challengeRequests += 1;
        if (challengeUnavailable) {
          return new Response("PROOF-PREFLIGHT-RESPONSE-CANARY", { status: 503 });
        }
        return Response.json({
          protocolMajor: 1,
          protocolMinor: 2,
          challenge: Buffer.from(new Uint8Array(32).fill(challengeRequests)).toString("base64url"),
          challengeExpiresAt: 120_000,
        });
      }
      throw new Error("unexpected route");
    };
    const options = {
      statePath: join(root, "hub-identity.json"),
      fileSecretRoot: join(root, "secrets"),
      allowFileFallback: false,
      secretStore: store,
      fetch: fetchImplementation,
      now: () => 100_000,
    } as const;

    const runtime = await makeHubIdentityRuntime(options);
    const started = await runtime.startEnrollment("https://relay.example", {
      label: "Ryco node",
      platformOs: "linux",
      platformArch: "x64",
      clientVersion: "0.1.8",
    });
    expect(started.deviceCode).toBe("ABCD-EFGH");
    expect((await runtime.pollEnrollment("https://relay.example")).status).toBe("approved");
    const state = await runtime.readState();
    expect(state.activeNode).toMatchObject({ nodeId, activeKeyId });
    expect(JSON.stringify(state)).not.toContain("private");
    expect(JSON.stringify(state)).not.toContain("UVFRUVFR");

    const restarted = await makeHubIdentityRuntime(options);
    const first = await restarted.createRelayAuthenticationFrame("https://relay.example", {
      protocolMajor: 1,
      protocolMinor: 2,
    });
    const second = await restarted.createRelayAuthenticationFrame("https://relay.example", {
      protocolMajor: 1,
      protocolMinor: 2,
    });
    expect(first.nodeId).toBe(nodeId);
    expect(first.signature).toHaveLength(64);
    expect(first.nonce).not.toEqual(second.nonce);
    expect(challengeRequests).toBe(2);
    expect("secretStore" in restarted).toBe(false);

    challengeUnavailable = true;
    let error: unknown;
    try {
      await restarted.createRelayAuthenticationFrame("https://relay.example", {
        protocolMajor: 1,
        protocolMinor: 2,
      });
    } catch (cause) {
      error = cause;
    }
    expect(error).toBeInstanceOf(HubRelayAuthenticationError);
    expect(error).toMatchObject({ failure: "server_draining" });
    expect(String(error)).not.toContain("CANARY");
    expect(JSON.stringify(error)).not.toContain("CANARY");
  });

  it("re-reads a pending ceremony across a restart and recomputes its fingerprint", async () => {
    const root = await mkdtemp(join(tmpdir(), "ryco-hub-identity-pending-read-"));
    const store = makeMemoryStore();
    const fetchImplementation = async (input: string | URL | Request) => {
      if (String(input).endsWith("/api/node/enrollments")) {
        return Response.json({
          deviceCode: "ABCD-EFGH",
          pollingSecret: Buffer.from(new Uint8Array(32).fill(0x51)).toString("base64url"),
          expiresAt: 160_000,
          pollIntervalMs: 1_000,
        });
      }
      throw new Error("unexpected route");
    };
    const options = {
      statePath: join(root, "hub-identity.json"),
      fileSecretRoot: join(root, "secrets"),
      allowFileFallback: false,
      secretStore: store,
      fetch: fetchImplementation,
      now: () => 100_000,
    } as const;

    const runtime = await makeHubIdentityRuntime(options);
    const started = await runtime.startEnrollment("https://relay.example", {
      label: "Ryco node",
      platformOs: "linux",
      platformArch: "x64",
      clientVersion: "0.1.8",
    });

    // A fresh process: nothing from the start response is in memory any more.
    const restarted = await makeHubIdentityRuntime(options);
    const pending = await restarted.readPendingEnrollment("https://relay.example");

    expect(pending).not.toBeNull();
    expect(pending?.deviceCode).toBe("ABCD-EFGH");
    expect(pending?.expiresAt).toBe(160_000);
    expect(pending?.pollIntervalMs).toBe(1_000);
    // The security property: the fingerprint is derived from the key actually in
    // custody, not read back from the state file, so it cannot be tampered into
    // disagreeing with what will sign the authentication transcript.
    expect(pending?.fingerprint).toEqual(started.publicKey.fingerprint);
    expect(pending?.algorithm).toBe("ed25519");

    // A different Hub must not see this node's pending ceremony.
    expect(await restarted.readPendingEnrollment("https://other.example")).toBeNull();

    await restarted.cancelEnrollment("https://relay.example");
    expect(await restarted.readPendingEnrollment("https://relay.example")).toBeNull();
  });

  it("erases every owned secret, mints a fresh EnvironmentId, and is idempotent", async () => {
    const root = await mkdtemp(join(tmpdir(), "ryco-hub-identity-leave-"));
    const store = makeMemoryStore();
    const options = {
      statePath: join(root, "hub-identity.json"),
      fileSecretRoot: join(root, "secrets"),
      allowFileFallback: false,
      secretStore: store,
      fetch: async (input: string | URL | Request) => {
        if (String(input).endsWith("/api/node/enrollments")) {
          return Response.json({
            deviceCode: "ABCD-EFGH",
            pollingSecret: Buffer.from(new Uint8Array(32).fill(0x51)).toString("base64url"),
            expiresAt: 160_000,
            pollIntervalMs: 1_000,
          });
        }
        throw new Error("unexpected route");
      },
      now: () => 100_000,
    } as const;

    const runtime = await makeHubIdentityRuntime(options);
    const before = await runtime.readState();
    await runtime.startEnrollment("https://relay.example", {
      label: "Ryco node",
      platformOs: "linux",
      platformArch: "x64",
      clientVersion: "0.1.8",
    });
    const pending = (await runtime.readState()).pendingEnrollment;
    expect(pending).not.toBeNull();

    await runtime.leave();

    const after = await runtime.readState();
    expect(after.pendingEnrollment).toBeNull();
    expect(after.activeNode).toBeNull();
    expect(after.stagedRotation).toBeNull();
    expect(after.pendingTeardown).toBeNull();
    // A fresh identifier is what lets the node rejoin the same Hub: the service
    // binds one node record per environment id, and that binding outlives
    // revocation.
    expect(after.environmentId).not.toBe(before.environmentId);
    // No key material may survive the erase.
    expect(await store.get(pending!.keySecretName)).toBeNull();
    expect(await store.get(pending!.pollingSecretName)).toBeNull();

    // Idempotent: the panel may retry a leave whose response was lost.
    await runtime.leave();
    expect((await runtime.readState()).environmentId).toBe(after.environmentId);
  });

  it("finishes an interrupted leave on the next start, even with the keys already gone", async () => {
    const root = await mkdtemp(join(tmpdir(), "ryco-hub-identity-leave-resume-"));
    const store = makeMemoryStore();
    const statePath = join(root, "hub-identity.json");
    const options = {
      statePath,
      fileSecretRoot: join(root, "secrets"),
      allowFileFallback: false,
      secretStore: store,
      now: () => 100_000,
    } as const;

    // A state file that crashed between phase one and phase three: the teardown
    // marker is committed and the key it names is already deleted. Without the
    // resume this is unstartable, because start-up validation reads custody for
    // an activeNode whose key no longer exists.
    await writeFile(
      statePath,
      JSON.stringify({
        version: 1,
        revision: 4,
        environmentId: `env_${"E".repeat(22)}`,
        pendingEnrollment: null,
        activeNode: {
          hubOrigin: "https://relay.example",
          nodeId: `node_${"N".repeat(22)}`,
          activeKeyId: `nkey_${"K".repeat(22)}`,
          activeKeySecretName: "node-key.gone",
          cleanupPollingSecretName: null,
          enrolledAt: 1,
        },
        stagedRotation: null,
        pendingTeardown: { secretNames: ["node-key.gone"], requestedAt: 99_000 },
      }),
      { mode: 0o600 },
    );

    const runtime = await makeHubIdentityRuntime(options);
    const state = await runtime.readState();

    expect(state.activeNode).toBeNull();
    expect(state.pendingTeardown).toBeNull();
    expect(state.environmentId).not.toBe(`env_${"E".repeat(22)}`);
  });

  it("keeps a file-backed identity on files when the OS store later becomes available", async () => {
    const root = await mkdtemp(join(tmpdir(), "ryco-hub-identity-file-affinity-"));
    const fileStore = makeMemoryStore("permissioned-file");
    let initialOsAttempts = 0;
    const options = {
      statePath: join(root, "hub-identity.json"),
      fileSecretRoot: join(root, "secrets"),
      allowFileFallback: true,
      makeOsSecretStore: async () => {
        initialOsAttempts += 1;
        throw new ProtectedSecretStoreError("protected_store_unavailable");
      },
      makeFileSecretStore: async () => fileStore,
      fetch: enrollmentFetch,
      now: () => 100_000,
    } as const;

    const runtime = await makeHubIdentityRuntime(options);
    await runtime.startEnrollment("https://relay.example", {
      label: "Ryco node",
      platformOs: "linux",
      platformArch: "x64",
      clientVersion: "0.1.8",
    });
    expect((await runtime.readState()).protectedStoreBackend).toBe("permissioned-file");
    expect(initialOsAttempts).toBe(1);

    let restartedOsAttempts = 0;
    const restarted = await makeHubIdentityRuntime({
      ...options,
      makeOsSecretStore: async () => {
        restartedOsAttempts += 1;
        return makeMemoryStore("keytar");
      },
    });

    expect(restarted.backend).toBe("permissioned-file");
    expect(restartedOsAttempts).toBe(0);
    expect(await restarted.readPendingEnrollment("https://relay.example")).not.toBeNull();
  });

  it("never falls through from an OS-backed identity to the file store", async () => {
    const root = await mkdtemp(join(tmpdir(), "ryco-hub-identity-os-affinity-"));
    const osStore = makeMemoryStore("keytar");
    const fileStore = makeMemoryStore("permissioned-file");
    const options = {
      statePath: join(root, "hub-identity.json"),
      fileSecretRoot: join(root, "secrets"),
      allowFileFallback: true,
      makeOsSecretStore: async () => osStore,
      makeFileSecretStore: async () => fileStore,
      fetch: enrollmentFetch,
      now: () => 100_000,
    } as const;

    const runtime = await makeHubIdentityRuntime(options);
    await runtime.startEnrollment("https://relay.example", {
      label: "Ryco node",
      platformOs: "linux",
      platformArch: "x64",
      clientVersion: "0.1.8",
    });
    expect((await runtime.readState()).protectedStoreBackend).toBe("os");

    let fileAttempts = 0;
    await expect(
      makeHubIdentityRuntime({
        ...options,
        makeOsSecretStore: async () => {
          throw new ProtectedSecretStoreError("protected_store_unavailable");
        },
        makeFileSecretStore: async () => {
          fileAttempts += 1;
          return fileStore;
        },
      }),
    ).rejects.toMatchObject({ code: "identity_store_unavailable" });
    expect(fileAttempts).toBe(0);
  });

  it("requires the explicit fallback permission for a file-backed identity", async () => {
    const root = await mkdtemp(join(tmpdir(), "ryco-hub-identity-file-permission-"));
    const fileStore = makeMemoryStore("permissioned-file");
    const options = {
      statePath: join(root, "hub-identity.json"),
      fileSecretRoot: join(root, "secrets"),
      allowFileFallback: true,
      makeOsSecretStore: async () => {
        throw new ProtectedSecretStoreError("protected_store_unavailable");
      },
      makeFileSecretStore: async () => fileStore,
      fetch: enrollmentFetch,
      now: () => 100_000,
    } as const;

    const runtime = await makeHubIdentityRuntime(options);
    await runtime.startEnrollment("https://relay.example", {
      label: "Ryco node",
      platformOs: "linux",
      platformArch: "x64",
      clientVersion: "0.1.8",
    });

    await expect(
      makeHubIdentityRuntime({ ...options, allowFileFallback: false }),
    ).rejects.toMatchObject({ code: "identity_store_unavailable" });
  });

  it("migrates a legacy file identity only when exactly one store owns its keys", async () => {
    const root = await mkdtemp(join(tmpdir(), "ryco-hub-identity-legacy-file-"));
    const statePath = join(root, "hub-identity.json");
    const osStore = makeMemoryStore("keytar");
    const fileStore = makeMemoryStore("permissioned-file");
    await makeNodeSigningIdentity(fileStore).generate("node-key.active");
    await writeLegacyActiveState(statePath);

    const runtime = await makeHubIdentityRuntime({
      statePath,
      fileSecretRoot: join(root, "secrets"),
      allowFileFallback: true,
      makeOsSecretStore: async () => osStore,
      makeFileSecretStore: async () => fileStore,
    });

    expect(runtime.backend).toBe("permissioned-file");
    expect((await runtime.readState()).protectedStoreBackend).toBe("permissioned-file");
  });

  it("fails closed for absent, ambiguous, or split legacy key custody", async () => {
    const makeLegacyOptions = async (
      label: string,
      configure: (
        osStore: ReturnType<typeof makeMemoryStore>,
        fileStore: ReturnType<typeof makeMemoryStore>,
      ) => Promise<void>,
      staged = false,
    ) => {
      const root = await mkdtemp(join(tmpdir(), `ryco-hub-identity-legacy-${label}-`));
      const statePath = join(root, "hub-identity.json");
      const osStore = makeMemoryStore("keytar");
      const fileStore = makeMemoryStore("permissioned-file");
      await configure(osStore, fileStore);
      await writeLegacyActiveState(statePath, { staged });
      return {
        statePath,
        fileSecretRoot: join(root, "secrets"),
        allowFileFallback: true,
        makeOsSecretStore: async () => osStore,
        makeFileSecretStore: async () => fileStore,
      } as const;
    };

    await expect(
      makeHubIdentityRuntime(await makeLegacyOptions("absent", async () => undefined)),
    ).rejects.toMatchObject({ code: "identity_store_unavailable" });

    await expect(
      makeHubIdentityRuntime(
        await makeLegacyOptions("ambiguous", async (osStore, fileStore) => {
          await makeNodeSigningIdentity(osStore).generate("node-key.active");
          await makeNodeSigningIdentity(fileStore).generate("node-key.active");
        }),
      ),
    ).rejects.toMatchObject({ code: "identity_store_unavailable" });

    await expect(
      makeHubIdentityRuntime(
        await makeLegacyOptions(
          "split",
          async (osStore, fileStore) => {
            await makeNodeSigningIdentity(osStore).generate("node-key.active");
            await makeNodeSigningIdentity(fileStore).generate("node-key.staged");
          },
          true,
        ),
      ),
    ).rejects.toMatchObject({ code: "identity_store_unavailable" });
  });

  it("bounds a legacy custody inspection failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "ryco-hub-identity-legacy-locked-"));
    const statePath = join(root, "hub-identity.json");
    const osStore = {
      ...makeMemoryStore("keytar"),
      get: async () => {
        throw new ProtectedSecretStoreError("protected_store_unavailable");
      },
    };
    await writeLegacyActiveState(statePath);

    await expect(
      makeHubIdentityRuntime({
        statePath,
        fileSecretRoot: join(root, "secrets"),
        allowFileFallback: false,
        makeOsSecretStore: async () => osStore,
      }),
    ).rejects.toMatchObject({ code: "identity_store_unavailable" });
  });

  it("fails restart with a bounded error when enrolled key custody is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "ryco-hub-identity-missing-"));
    const store = makeMemoryStore();
    let environmentId = "";
    const fetchImplementation = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/node/enrollments")) {
        environmentId = (JSON.parse(String(init?.body)) as { environmentId: string }).environmentId;
        return Response.json({
          deviceCode: "ABCD-EFGH",
          pollingSecret: Buffer.from(new Uint8Array(32).fill(7)).toString("base64url"),
          expiresAt: 160_000,
          pollIntervalMs: 1_000,
        });
      }
      return Response.json({
        status: "approved",
        nodeId,
        environmentId,
        activeKeyId,
        enrolledAt: 101_000,
      });
    };
    const options = {
      statePath: join(root, "hub-identity.json"),
      fileSecretRoot: join(root, "secrets"),
      allowFileFallback: false,
      secretStore: store,
      fetch: fetchImplementation,
      now: () => 100_000,
    } as const;
    const runtime = await makeHubIdentityRuntime(options);
    await runtime.startEnrollment("https://relay.example", {
      label: "Ryco node",
      platformOs: "linux",
      platformArch: "x64",
      clientVersion: "0.1.8",
    });
    await runtime.pollEnrollment("https://relay.example");
    store.values.clear();

    let error: unknown;
    try {
      await makeHubIdentityRuntime(options);
    } catch (cause) {
      error = cause;
    }
    expect(error).toBeInstanceOf(HubIdentityRuntimeError);
    expect(error).toMatchObject({ code: "identity_unavailable" });
    expect(String(error)).not.toContain(nodeId);
    expect(JSON.stringify(error)).not.toContain(nodeId);
  });
});
