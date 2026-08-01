import { deriveE2eeAgreementPublicKey, e2eeKeyFingerprint } from "@ryco/shared/relayE2eeKeys";
import { describe, expect, it } from "vite-plus/test";

import { makeNodeAgreementIdentity, NodeAgreementIdentityError } from "./NodeAgreementIdentity.ts";
import type { ProtectedSecretStore } from "./ProtectedSecretStore.ts";

/**
 * A store that hands out the SAME buffer it holds, so a test can observe whether
 * the module zeroized what it was given.
 *
 * The real backends decode a fresh array per read, which would hide a missing
 * `fill(0)` behind a copy. Aliasing here is what makes the §6.3 discipline
 * observable at all.
 */
function aliasingStore(
  initial: ReadonlyMap<string, Uint8Array> = new Map(),
): ProtectedSecretStore & {
  readonly values: Map<string, Uint8Array>;
  readonly handedOut: Uint8Array[];
} {
  const values = new Map([...initial].map(([name, value]) => [name, Uint8Array.from(value)]));
  const handedOut: Uint8Array[] = [];
  return {
    backend: "permissioned-file",
    values,
    handedOut,
    get: async (name) => {
      const value = values.get(name);
      if (value === undefined) return null;
      const loaned = Uint8Array.from(value);
      handedOut.push(loaned);
      return loaned;
    },
    create: async (name, value) => {
      if (values.has(name)) {
        throw Object.assign(new Error("conflict"), { code: "protected_store_conflict" });
      }
      values.set(name, Uint8Array.from(value));
    },
    remove: async (name) => {
      values.delete(name);
    },
  };
}

const ZEROED = "0".repeat(64);
const hex = (value: Uint8Array): string => Buffer.from(value).toString("hex");

