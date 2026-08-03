import { encodeBase64Url } from "@ryco/client-runtime/relay";
import { E2EE_PREKEY_LIFETIME } from "@ryco/shared/relayE2eeConstants";
import { e2eeKeyFingerprint, verifyE2eeSignature } from "@ryco/shared/relayE2eeKeys";
import { encodeClientE2eePrekeyTranscript } from "@ryco/shared/relayE2eeTranscripts";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

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

const { ensureKey, sign, hasKey, deleteKey } = vi.hoisted(() => ({
  ensureKey: vi.fn(),
  sign: vi.fn(),
  hasKey: vi.fn(),
  deleteKey: vi.fn(),
}));
vi.mock("@ryco/mobile-device-key", () => ({
  default: { ensureKey, sign, hasKey, deleteKey },
}));

import { resetMobileDeviceKeyForTests } from "./deviceKey";
import { makeMobileE2eeAgreementKey, type MobileE2eeAgreementKey } from "./e2eeAgreementKey";
import * as prekeyModule from "./e2eeClientPrekey";
import {
  clientE2eePrekeyValidity,
  CLIENT_E2EE_PREKEY_RECORD_KEY,
  makeMobileClientE2eePrekey,
  MobileClientE2eePrekeyError,
  type ClientE2eePrekeyNamespace,
} from "./e2eeClientPrekey";
import { E2EE_AGREEMENT_SECRET_KEY, type E2eeSecureStore } from "./e2eeSecureStore";

const NAMESPACE = { hubOrigin: "https://hub.example", accountId: "acct_01J8ZQ5V2N7X0000000000" };
const NOW = 1_780_000_000_000;

/**
 * A real WebCrypto P-256 key stands in for the enclave, so the signatures this
 * suite checks are real ECDSA over the real transcript bytes. The native module
 * returns DER on both platforms, so the fake returns DER too — the raw `r ‖ s`
 * §7.1 requires is `deviceKey`'s conversion, and a test that skipped it would
 * not be testing the path the device runs.
 */
let devicePublicPoint: Uint8Array;
let devicePrivateKey: CryptoKey;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const decoded = atob(value);
  return Uint8Array.from({ length: decoded.length }, (_, index) => decoded.charCodeAt(index));
}

function derInteger(coordinate: Uint8Array): number[] {
  let start = 0;
  while (start < coordinate.length - 1 && coordinate[start] === 0) start += 1;
  const trimmed = [...coordinate.subarray(start)];
  if ((trimmed[0]! & 0x80) !== 0) trimmed.unshift(0);
  return [0x02, trimmed.length, ...trimmed];
}

function rawSignatureToDer(raw: Uint8Array): Uint8Array {
  const body = [...derInteger(raw.subarray(0, 32)), ...derInteger(raw.subarray(32))];
  return Uint8Array.from([0x30, body.length, ...body]);
}

async function derSign(payloadBase64: string): Promise<string> {
  const raw = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      devicePrivateKey,
      fromBase64(payloadBase64) as BufferSource,
    ),
  );
  return toBase64(rawSignatureToDer(raw));
}

function inMemoryStore(): E2eeSecureStore {
  const entries = new Map<string, string>();
  return {
    get: async (key) => entries.get(key) ?? null,
    set: async (key, value) => {
      entries.set(key, value);
    },
    remove: async (key) => {
      entries.delete(key);
    },
    destroy: async () => {
      entries.clear();
    },
  };
}

function harness(
  overrides: {
    readonly agreementKey?: MobileE2eeAgreementKey;
    readonly now?: () => number;
    readonly record?: string;
    readonly onSetItem?: () => void;
  } = {},
) {
  const items = new Map<string, string>();
  if (overrides.record !== undefined) items.set(CLIENT_E2EE_PREKEY_RECORD_KEY, overrides.record);
  const kv = {
    getItem: async (key: string): Promise<string | null> => items.get(key) ?? null,
    setItem: async (key: string, value: string): Promise<void> => {
      overrides.onSetItem?.();
      items.set(key, value);
    },
  };
  const agreementKey = overrides.agreementKey ?? makeMobileE2eeAgreementKey(inMemoryStore());
  return {
    items,
    agreementKey,
    prekey: makeMobileClientE2eePrekey({ agreementKey, kv, now: overrides.now ?? (() => NOW) }),
  };
}

