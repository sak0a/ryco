import { afterEach, describe, expect, it, vi } from "vite-plus/test";

// A sentinel rather than the real constant: the E2EE store must pass THE
// library's `WHEN_UNLOCKED_THIS_DEVICE_ONLY` value through, and comparing two
// copies of the same literal would pass even if the option were dropped.
//
// Mutable, because the two things this suite has to be able to present are a
// runtime where the constant is missing (`undefined`, which is what the whole
// Android module set looks like from JavaScript and what a stripped iOS native
// module looks like) and a platform that is not iOS.
const { WHEN_UNLOCKED_THIS_DEVICE_ONLY, library, platform } = vi.hoisted(() => {
  const accessible = 0xd;
  return {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: accessible,
    library: { accessible: accessible as number | undefined },
    platform: { OS: "ios" as "ios" | "android" | "web" },
  };
});

vi.mock("expo-secure-store", () => ({
  get WHEN_UNLOCKED_THIS_DEVICE_ONLY() {
    return library.accessible;
  },
  getItemAsync: async () => null,
  setItemAsync: async () => {},
  deleteItemAsync: async () => {},
}));
vi.mock("react-native", () => ({ Platform: platform }));
vi.mock("expo-sqlite/kv-store", () => ({
  default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));

import {
  createE2eeSecureStore,
  E2EE_ACCOUNT_ENROLLMENT_ID_KEY,
  E2EE_ACCOUNT_TRUST_DOCUMENT_KEY,
  E2EE_AGREEMENT_SECRET_KEY,
  E2EE_INSTALL_MARKER_KEY,
  E2EE_KEYCHAIN_SERVICE,
  E2EE_SECURE_STORE_KEYS,
  E2EE_TRUST_DOCUMENT_KEY,
  E2eeSecureStoreError,
  type E2eeSecureStoreLike,
} from "./e2eeSecureStore";
import { createMobileSecretKV, sanitizeSecretKey } from "./secretKv";
import { HOSTED_SESSION_TOKEN_KEY } from "./sessionCredentials";

interface Call {
  readonly operation: "get" | "set" | "delete";
  readonly key: string;
  readonly options: unknown;
}

/**
 * A stateful fake namespace, so a destroy really removes and a later read really
 * sees nothing. `resurrected` seeds material from a previous installation.
 */
function harness(
  overrides: {
    readonly marker?: string | null;
    readonly resurrected?: string;
    readonly onGet?: () => void;
    readonly onDelete?: () => void;
    readonly onMarkerWrite?: () => void;
  } = {},
) {
  const calls: Call[] = [];
  const entries = new Map<string, string>();
  if (overrides.resurrected !== undefined) {
    entries.set(E2EE_AGREEMENT_SECRET_KEY, overrides.resurrected);
  }
  const store: E2eeSecureStoreLike = {
    getItemAsync: async (key, options) => {
      calls.push({ operation: "get", key, options });
      overrides.onGet?.();
      return entries.get(key) ?? null;
    },
    setItemAsync: async (key, value, options) => {
      calls.push({ operation: "set", key, options });
      entries.set(key, value);
    },
    deleteItemAsync: async (key, options) => {
      calls.push({ operation: "delete", key, options });
      overrides.onDelete?.();
      entries.delete(key);
    },
  };
  const marker = { value: overrides.marker ?? null };
  const kv = {
    getItem: async (key: string): Promise<string | null> =>
      key === E2EE_INSTALL_MARKER_KEY ? marker.value : null,
    setItem: async (key: string, value: string): Promise<void> => {
      overrides.onMarkerWrite?.();
      if (key === E2EE_INSTALL_MARKER_KEY) marker.value = value;
    },
  };
  return { calls, entries, marker, store: createE2eeSecureStore({ store, kv }) };
}

afterEach(() => {
  library.accessible = WHEN_UNLOCKED_THIS_DEVICE_ONLY;
  platform.OS = "ios";
});

describe("E2EE keychain namespace (§6.3 storage class)", () => {
  it("writes with a this-device-only class and its own keychain service", async () => {
    const { calls, store } = harness({ marker: "1" });

    await store.set(E2EE_AGREEMENT_SECRET_KEY, "secret");

    expect(calls).toEqual([
      {
        operation: "set",
        key: E2EE_AGREEMENT_SECRET_KEY,
        options: {
          keychainService: E2EE_KEYCHAIN_SERVICE,
          keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        },
      },
    ]);
  });

  it("never passes requireAuthentication on any operation", async () => {
    // expo-secure-store folds `requireAuthentication` into a `.biometryCurrentSet`
    // access control, so enrolling a new fingerprint would destroy the agreement
    // key and every pin taken against it.
    const { calls, store } = harness({ marker: "1" });

    await store.set(E2EE_AGREEMENT_SECRET_KEY, "secret");
    await store.get(E2EE_AGREEMENT_SECRET_KEY);
    await store.remove(E2EE_AGREEMENT_SECRET_KEY);

    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(call.options).not.toHaveProperty("requireAuthentication");
      expect(call.options).not.toHaveProperty("authenticationPrompt");
    }
  });

  it("reads and deletes under the same service it wrote under", async () => {
    // iOS resolves a keychain item by `kSecAttrService`; a read or a delete under
    // the default service would silently miss the item entirely.
    const { calls, store } = harness({ marker: "1" });

    await store.get(E2EE_AGREEMENT_SECRET_KEY);
    await store.remove(E2EE_AGREEMENT_SECRET_KEY);

    for (const call of calls) {
      expect(call.options).toMatchObject({ keychainService: E2EE_KEYCHAIN_SERVICE });
    }
  });

  it("refuses on iOS when the accessibility constant is missing, without reaching the store", async () => {
    // expo-secure-store's iOS default is `.whenUnlocked` — NOT this-device-only —
    // so a stripped native module, an upgrade that renamed the constant, or any
    // build where it resolves `undefined` would put the static X25519 agreement
    // secret into an item that encrypted backups carry and another device can
    // restore. §6.3 forbids exactly that, so the refusal is the only outcome.
    library.accessible = undefined;
    const { calls, store } = harness({ marker: "1" });

    for (const operation of [
      () => store.get(E2EE_AGREEMENT_SECRET_KEY),
      () => store.set(E2EE_AGREEMENT_SECRET_KEY, "secret"),
      () => store.remove(E2EE_AGREEMENT_SECRET_KEY),
      () => store.destroy(),
    ]) {
      await expect(operation()).rejects.toBeInstanceOf(E2eeSecureStoreError);
    }
    expect(calls).toHaveLength(0);
  });

  it("writes on Android, where the accessibility option is iOS-only", async () => {
    // `keychainAccessible` is `@platform ios` and the Android native module
    // declares no constants at all, so `WHEN_UNLOCKED_THIS_DEVICE_ONLY` is
    // `undefined` there. Requiring it would refuse every E2EE operation on the
    // platform — no agreement key, no §7.4 certificate, ever. Android's half of
    // §6.3 is the keystore key plus the backup exclusion config plugin.
    platform.OS = "android";
    library.accessible = undefined;
    const { calls, entries, store } = harness({ marker: "1" });

    await store.set(E2EE_AGREEMENT_SECRET_KEY, "secret");
    await expect(store.get(E2EE_AGREEMENT_SECRET_KEY)).resolves.toBe("secret");

    expect(entries.get(E2EE_AGREEMENT_SECRET_KEY)).toBe("secret");
    for (const call of calls) {
      expect(call.options).toEqual({ keychainService: E2EE_KEYCHAIN_SERVICE });
      expect(call.options).not.toHaveProperty("keychainAccessible");
    }
  });

  it("refuses on any platform §6.3 gives no durable private-key home", async () => {
    // §6.3's only other row is web, whose private-key home is process memory.
    platform.OS = "web";
    const { calls, store } = harness({ marker: "1" });

    await expect(store.set(E2EE_AGREEMENT_SECRET_KEY, "secret")).rejects.toBeInstanceOf(
      E2eeSecureStoreError,
    );
    expect(calls).toHaveLength(0);
  });

  it("uses key names that survive sanitizeSecretKey unchanged", () => {
    // `sanitizeSecretKey` escapes everything outside `[A-Za-z0-9.-]`, including
    // `_` as `_005f`. A name that needed escaping would still work, but the
    // stored name would stop matching the constant, so both are pinned here.
    for (const key of [...E2EE_SECURE_STORE_KEYS, E2EE_INSTALL_MARKER_KEY]) {
      expect(sanitizeSecretKey(key)).toBe(key);
      expect(key).toMatch(/^[A-Za-z0-9.-]+$/);
    }
  });

  it("leaves the bearer-token store's call sites untouched", async () => {
    // iOS `SecItemUpdate` sends only `kSecValueData`, so adding options to the
    // SHARED store would leave every already-written token in its old
    // accessibility class while new writes got the new one. The bearer store
    // must therefore keep passing no options at all — which is also what makes
    // its service distinct from the E2EE one.
    const calls: unknown[][] = [];
    const secretKV = createMobileSecretKV({
      getItemAsync: async (...args: unknown[]) => {
        calls.push(args);
        return null;
      },
      setItemAsync: async (...args: unknown[]) => {
        calls.push(args);
      },
      deleteItemAsync: async (...args: unknown[]) => {
        calls.push(args);
      },
    });

    await secretKV.set(HOSTED_SESSION_TOKEN_KEY, "token");
    await secretKV.get("env:local");
    await secretKV.remove("env:local");

    expect(calls).toEqual([
      [sanitizeSecretKey(HOSTED_SESSION_TOKEN_KEY), "token"],
      [sanitizeSecretKey("env:local")],
      [sanitizeSecretKey("env:local")],
    ]);
  });
});

