import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import type { ProtectedSecretStore } from "../hubIdentity/ProtectedSecretStore.ts";
import {
  HubIdentityRuntimeError,
  HubRelayAuthenticationError,
  makeHubIdentityRuntime,
} from "./HubIdentityRuntime.ts";

const nodeId = `node_${"A".repeat(22)}`;
const activeKeyId = `nkey_${"B".repeat(22)}`;

function makeMemoryStore(): ProtectedSecretStore & { readonly values: Map<string, Uint8Array> } {
  const values = new Map<string, Uint8Array>();
  return {
    backend: "keytar",
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