/** A fresh process: no memoized device key and no in-flight certificate. */
function restartApplication(): void {
  resetMobileDeviceKeyForTests();
  vi.clearAllMocks();
  ensureKey.mockResolvedValue({
    publicKey: toBase64(devicePublicPoint),
    backing: "secure-enclave",
  });
  sign.mockImplementation(derSign);
}

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  devicePublicPoint = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  devicePrivateKey = pair.privateKey;
});

beforeEach(() => {
  restartApplication();
});

describe("client agreement-prekey certificate (§7.4)", () => {
  it("signs the exact encoder output, and nothing else", async () => {
    // §7.2: no consumer of the device key may construct to-be-signed bytes ad
    // hoc. The bytes the enclave saw must be byte-identical to the named
    // encoder's output for the same described transcript.
    const { prekey } = harness();

    const certificate = await prekey.ensure(NAMESPACE);

    const expected = encodeClientE2eePrekeyTranscript({
      hubOrigin: NAMESPACE.hubOrigin,
      accountId: NAMESPACE.accountId,
      identityPublicKey: certificate.identityPublicKey,
      agreementPublicKey: certificate.agreementPublicKey,
      createdAt: certificate.createdAt,
      expiresAt: certificate.expiresAt,
    });
    expect([...certificate.transcript]).toEqual([...expected]);
    expect(sign).toHaveBeenCalledTimes(1);
    expect([...fromBase64(sign.mock.calls[0]![0] as string)]).toEqual([...expected]);
  });

  it("binds the device key, the agreement key, and the namespace", async () => {
    const { prekey, agreementKey } = harness();

    const certificate = await prekey.ensure(NAMESPACE);

    expect(certificate.identityPublicKey).toHaveLength(65);
    expect([...certificate.identityPublicKey]).toEqual([...devicePublicPoint]);
    expect([...certificate.agreementPublicKey]).toEqual([
      ...(await agreementKey.getPublicDescriptor()).publicKey,
    ]);
    expect(certificate.hubOrigin).toBe(NAMESPACE.hubOrigin);
    expect(certificate.accountId).toBe(NAMESPACE.accountId);
    // §7.4 element 5 is the `ryco.client-key.v1` fingerprint of element 4, which
    // the encoder recomputes rather than accepting from a caller.
    expect(e2eeKeyFingerprint("client-identity", certificate.identityPublicKey)).toHaveLength(32);
  });

  it("produces a fixed-width raw r ‖ s signature that verifies under the device key", async () => {
    const { prekey } = harness();

    const certificate = await prekey.ensure(NAMESPACE);

    expect(certificate.signature).toHaveLength(64);
    expect(
      verifyE2eeSignature({
        algorithm: "p256",
        publicKey: certificate.identityPublicKey,
        message: certificate.transcript,
        signature: certificate.signature,
      }),
    ).toBe(true);
  });

  it("uses exactly E2EE_PREKEY_LIFETIME and never exceeds it (§6.4)", async () => {
    const { prekey } = harness();

    const certificate = await prekey.ensure(NAMESPACE);

    expect(certificate.createdAt).toBe(NOW);
    expect(certificate.expiresAt - certificate.createdAt).toBe(E2EE_PREKEY_LIFETIME);
    expect(certificate.expiresAt - certificate.createdAt).toBeLessThanOrEqual(E2EE_PREKEY_LIFETIME);
  });

  it("re-signs nothing when the stored certificate is still usable", async () => {
    const { prekey } = harness();
    const first = await prekey.ensure(NAMESPACE);

    const second = await prekey.ensure(NAMESPACE);

    expect(sign).toHaveBeenCalledTimes(1);
    expect(second.createdAt).toBe(first.createdAt);
    expect([...second.transcript]).toEqual([...first.transcript]);
  });

  it("re-signs at application start when the stored certificate has expired (§6.4)", async () => {
    const clock = { value: NOW };
    const agreementStore = inMemoryStore();
    const first = await harness({
      agreementKey: makeMobileE2eeAgreementKey(agreementStore),
      now: () => clock.value,
    }).prekey.ensure(NAMESPACE);

    clock.value = first.expiresAt + E2EE_PREKEY_LIFETIME;
    restartApplication();
    const restarted = harness({
      agreementKey: makeMobileE2eeAgreementKey(agreementStore),
      now: () => clock.value,
      record: storedRecord(first),
    });

    const reissued = await restarted.prekey.ensure(NAMESPACE);

    expect(sign).toHaveBeenCalledTimes(1);
    expect(reissued.createdAt).toBe(clock.value);
    expect(reissued.expiresAt - reissued.createdAt).toBe(E2EE_PREKEY_LIFETIME);
    // §6.4's remedy is a new certificate, not a new key: the device's one static
    // agreement key (§6.2) survives the re-sign.
    expect([...reissued.agreementPublicKey]).toEqual([...first.agreementPublicKey]);
  });

  it("re-signs when the stored record names another namespace, key, or signature", async () => {
    const agreementStore = inMemoryStore();
    const first = await harness({
      agreementKey: makeMobileE2eeAgreementKey(agreementStore),
    }).prekey.ensure(NAMESPACE);
    const stored = JSON.parse(storedRecord(first)) as Record<string, unknown>;

    for (const mutation of [
      { accountId: "acct_01J8ZQ5V2N7X0000000099" },
      { hubOrigin: "https://other.example" },
      { agreementPublicKey: encodeBase64Url(new Uint8Array(32).fill(7)) },
      { identityPublicKey: encodeBase64Url(new Uint8Array(65).fill(4)) },
      { signature: encodeBase64Url(new Uint8Array(64).fill(3)) },
      { expiresAt: first.createdAt + E2EE_PREKEY_LIFETIME * 2 },
    ]) {
      restartApplication();
      const restarted = harness({
        agreementKey: makeMobileE2eeAgreementKey(agreementStore),
        record: JSON.stringify({ ...stored, ...mutation }),
      });

      const reissued = await restarted.prekey.ensure(NAMESPACE);

      expect(sign).toHaveBeenCalledTimes(1);
      expect(reissued.expiresAt - reissued.createdAt).toBe(E2EE_PREKEY_LIFETIME);
      expect(
        verifyE2eeSignature({
          algorithm: "p256",
          publicKey: reissued.identityPublicKey,
          message: reissued.transcript,
          signature: reissued.signature,
        }),
      ).toBe(true);
    }
  });

  it("survives a durable store that cannot be read or written", async () => {
    // Losing the record costs one signature at the next launch; failing the
    // certificate over a storage hiccup would take a working device off E2EE.
    const { prekey } = harness({
      record: "{ not json",
      onSetItem: () => {
        throw new Error("kv unavailable");
      },
    });

    await expect(prekey.ensure(NAMESPACE)).resolves.toMatchObject({ createdAt: NOW });
  });
});

