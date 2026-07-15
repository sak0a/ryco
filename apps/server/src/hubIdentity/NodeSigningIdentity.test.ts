import { createPublicKey, verify } from "node:crypto";

import { describe, expect, it } from "vite-plus/test";

import { makeNodeSigningIdentity, NodeSigningIdentityError } from "./NodeSigningIdentity.ts";
import type { ProtectedSecretStore } from "./ProtectedSecretStore.ts";

function memoryStore(initial: ReadonlyMap<string, Uint8Array> = new Map()): ProtectedSecretStore & {
  readonly values: Map<string, Uint8Array>;
} {
  const values = new Map([...initial].map(([name, value]) => [name, Uint8Array.from(value)]));
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

function ed25519Spki(publicKey: Uint8Array): Buffer {
  return Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), publicKey]);
}

describe("node signing identity", () => {
  it("generates locally, signs, restarts, and never exports private bytes", async () => {
    const store = memoryStore();
    const identity = makeNodeSigningIdentity(store);
    const descriptor = await identity.generate("node-key.fixture");

    expect(Object.keys(descriptor).toSorted()).toEqual(["algorithm", "fingerprint", "publicKey"]);
    expect(descriptor.algorithm).toBe("ed25519");
    expect(descriptor.publicKey).toHaveLength(32);
    expect(descriptor.fingerprint).toHaveLength(32);
    expect(store.values.get("node-key.fixture")?.byteLength).toBeGreaterThan(32);

    const transcript = new TextEncoder().encode("bounded fixture transcript");
    const signature = await identity.sign("node-key.fixture", transcript);
    expect(signature).toHaveLength(64);
    expect(
      verify(
        null,
        transcript,
        createPublicKey({ key: ed25519Spki(descriptor.publicKey), format: "der", type: "spki" }),
        signature,
      ),
    ).toBe(true);

    const restarted = makeNodeSigningIdentity(store);
    expect(await restarted.getPublicDescriptor("node-key.fixture")).toEqual(descriptor);
    expect(await restarted.sign("node-key.fixture", transcript)).toEqual(signature);
  });

  it("refuses conflicts without replacing the original key", async () => {
    const store = memoryStore();
    const identity = makeNodeSigningIdentity(store);
    const first = await identity.generate("node-key.fixture");
    await expect(identity.generate("node-key.fixture")).rejects.toMatchObject({
      code: "node_key_conflict",
    });
    expect(await identity.getPublicDescriptor("node-key.fixture")).toEqual(first);
  });

  it("fails closed for missing and corrupt custody", async () => {
    const store = memoryStore(
      new Map([["node-key.corrupt", new TextEncoder().encode("private-key-corruption-canary")]]),
    );
    const identity = makeNodeSigningIdentity(store);
    await expect(identity.getPublicDescriptor("node-key.missing")).rejects.toMatchObject({
      code: "node_key_not_found",
    });
    let error: unknown;
    try {
      await identity.sign("node-key.corrupt", new Uint8Array([1]));
    } catch (cause) {
      error = cause;
    }
    expect(error).toBeInstanceOf(NodeSigningIdentityError);
    expect(String(error)).not.toContain("private-key-corruption-canary");
    expect(JSON.stringify(error)).not.toContain("private-key-corruption-canary");
  });

  it("deletes key custody and rejects subsequent signing", async () => {
    const store = memoryStore();
    const identity = makeNodeSigningIdentity(store);
    await identity.generate("node-key.fixture");
    await identity.delete("node-key.fixture");
    expect(store.values.has("node-key.fixture")).toBe(false);
    await expect(identity.sign("node-key.fixture", new Uint8Array([1]))).rejects.toMatchObject({
      code: "node_key_not_found",
    });
  });

  it("bounds transcript sizes", async () => {
    const identity = makeNodeSigningIdentity(memoryStore());
    await identity.generate("node-key.fixture");
    await expect(identity.sign("node-key.fixture", new Uint8Array())).rejects.toMatchObject({
      code: "node_signing_failed",
    });
    await expect(identity.sign("node-key.fixture", new Uint8Array(4097))).rejects.toMatchObject({
      code: "node_signing_failed",
    });
  });
});
