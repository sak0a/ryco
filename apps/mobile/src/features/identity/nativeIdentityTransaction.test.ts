import type { SecretKVService } from "@ryco/client-runtime/platform";
import { describe, expect, it } from "vitest";

import {
  createNativeIdentityTransactionStore,
  NATIVE_IDENTITY_TRANSACTION_KEY,
  type NativeIdentityTransactionRecord,
} from "./nativeIdentityTransaction";

function setup(now = 100) {
  const data = new Map<string, string>();
  const secretKV: SecretKVService = {
    get: async (key) => data.get(key) ?? null,
    set: async (key, value) => {
      data.set(key, value);
      return true;
    },
    remove: async (key) => {
      data.delete(key);
    },
  };
  return { data, store: createNativeIdentityTransactionStore(secretKV, () => now) };
}

const record: NativeIdentityTransactionRecord = {
  version: 1,
  kind: "signup",
  step: "mailbox",
  origin: "https://hub.example.test",
  attemptId: "nident_public-handle",
  attemptSecret: "opaque-attempt-secret",
  expiresAt: 200,
  presentation: "r***@example.test",
};

describe("native identity transaction storage", () => {
  it("round-trips only the bounded resumable record", async () => {
    const { store } = setup();
    await expect(store.write(record)).resolves.toBe(true);
    await expect(store.read()).resolves.toEqual(record);
  });

  it("rejects and erases expired records", async () => {
    const { data, store } = setup(300);
    data.set(NATIVE_IDENTITY_TRANSACTION_KEY, JSON.stringify(record));
    await expect(store.read()).resolves.toBeNull();
    expect(data.has(NATIVE_IDENTITY_TRANSACTION_KEY)).toBe(false);
  });

  it("never admits password, code, email, or provider assertion fields", async () => {
    const { data, store } = setup();
    data.set(
      NATIVE_IDENTITY_TRANSACTION_KEY,
      JSON.stringify({ ...record, password: "secret", email: "private@example.test" }),
    );
    // Unknown fields make the record ineligible rather than widening secret persistence.
    await expect(store.read()).resolves.toBeNull();
    expect(data.has(NATIVE_IDENTITY_TRANSACTION_KEY)).toBe(false);
  });

  it("rejects step records whose required resume secret is missing", async () => {
    const { data, store } = setup();
    data.set(
      NATIVE_IDENTITY_TRANSACTION_KEY,
      JSON.stringify({
        version: 1,
        kind: "signup",
        step: "credential",
        origin: record.origin,
        attemptId: record.attemptId,
        activationSecret: "activation",
        expiresAt: record.expiresAt,
        presentation: record.presentation,
      }),
    );
    await expect(store.read()).resolves.toBeNull();
    expect(data.has(NATIVE_IDENTITY_TRANSACTION_KEY)).toBe(false);
  });

  it("rejects a stored origin that is not an exact web origin", async () => {
    const { data, store } = setup();
    data.set(
      NATIVE_IDENTITY_TRANSACTION_KEY,
      JSON.stringify({ ...record, origin: "https://hub.example.test/identity" }),
    );
    await expect(store.read()).resolves.toBeNull();
    expect(data.has(NATIVE_IDENTITY_TRANSACTION_KEY)).toBe(false);
  });
});