describe("§6.4 validity", () => {
  it("classifies the window with the clock-skew allowance", () => {
    const certificate = { createdAt: NOW, expiresAt: NOW + E2EE_PREKEY_LIFETIME };

    expect(clientE2eePrekeyValidity(certificate, NOW)).toBe("usable");
    expect(clientE2eePrekeyValidity(certificate, certificate.expiresAt)).toBe("renewable");
    expect(clientE2eePrekeyValidity(certificate, certificate.expiresAt + 600_000)).toBe("expired");
    // A clock that jumped backwards past the skew allowance: the material is
    // fine, but no verifier would accept it, so re-issuing is the repair.
    expect(clientE2eePrekeyValidity(certificate, NOW - 600_000)).toBe("expired");
  });
});

describe("custody failures", () => {
  it("refuses with a bounded code when the device key is unavailable", async () => {
    ensureKey.mockResolvedValue({ publicKey: toBase64(devicePublicPoint), backing: "unavailable" });
    const { prekey } = harness();

    const failure = await failureOf(prekey.ensure(NAMESPACE));

    expect(failure).toBeInstanceOf(MobileClientE2eePrekeyError);
    expect(failure?.code).toBe("e2ee_prekey_custody_failed");
    expect(failure?.message).toBe("Device E2EE prekey operation failed.");
    expect(sign).not.toHaveBeenCalled();
  });

  it("refuses when the agreement key cannot be held, with no fallback key", async () => {
    const failing: E2eeSecureStore = {
      get: async () => {
        throw new Error(`SecItemCopyMatching -25300 for ${E2EE_AGREEMENT_SECRET_KEY}`);
      },
      set: async () => {},
      remove: async () => {},
      destroy: async () => {},
    };
    const { prekey } = harness({ agreementKey: makeMobileE2eeAgreementKey(failing) });

    const failure = await failureOf(prekey.ensure(NAMESPACE));

    expect(failure?.code).toBe("e2ee_prekey_custody_failed");
    for (const detail of [E2EE_AGREEMENT_SECRET_KEY, "25300", "SecItemCopyMatching"]) {
      expect(failure?.message).not.toContain(detail);
    }
    expect(sign).not.toHaveBeenCalled();
  });

  it("refuses a namespace that cannot be represented in a §7.4 transcript", async () => {
    const { prekey } = harness();

    for (const namespace of [
      { hubOrigin: "http://insecure.example", accountId: NAMESPACE.accountId },
      { hubOrigin: NAMESPACE.hubOrigin, accountId: "" },
    ]) {
      const failure = await failureOf(prekey.ensure(namespace));
      expect(failure?.code).toBe("e2ee_prekey_unavailable");
    }
    expect(sign).not.toHaveBeenCalled();
  });
});