describe("node agreement identity (§6.2, §6.3)", () => {
  it("generates into custody, survives a restart, and never returns the secret", async () => {
    const store = aliasingStore();
    const identity = makeNodeAgreementIdentity(store);
    const descriptor = await identity.generate("e2ee-prekey.fixture");

    expect(Object.keys(descriptor).toSorted()).toEqual(["algorithm", "fingerprint", "publicKey"]);
    expect(descriptor.algorithm).toBe("x25519");
    expect(descriptor.publicKey).toHaveLength(32);
    expect(hex(descriptor.fingerprint)).toBe(
      hex(e2eeKeyFingerprint("agreement", descriptor.publicKey)),
    );
    // The raw scalar is what §8 needs, so that is what is stored — no DER, no
    // envelope, and comfortably inside the store's 1..4096 byte bound.
    expect(store.values.get("e2ee-prekey.fixture")).toHaveLength(32);

    const restarted = makeNodeAgreementIdentity(store);
    expect(await restarted.getPublicDescriptor("e2ee-prekey.fixture")).toEqual(descriptor);
    // No accessor on the interface yields private material.
    expect(Object.keys(restarted).toSorted()).toEqual([
      "delete",
      "generate",
      "getPublicDescriptor",
      "withSecretKey",
    ]);
  });

  it("borrows the secret transiently and zeroizes it on every exit", async () => {
    const store = aliasingStore();
    const identity = makeNodeAgreementIdentity(store);
    const descriptor = await identity.generate("e2ee-prekey.fixture");

    // Success path: the borrow sees a live scalar that matches the public key,
    // and the buffer is dead by the time the call settles.
    let borrowed: Uint8Array | undefined;
    const derived = await identity.withSecretKey("e2ee-prekey.fixture", (secretKey) => {
      borrowed = secretKey;
      expect(hex(secretKey)).not.toBe(ZEROED);
      return hex(deriveE2eeAgreementPublicKey(secretKey));
    });
    expect(derived).toBe(hex(descriptor.publicKey));
    expect(hex(borrowed!)).toBe(ZEROED);

    // Throwing path.
    let thrown: Uint8Array | undefined;
    await expect(
      identity.withSecretKey("e2ee-prekey.fixture", (secretKey) => {
        thrown = secretKey;
        throw new Error("borrow failed");
      }),
    ).rejects.toThrow("borrow failed");
    expect(hex(thrown!)).toBe(ZEROED);

    // Rejecting path — an async borrow that settles later must not leave the
    // scalar live in the meantime.
    let rejected: Uint8Array | undefined;
    await expect(
      identity.withSecretKey("e2ee-prekey.fixture", async (secretKey) => {
        rejected = secretKey;
        await Promise.resolve();
        return Promise.reject(new Error("borrow rejected"));
      }),
    ).rejects.toThrow("borrow rejected");
    expect(hex(rejected!)).toBe(ZEROED);

    // And the descriptor path, which loads the same way.
    await identity.getPublicDescriptor("e2ee-prekey.fixture");
    expect(store.handedOut).not.toHaveLength(0);
    for (const loan of store.handedOut) expect(hex(loan)).toBe(ZEROED);
    // Custody itself is untouched: zeroization erases the loan, not the key.
    expect(hex(store.values.get("e2ee-prekey.fixture")!)).not.toBe(ZEROED);
  });

  it("zeroizes a rejected load before failing", async () => {
    // Wrong length: still key-shaped material, and the check that refuses it is
    // exactly where a missing `fill(0)` would leak.
    const store = aliasingStore(new Map([["e2ee-prekey.short", new Uint8Array(31).fill(0x7a)]]));
    const identity = makeNodeAgreementIdentity(store);

    await expect(identity.getPublicDescriptor("e2ee-prekey.short")).rejects.toMatchObject({
      code: "agreement_key_corrupt",
    });
    await expect(
      identity.withSecretKey("e2ee-prekey.short", () => "unreachable"),
    ).rejects.toMatchObject({ code: "agreement_key_corrupt" });
    expect(store.handedOut).toHaveLength(2);
    for (const loan of store.handedOut) expect(hex(loan)).toBe("0".repeat(62));
  });

  it("fails closed for missing custody and refuses to overwrite an existing key", async () => {
    const store = aliasingStore();
    const identity = makeNodeAgreementIdentity(store);
    const first = await identity.generate("e2ee-prekey.fixture");

    await expect(identity.getPublicDescriptor("e2ee-prekey.missing")).rejects.toMatchObject({
      code: "agreement_key_not_found",
    });
    await expect(
      identity.withSecretKey("e2ee-prekey.missing", () => "unreachable"),
    ).rejects.toMatchObject({ code: "agreement_key_not_found" });

    // §6.3/§6.4: the store is create-only, and that is what makes the staged
    // rotation safe — a replacement can never land on the name in service.
    await expect(identity.generate("e2ee-prekey.fixture")).rejects.toMatchObject({
      code: "agreement_key_conflict",
    });
    expect(await identity.getPublicDescriptor("e2ee-prekey.fixture")).toEqual(first);
  });

  it("keeps its errors bounded and free of key material", async () => {
    const canary = "agreement-secret-canary-value-do-not-reflect";
    const store = aliasingStore(
      new Map([["e2ee-prekey.corrupt", new TextEncoder().encode(canary)]]),
    );
    const identity = makeNodeAgreementIdentity(store);

    let error: unknown;
    try {
      await identity.getPublicDescriptor("e2ee-prekey.corrupt");
    } catch (cause) {
      error = cause;
    }
    expect(error).toBeInstanceOf(NodeAgreementIdentityError);
    expect((error as NodeAgreementIdentityError).code).toBe("agreement_key_corrupt");
    expect(String(error)).not.toContain(canary);
    expect(JSON.stringify(error)).not.toContain(canary);
  });

  it("reports a failing removal instead of pretending the key is gone", async () => {
    const store = aliasingStore();
    const identity = makeNodeAgreementIdentity(store);
    await identity.generate("e2ee-prekey.fixture");

    const failing = makeNodeAgreementIdentity({
      ...store,
      remove: async () => {
        throw new Error("credential store unavailable");
      },
    });
    await expect(failing.delete("e2ee-prekey.fixture")).rejects.toMatchObject({
      code: "agreement_key_operation_failed",
    });

    // Deleting a name that was never created is a no-op, which is what makes the
    // §6.4 sweep resumable after a crash between destroy and commit.
    await identity.delete("e2ee-prekey.absent");
    await identity.delete("e2ee-prekey.fixture");
    expect(store.values.has("e2ee-prekey.fixture")).toBe(false);
  });
});