describe("device custody (§6.3 clone and restore prohibition)", () => {
  it("destroys the namespace before reading anything when the marker is absent", async () => {
    // A reinstall on iOS: the application container — and with it the marker — is
    // gone, but keychain generic-password items survive for the same bundle id.
    // Material that outlived its installation is restored material.
    const { calls, entries, marker, store } = harness({
      marker: null,
      resurrected: "a-previous-installations-agreement-key",
    });

    const value = await store.get(E2EE_AGREEMENT_SECRET_KEY);

    expect(calls.map((call) => call.operation)).toEqual([
      ...E2EE_SECURE_STORE_KEYS.map(() => "delete"),
      "get",
    ]);
    expect(calls.slice(0, E2EE_SECURE_STORE_KEYS.length).map((call) => call.key)).toEqual([
      ...E2EE_SECURE_STORE_KEYS,
    ]);
    // The only read is the caller's own, and it lands on an empty namespace:
    // nothing of the resurrected material was read, parsed, or returned.
    expect(value).toBeNull();
    expect(entries.size).toBe(0);
    expect(marker.value).toBe("1");
  });

  it("destroys even while a cross-signature would still be unexpired", async () => {
    // §6.3 forbids adopting restored material "even while its cross-signature
    // remains unexpired", so no validity check may short-circuit the destroy —
    // and none can, because nothing is read to decide.
    let readBeforeDestroy = false;
    const { calls, store } = harness({
      marker: null,
      resurrected: "unexpired-material",
      onDelete: () => {
        readBeforeDestroy ||= calls.some((call) => call.operation === "get");
      },
    });

    await store.get(E2EE_AGREEMENT_SECRET_KEY);

    expect(readBeforeDestroy).toBe(false);
    expect(calls[0]).toMatchObject({ operation: "delete", key: E2EE_AGREEMENT_SECRET_KEY });
  });

  it("runs the purge once, before every accessor, and not again", async () => {
    const { calls, store } = harness({ marker: null, resurrected: "old" });

    await store.get(E2EE_AGREEMENT_SECRET_KEY);
    await store.set(E2EE_AGREEMENT_SECRET_KEY, "fresh");
    await store.get(E2EE_AGREEMENT_SECRET_KEY);

    expect(calls.filter((call) => call.operation === "delete")).toHaveLength(
      E2EE_SECURE_STORE_KEYS.length,
    );
    expect(calls[0]?.operation).toBe("delete");
  });

  it("purges before a concurrent first read reaches the store", async () => {
    const { calls, store } = harness({ marker: null, resurrected: "old" });

    const [first, second] = await Promise.all([
      store.get(E2EE_AGREEMENT_SECRET_KEY),
      store.get(E2EE_AGREEMENT_SECRET_KEY),
    ]);

    expect(calls.filter((call) => call.operation === "delete")).toHaveLength(
      E2EE_SECURE_STORE_KEYS.length,
    );
    expect(calls[0]?.operation).toBe("delete");
    expect([first, second]).toEqual([null, null]);
  });

  it("skips the purge when the marker says this installation created the key", async () => {
    const { calls, store } = harness({ marker: "1", resurrected: "ours" });

    await expect(store.get(E2EE_AGREEMENT_SECRET_KEY)).resolves.toBe("ours");
    expect(calls.map((call) => call.operation)).toEqual(["get"]);
  });

  it("fails closed, without reading, when the destroy fails", async () => {
    // Marking first and destroying second would declare resurrected material
    // adopted the moment the destroy failed, so the order is fixed and a failed
    // destroy refuses the operation outright.
    const { calls, marker, store } = harness({
      marker: null,
      resurrected: "old",
      onDelete: () => {
        throw new Error(`keychain -25300 for ${E2EE_AGREEMENT_SECRET_KEY}`);
      },
    });

    await expect(store.get(E2EE_AGREEMENT_SECRET_KEY)).rejects.toBeInstanceOf(E2eeSecureStoreError);
    expect(calls.some((call) => call.operation === "get")).toBe(false);
    expect(marker.value).toBeNull();
  });

  it("fails closed when the marker cannot be written after the destroy", async () => {
    const { calls, store } = harness({
      marker: null,
      onMarkerWrite: () => {
        throw new Error("kv unavailable");
      },
    });

    await expect(store.get(E2EE_AGREEMENT_SECRET_KEY)).rejects.toBeInstanceOf(E2eeSecureStoreError);
    expect(calls.some((call) => call.operation === "get")).toBe(false);
  });

  it("retries the purge on the next call rather than memoizing the failure", async () => {
    let failing = true;
    const { calls, store } = harness({
      marker: null,
      resurrected: "old",
      onDelete: () => {
        if (failing) throw new Error("keychain busy");
      },
    });

    await expect(store.get(E2EE_AGREEMENT_SECRET_KEY)).rejects.toBeInstanceOf(E2eeSecureStoreError);
    failing = false;
    await expect(store.get(E2EE_AGREEMENT_SECRET_KEY)).resolves.toBeNull();

    expect(calls.filter((call) => call.operation === "delete")).toHaveLength(
      E2EE_SECURE_STORE_KEYS.length + 1,
    );
    expect(calls.filter((call) => call.operation === "get")).toHaveLength(1);
  });
});

