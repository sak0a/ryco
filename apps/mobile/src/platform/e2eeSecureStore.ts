import type { KVService } from "@ryco/client-runtime/platform";
import * as SecureStore from "expo-secure-store";

import { mobileKV } from "./kv";
import { sanitizeSecretKey } from "./secretKv";

/**
 * The device-only keychain namespace that holds relay-E2EE private material —
 * `docs/relay-e2ee-protocol.md` §6.3 (custody by endpoint), whose native-client
 * row requires the entry to be "device-only, non-synchronizing, excluded from
 * backup, restore, and device-transfer on both platforms", with an iOS
 * this-device-only accessibility class.
 *
 * A SECOND STORE, NOT A SETTING ON THE FIRST. `mobileSecretKV` holds the hosted
 * session token and the per-environment bearer tokens and passes NO options, so
 * those items sit in the library's default service under its default
 * accessibility. Changing that store's options would not migrate them: iOS
 * `SecItemUpdate` sends only `kSecValueData` (verified against
 * `expo-secure-store/ios/SecureStoreModule.swift`), so every already-written item
 * would silently keep its old class while new writes got the new one. The E2EE
 * material therefore gets its own `keychainService`, which is its own
 * `kSecAttrService` and its own Android keystore alias, and the bearer stores are
 * left exactly as they are.
 *
 * `requireAuthentication` IS NEVER PASSED. expo-secure-store folds that option
 * into a `.biometryCurrentSet` access control, so enrolling a new fingerprint or
 * re-registering a face destroys the key — and with it every pin the device
 * holds. That is the same reason the device-key module chose
 * `setUserAuthenticationRequired(false)`. Device unlock, not biometry re-enrolment
 * survivability, is the property this material needs.
 *
 * THE NAMESPACE IS ENUMERABLE BY CONSTRUCTION. Callers address entries through
 * `E2eeSecureStoreKey`, a closed union of the names below, because §6.3's
 * clone/restore prohibition requires destroying the whole namespace WITHOUT
 * reading any of it first — and neither platform lets JavaScript enumerate a
 * keychain service. A closed key set is what makes "destroy everything" a
 * complete operation instead of a best-effort one.
 */

/** The device's static X25519 agreement secret (§6.2: one per device). */
export const E2EE_AGREEMENT_SECRET_KEY = "ryco.e2ee.agreementKey.v1";

export type E2eeSecureStoreKey = typeof E2EE_AGREEMENT_SECRET_KEY;

/** Every name in the namespace, in destruction order. */
const E2EE_SECURE_STORE_KEYS: readonly E2eeSecureStoreKey[] = [E2EE_AGREEMENT_SECRET_KEY];

/**
 * Distinct from the bearer stores by construction: they pass no options at all,
 * so nothing this service names can collide with anything they wrote.
 */
export const E2EE_KEYCHAIN_SERVICE = "ryco.e2ee.v1";

/**
 * §6.3's storage class. `WHEN_UNLOCKED_THIS_DEVICE_ONLY` is both halves of the
 * iOS requirement in one attribute: the item is readable only while the device
 * is unlocked, and a `ThisDeviceOnly` item is never placed in an encrypted
 * backup, never restored onto another device, and never synchronized to iCloud
 * Keychain. Android ignores the attribute; its half of §6.3 is the backup
 * exclusion in `plugins/withAndroidSecureStoreBackupExclusion.cjs`.
 *
 * Read on first use rather than at module scope, because the constant comes from
 * the native module and this file is on the platform barrel's import graph — and
 * refused outright when it is not a number, since the alternative is writing
 * private key material under the library's default accessibility while looking
 * like it asked for something stronger.
 */
let storeOptions: SecureStore.SecureStoreOptions | undefined;
function e2eeSecureStoreOptions(): SecureStore.SecureStoreOptions {
  if (storeOptions === undefined) {
    const keychainAccessible = SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY;
    if (typeof keychainAccessible !== "number") throw new E2eeSecureStoreError();
    storeOptions = { keychainService: E2EE_KEYCHAIN_SERVICE, keychainAccessible };
  }
  return storeOptions;
}

/**
 * The plain, non-secure first-run marker (§6.3, clone and restore prohibition).
 *
 * It lives in the SQLite-backed KV precisely because that store dies with the
 * application container while keychain generic-password items survive deletion
 * and reinstall for the same bundle id. Marker absent while material is present
 * is therefore exactly the shape §6.3 forbids — a private agreement key that
 * outlived the installation that created it — and the response it mandates is to
 * destroy the material and require re-pairing (§13), not to adopt it.
 *
 * The value is a version rather than a flag so that adding a name to the
 * namespace can force one more purge instead of leaving an orphan behind.
 */
