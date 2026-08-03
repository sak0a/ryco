import { encodeBase64Url } from "@ryco/client-runtime/relay";
import {
  deriveE2eeAgreementPublicKey,
  e2eeKeyFingerprint,
  E2EE_AGREEMENT_ALGORITHM,
} from "@ryco/shared/relayE2eeKeys";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 0xd,
  getItemAsync: async () => null,
  setItemAsync: async () => {},
  deleteItemAsync: async () => {},
}));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("expo-sqlite/kv-store", () => ({
  default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));

const { preflight } = vi.hoisted(() => ({ preflight: vi.fn() }));
vi.mock("./e2eeRuntime", () => ({ assertE2eeRuntimeGlobals: preflight }));

import * as agreementModule from "./e2eeAgreementKey";
import {
  makeMobileE2eeAgreementKey,
  MobileE2eeAgreementKeyError,
  type MobileE2eeAgreementKeyErrorCode,
} from "./e2eeAgreementKey";
import { E2EE_AGREEMENT_SECRET_KEY, type E2eeSecureStore } from "./e2eeSecureStore";

interface Fake {
  readonly entries: Map<string, string>;
  readonly writes: string[];
  readonly store: E2eeSecureStore;
}

function fakeStore(
  overrides: {
    readonly seeded?: string;
    readonly onGet?: () => void;
    readonly onSet?: () => void;
    readonly onRemove?: () => void;
  } = {},
): Fake {
  const entries = new Map<string, string>();
  if (overrides.seeded !== undefined) entries.set(E2EE_AGREEMENT_SECRET_KEY, overrides.seeded);
  const writes: string[] = [];
  return {
    entries,
    writes,
    store: {
      get: async (key) => {
        overrides.onGet?.();
        return entries.get(key) ?? null;
      },
      set: async (key, value) => {
        overrides.onSet?.();
        writes.push(value);
        entries.set(key, value);
      },
      remove: async (key) => {
        overrides.onRemove?.();
        entries.delete(key);
      },
      destroy: async () => {
        entries.clear();
      },
    },
  };
}

async function codeOf(
  operation: Promise<unknown>,
): Promise<MobileE2eeAgreementKeyErrorCode | "resolved"> {
  return await operation.then(
    () => "resolved" as const,
    (error: unknown) => {
      if (error instanceof MobileE2eeAgreementKeyError) return error.code;
      throw error;
    },
  );
}

/**
 * Records every `Uint8Array.prototype.fill`, with the contents the array held
 * before it ran, and restores the original in a `finally`.
 *
 * Patching a built-in is not a habit worth having, and it is the only instrument
 * available here: the rejection paths erase buffers this suite never gets a
 * reference to — the module decodes them and drops them — and a zeroization that
 * only happens on the success path is exactly the gap this discipline exists to
 * prevent.
 */
function recordZeroFills(): { readonly filled: readonly number[][]; readonly restore: () => void } {
  const filled: number[][] = [];
  const original = Uint8Array.prototype.fill;
  // eslint-disable-next-line no-extend-native -- see above; restored below
  Uint8Array.prototype.fill = function fill(
    this: Uint8Array,
    ...args: Parameters<typeof original>
  ) {
    if (args[0] === 0) filled.push([...this]);
    return original.apply(this, args) as Uint8Array;
  } as typeof original;
  return {
    filled,
    restore: () => {
      // eslint-disable-next-line no-extend-native -- restores the original
      Uint8Array.prototype.fill = original;
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  preflight.mockReset();
});

describe("device agreement key (§6.2, §6.3)", () => {
  it("generates a key, stores it, and reports only its public half", async () => {
    const fake = fakeStore();
    const agreement = makeMobileE2eeAgreementKey(fake.store);

    const descriptor = await agreement.generate();

    expect(descriptor.algorithm).toBe(E2EE_AGREEMENT_ALGORITHM);
    expect(descriptor.publicKey).toHaveLength(32);
    expect([...descriptor.fingerprint]).toEqual([
      ...e2eeKeyFingerprint("agreement", descriptor.publicKey),
    ]);
    expect(fake.entries.size).toBe(1);
    // What was stored is the SECRET, and it is not the public key.
    const stored = fake.entries.get(E2EE_AGREEMENT_SECRET_KEY)!;
    expect(stored).not.toBe(encodeBase64Url(descriptor.publicKey));
    expect(Object.keys(descriptor).toSorted()).toEqual(["algorithm", "fingerprint", "publicKey"]);
  });

  it("derives the same public key it stored a secret for", async () => {
    const fake = fakeStore();
    const agreement = makeMobileE2eeAgreementKey(fake.store);

    const generated = await agreement.generate();
    const read = await agreement.getPublicDescriptor();

    expect([...read.publicKey]).toEqual([...generated.publicKey]);
    await agreement.withSecretKey((secretKey) => {
      expect([...deriveE2eeAgreementPublicKey(secretKey)]).toEqual([...generated.publicKey]);
    });
  });

  it("gates generation on the §14.5 preflight, before it draws or writes", async () => {
    // §14.5 is fail-closed and this is the first thing in the app that draws key
    // material, so a refusal here means E2EE is unavailable on this device —
    // never a weaker key.
    let touched = false;
    const fake = fakeStore({ onGet: () => (touched = true), onSet: () => (touched = true) });
    preflight.mockImplementation(() => {
      throw new Error("End-to-end encryption requires a cryptographic random source…");
    });
    const agreement = makeMobileE2eeAgreementKey(fake.store);

    await expect(codeOf(agreement.generate())).resolves.toBe("agreement_key_runtime_unavailable");
    expect(preflight).toHaveBeenCalledTimes(1);
    expect(touched).toBe(false);
    expect(fake.entries.size).toBe(0);
  });

  it("runs the preflight on every generation", async () => {
    const agreement = makeMobileE2eeAgreementKey(fakeStore().store);

    await agreement.generate();

    expect(preflight).toHaveBeenCalledTimes(1);
  });

  it("is create-only: a second generate conflicts and never overwrites", async () => {
    const fake = fakeStore();
    const agreement = makeMobileE2eeAgreementKey(fake.store);
    const first = await agreement.generate();
    const stored = fake.entries.get(E2EE_AGREEMENT_SECRET_KEY);

    await expect(codeOf(agreement.generate())).resolves.toBe("agreement_key_conflict");

    expect(fake.entries.get(E2EE_AGREEMENT_SECRET_KEY)).toBe(stored);
    expect(fake.writes).toHaveLength(1);
    expect([...(await agreement.getPublicDescriptor()).publicKey]).toEqual([...first.publicKey]);
  });

  it("serializes concurrent generation so only one key is ever minted", async () => {
    const fake = fakeStore();
    const agreement = makeMobileE2eeAgreementKey(fake.store);

    const outcomes = await Promise.all([
      codeOf(agreement.generate()),
      codeOf(agreement.generate()),
    ]);

    expect(outcomes.filter((code) => code === "resolved")).toHaveLength(1);
    expect(outcomes.filter((code) => code === "agreement_key_conflict")).toHaveLength(1);
    expect(fake.writes).toHaveLength(1);
  });
});

describe("key loss and store failure", () => {
  it("refuses with a distinct code when the store holds no key", async () => {
    const agreement = makeMobileE2eeAgreementKey(fakeStore().store);

    await expect(codeOf(agreement.getPublicDescriptor())).resolves.toBe("agreement_key_not_found");
    await expect(codeOf(agreement.withSecretKey(() => 1))).resolves.toBe("agreement_key_not_found");
  });

  it("refuses, rather than minting a replacement, when the store throws", async () => {
    // A store that throws is not a store that reported "no key". Conflating the
    // two would let a transient keychain failure look like a first run and mint a
    // second key that no §7.4 certificate covers.
    const fake = fakeStore({
      onGet: () => {
        throw new Error("SecItemCopyMatching -25300");
      },
    });
    const agreement = makeMobileE2eeAgreementKey(fake.store);

    await expect(codeOf(agreement.getPublicDescriptor())).resolves.toBe(
      "agreement_key_operation_failed",
    );
    await expect(codeOf(agreement.generate())).resolves.toBe("agreement_key_operation_failed");
    expect(fake.writes).toHaveLength(0);
  });

  it("has no software fallback and no degraded mode", async () => {
    // Every accessor either produces hardware-store-backed material or throws;
    // none of them returns a usable stand-in.
    const fake = fakeStore({
      onGet: () => {
        throw new Error("keystore unavailable");
      },
    });
    const agreement = makeMobileE2eeAgreementKey(fake.store);

    for (const operation of [
      () => agreement.generate(),
      () => agreement.getPublicDescriptor(),
      () => agreement.withSecretKey(() => "used"),
    ]) {
      await expect(operation()).rejects.toBeInstanceOf(MobileE2eeAgreementKeyError);
    }
  });

  it("keeps every failure bounded and free of the keychain, the key, and the path", async () => {
    const fake = fakeStore({
      onGet: () => {
        throw new Error(
          `SecItemCopyMatching -25300 for ${E2EE_AGREEMENT_SECRET_KEY} at /var/mobile/Keychains/keychain-2.db`,
        );
      },
    });
    const agreement = makeMobileE2eeAgreementKey(fake.store);

    const failure = await agreement.getPublicDescriptor().then(
      () => null,
      (error: unknown) => error as MobileE2eeAgreementKeyError,
    );

    expect(failure?.message).toBe("Device agreement key operation failed.");
    for (const detail of [
      E2EE_AGREEMENT_SECRET_KEY,
      "25300",
      "keychain-2.db",
      "/var/mobile",
      "Keychain",
    ]) {
      expect(failure?.message).not.toContain(detail);
    }
    expect((failure as { cause?: unknown } | null)?.cause).toBeUndefined();
  });

  it("rejects a stored value that is not a 32-byte scalar", async () => {
    for (const seeded of [encodeBase64Url(new Uint8Array(16)), "not base64url!!"]) {
      const agreement = makeMobileE2eeAgreementKey(fakeStore({ seeded }).store);
      await expect(codeOf(agreement.getPublicDescriptor())).resolves.toBe("agreement_key_corrupt");
    }
  });
});

describe("borrow window (§6.3)", () => {
  it("zeroizes the borrowed scalar after the borrow returns", async () => {
    const agreement = makeMobileE2eeAgreementKey(fakeStore().store);
    await agreement.generate();

    let borrowed: Uint8Array | null = null;
    await agreement.withSecretKey((secretKey) => {
      borrowed = secretKey;
      expect([...secretKey].some((byte) => byte !== 0)).toBe(true);
    });

    expect([...borrowed!]).toEqual(Array.from<number>({ length: 32 }).fill(0));
  });

  it("zeroizes the borrowed scalar when the borrow throws", async () => {
    const agreement = makeMobileE2eeAgreementKey(fakeStore().store);
    await agreement.generate();

    let borrowed: Uint8Array | null = null;
    await expect(
      agreement.withSecretKey((secretKey) => {
        borrowed = secretKey;
        throw new Error("handshake failed");
      }),
    ).rejects.toThrow("handshake failed");

    expect([...borrowed!]).toEqual(Array.from<number>({ length: 32 }).fill(0));
  });

  it("zeroizes the borrowed scalar when the borrow rejects", async () => {
    const agreement = makeMobileE2eeAgreementKey(fakeStore().store);
    await agreement.generate();

    let borrowed: Uint8Array | null = null;
    await expect(
      agreement.withSecretKey(async (secretKey) => {
        borrowed = secretKey;
        await Promise.resolve();
        throw new Error("rejected later");
      }),
    ).rejects.toThrow("rejected later");

    expect([...borrowed!]).toEqual(Array.from<number>({ length: 32 }).fill(0));
  });

  it("zeroizes a wrong-length scalar on the corrupt rejection path", async () => {
    // Key-shaped material that failed the length check is still key-shaped
    // material; leaving it in a live buffer because the check failed would be
    // the one leak this discipline exists to prevent.
    const corrupt = Uint8Array.from({ length: 16 }, (_, index) => index + 1);
    const agreement = makeMobileE2eeAgreementKey(
      fakeStore({ seeded: encodeBase64Url(corrupt) }).store,
    );
    const recorder = recordZeroFills();

    try {
      await expect(codeOf(agreement.withSecretKey(() => 1))).resolves.toBe("agreement_key_corrupt");
    } finally {
      recorder.restore();
    }

    expect(recorder.filled).toContainEqual([...corrupt]);
  });

  it("erases the generated scalar even when the write fails", async () => {
    const fake = fakeStore({
      onSet: () => {
        throw new Error("keystore write failed");
      },
    });
    const agreement = makeMobileE2eeAgreementKey(fake.store);
    const recorder = recordZeroFills();

    try {
      await expect(codeOf(agreement.generate())).resolves.toBe("agreement_key_operation_failed");
    } finally {
      recorder.restore();
    }

    expect(recorder.filled.some((bytes) => bytes.length === 32 && bytes.some((b) => b !== 0))).toBe(
      true,
    );
  });
});

describe("key separation (§6.2)", () => {
  it("exposes no signing function on the module", () => {
    // §6.2's rule is absolute — the identity key never performs key agreement and
    // the agreement key never signs — and this is where the rule is structural
    // rather than a comment: a future caller cannot reach a signer from here.
    const exported = Object.keys(agreementModule).toSorted();

    expect(exported).toEqual([
      "MobileE2eeAgreementKeyError",
      "makeMobileE2eeAgreementKey",
      "mobileE2eeAgreementKey",
    ]);
    for (const name of exported) {
      expect(name.toLowerCase()).not.toContain("sign");
    }
  });

  it("exposes no signing function on the key it builds", () => {
    const agreement = makeMobileE2eeAgreementKey(fakeStore().store);

    expect(Object.keys(agreement).toSorted()).toEqual([
      "delete",
      "generate",
      "getPublicDescriptor",
      "withSecretKey",
    ]);
    for (const [name, member] of Object.entries(agreement)) {
      expect(name.toLowerCase()).not.toContain("sign");
      expect(typeof member).toBe("function");
    }
  });

  it("returns no accessor that yields the secret", async () => {
    const agreement = makeMobileE2eeAgreementKey(fakeStore().store);
    const descriptor = await agreement.generate();

    // The descriptor is public material only, and the borrow — the single path
    // to the scalar — returns the callback's value rather than the scalar.
    expect(Object.keys(descriptor).toSorted()).toEqual(["algorithm", "fingerprint", "publicKey"]);
    await expect(agreement.withSecretKey(() => "borrowed")).resolves.toBe("borrowed");
  });
});