describe("namespace destruction (§6.3, §13 re-pairing)", () => {
  it("removes every name in the namespace", async () => {
    // §6.3's clone/restore purge and §13's re-pairing both run through here, and
    // "destroy the namespace" is only complete because the key set is closed.
    const { calls, entries, store } = harness({ marker: "1", resurrected: "ours" });

    await store.destroy();

    expect(entries.size).toBe(0);
    // Every name, not just the one this case seeded: the key set is closed
    // precisely so a destroy is complete rather than best-effort, and a name
    // added to the union without joining it would show up here.
    expect(calls.map((call) => call.key)).toEqual([...E2EE_SECURE_STORE_KEYS]);
    expect([...E2EE_SECURE_STORE_KEYS]).toContain(E2EE_TRUST_DOCUMENT_KEY);
    expect([...E2EE_SECURE_STORE_KEYS]).toContain(E2EE_ACCOUNT_ENROLLMENT_ID_KEY);
    expect([...E2EE_SECURE_STORE_KEYS]).toContain(E2EE_ACCOUNT_TRUST_DOCUMENT_KEY);
    await expect(store.get(E2EE_AGREEMENT_SECRET_KEY)).resolves.toBeNull();
  });

  it("reports a failed destroy rather than resolving as if it had run", async () => {
    // A silently swallowed rejection would leave the device's static agreement
    // secret in the keychain after a logout or a forced re-pair.
    const { store } = harness({
      marker: "1",
      resurrected: "ours",
      onDelete: () => {
        throw new Error(`keychain -25300 for ${E2EE_AGREEMENT_SECRET_KEY}`);
      },
    });

    await expect(store.destroy()).rejects.toBeInstanceOf(E2eeSecureStoreError);
  });
});

describe("bounded failures", () => {
  it("never carries the keychain, the key, or a native status out of a failure", async () => {
    const { store } = harness({
      marker: "1",
      onGet: () => {
        throw new Error(
          `SecItemCopyMatching -25300 for ${E2EE_AGREEMENT_SECRET_KEY} in ${E2EE_KEYCHAIN_SERVICE} at /var/mobile/Keychains/keychain-2.db`,
        );
      },
    });

    const failure = await store.get(E2EE_AGREEMENT_SECRET_KEY).then(
      () => null,
      (error: unknown) => error as Error,
    );

    expect(failure).toBeInstanceOf(E2eeSecureStoreError);
    expect(failure?.message).toBe("Device key custody operation failed.");
    for (const detail of [
      E2EE_AGREEMENT_SECRET_KEY,
      E2EE_KEYCHAIN_SERVICE,
      "25300",
      "keychain-2.db",
      "/var/mobile",
    ]) {
      expect(failure?.message).not.toContain(detail);
    }
    expect((failure as { cause?: unknown } | null)?.cause).toBeUndefined();
  });
});