export const E2EE_INSTALL_MARKER_KEY = "ryco.e2ee.install.v1";
const E2EE_INSTALL_MARKER_VALUE = "1";

/** A bounded failure. Carries no key name, no service, and no native text. */
export class E2eeSecureStoreError extends Error {
  constructor() {
    super("Device key custody operation failed.");
    this.name = "E2eeSecureStoreError";
  }
}

/** The three calls this module makes, each with the options §6.3 requires. */
export interface E2eeSecureStoreLike {
  readonly getItemAsync: (
    key: string,
    options: SecureStore.SecureStoreOptions,
  ) => Promise<string | null>;
  readonly setItemAsync: (
    key: string,
    value: string,
    options: SecureStore.SecureStoreOptions,
  ) => Promise<void>;
  readonly deleteItemAsync: (key: string, options: SecureStore.SecureStoreOptions) => Promise<void>;
}

export interface E2eeSecureStore {
  readonly get: (key: E2eeSecureStoreKey) => Promise<string | null>;
  readonly set: (key: E2eeSecureStoreKey, value: string) => Promise<void>;
  readonly remove: (key: E2eeSecureStoreKey) => Promise<void>;
  /** Destroy every entry in the namespace (§6.3, §13 re-pairing). */
  readonly destroy: () => Promise<void>;
}

export interface E2eeSecureStoreDependencies {
  readonly store?: E2eeSecureStoreLike;
  readonly kv?: Pick<KVService, "getItem" | "setItem">;
}

/**
 * SecureStore keys are restricted to `[A-Za-z0-9._-]`, and `sanitizeSecretKey`
 * escapes everything outside `[A-Za-z0-9.-]` — including `_`, as `_005f`. Every
 * name above is already inside the passthrough set, so sanitizing is a no-op on
 * them; running it anyway means one sanitizer governs every secure-store key this
 * app writes, and `e2eeSecureStore.test.ts` pins the names as its fixed points so
 * a later name that needed escaping cannot slip in unnoticed.
 */
function storeKey(key: E2eeSecureStoreKey): string {
  return sanitizeSecretKey(key);
}

export function createE2eeSecureStore(
  dependencies: E2eeSecureStoreDependencies = {},
): E2eeSecureStore {
  const store = dependencies.store ?? SecureStore;
  const kv = dependencies.kv ?? mobileKV;

  const destroyEntries = async (): Promise<void> => {
    for (const key of E2EE_SECURE_STORE_KEYS) {
      await store.deleteItemAsync(storeKey(key), e2eeSecureStoreOptions());
    }
  };

  /**
   * §6.3's clone/restore check, run before the namespace is touched at all.
   *
   * Ordering is the whole point of it: destroy first, mark second. Marking first
   * and then failing to destroy would declare a resurrected key adopted, which is
   * the one outcome §6.3 forbids — and it forbids it "even while its
   * cross-signature remains unexpired", so no validity check may short-circuit
   * this. Destroying first and then failing to mark costs a redundant destroy on
   * the next launch and nothing else.
   *
   * Nothing is read to decide: a missing marker destroys unconditionally, so no
   * value from the previous installation is ever loaded, parsed, or used — not
   * even to find out whether one exists.
   */
  let custody: Promise<void> | undefined;
  const ensureDeviceCustody = async (): Promise<void> => {
    custody ??= (async () => {
      const marker = await kv.getItem(E2EE_INSTALL_MARKER_KEY);
      if (marker === E2EE_INSTALL_MARKER_VALUE) return;
      await destroyEntries();
      await kv.setItem(E2EE_INSTALL_MARKER_KEY, E2EE_INSTALL_MARKER_VALUE);
    })().catch((cause: unknown) => {
      // Not memoized on failure: an unreadable marker is a condition to retry,
      // and every retry runs the whole destroy-then-mark sequence again. Until
      // one completes, no accessor below reaches the store at all.
      custody = undefined;
      throw cause;
    });
    return await custody;
  };

  const bounded = async <A>(operation: () => Promise<A>): Promise<A> => {
    try {
      await ensureDeviceCustody();
      return await operation();
    } catch {
      // Native keychain and keystore errors carry status codes, item names, and
      // service names. None of that may reach a caller, a log, or a view.
      throw new E2eeSecureStoreError();
    }
  };

  return {
    get: (key) => bounded(() => store.getItemAsync(storeKey(key), e2eeSecureStoreOptions())),
    set: (key, value) =>
      bounded(() => store.setItemAsync(storeKey(key), value, e2eeSecureStoreOptions())),
    remove: (key) => bounded(() => store.deleteItemAsync(storeKey(key), e2eeSecureStoreOptions())),
    destroy: () => bounded(destroyEntries),
  };
}

export const mobileE2eeSecureStore = createE2eeSecureStore();