describe("no ad-hoc transcripts (§7.2)", () => {
  it("exports nothing that accepts bytes to sign", () => {
    // The regression guard: the exact export list fails as soon as a raw-bytes
    // signing entry point is added anywhere in this module.
    const exported = Object.keys(prekeyModule).toSorted();

    expect(exported).toEqual([
      "CLIENT_E2EE_PREKEY_RECORD_KEY",
      "MobileClientE2eePrekeyError",
      "clientE2eePrekeyValidity",
      "makeMobileClientE2eePrekey",
      "mobileClientE2eePrekey",
    ]);
    for (const name of exported) {
      expect(name.toLowerCase()).not.toContain("sign");
    }
  });

  it("takes a described namespace, not bytes", async () => {
    const { prekey } = harness();

    expect(Object.keys(prekey)).toEqual(["ensure"]);
    const failure = await failureOf(
      prekey.ensure(new Uint8Array(32) as unknown as ClientE2eePrekeyNamespace),
    );

    expect(failure?.code).toBe("e2ee_prekey_unavailable");
    expect(sign).not.toHaveBeenCalled();
  });
});

function storedRecord(certificate: {
  readonly hubOrigin: string;
  readonly accountId: string;
  readonly identityPublicKey: Uint8Array;
  readonly agreementPublicKey: Uint8Array;
  readonly signature: Uint8Array;
  readonly createdAt: number;
  readonly expiresAt: number;
}): string {
  return JSON.stringify({
    hubOrigin: certificate.hubOrigin,
    accountId: certificate.accountId,
    identityPublicKey: encodeBase64Url(certificate.identityPublicKey),
    agreementPublicKey: encodeBase64Url(certificate.agreementPublicKey),
    signature: encodeBase64Url(certificate.signature),
    createdAt: certificate.createdAt,
    expiresAt: certificate.expiresAt,
  });
}

async function failureOf(operation: Promise<unknown>): Promise<MobileClientE2eePrekeyError | null> {
  return await operation.then(
    () => null,
    (error: unknown) => error as MobileClientE2eePrekeyError,
  );
}
