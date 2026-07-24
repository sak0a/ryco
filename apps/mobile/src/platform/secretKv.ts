import type { SecretKVService } from "@ryco/client-runtime/platform";
import * as SecureStore from "expo-secure-store";

/**
 * SecureStore keys are restricted to alphanumerics plus `.`, `-`, `_`. An
 * `EnvironmentId` may contain other characters (e.g. `:`), so escape every
 * character outside the passthrough set as `_<4-hex>`. `_` is reserved as the
 * escape introducer, which keeps the mapping collision-free.
 */
export function sanitizeSecretKey(key: string): string {
  return key.replace(
    /[^A-Za-z0-9.-]/g,
    (char) => `_${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

export interface SecureStoreLike {
  readonly getItemAsync: (key: string) => Promise<string | null>;
  readonly setItemAsync: (key: string, value: string) => Promise<void>;
  readonly deleteItemAsync: (key: string) => Promise<void>;
}

/**
 * Bearer tokens and other secrets live in the iOS Keychain / Android Keystore
 * via expo-secure-store — the RN analogue of the web adapter's LocalApi secret
 * facade. `set` returns false when the platform could not persist the secret
 * (per the contract), never throwing into the caller.
 */
export function createMobileSecretKV(store: SecureStoreLike = SecureStore): SecretKVService {
  return {
    get: (key) => store.getItemAsync(sanitizeSecretKey(key)),
    set: async (key, value) => {
      try {
        await store.setItemAsync(sanitizeSecretKey(key), value);
        return true;
      } catch {
        return false;
      }
    },
    remove: (key) => store.deleteItemAsync(sanitizeSecretKey(key)),
  };
}

export const mobileSecretKV = createMobileSecretKV();
