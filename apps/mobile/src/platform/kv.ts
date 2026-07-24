import type { KVService } from "@ryco/client-runtime/platform";
import Storage from "expo-sqlite/kv-store";

/**
 * Plain (non-secret) key-value storage backed by expo-sqlite's kv-store, which
 * provides an SQLite-backed asynchronous store — the RN analogue of the web
 * adapter's localStorage-backed StateStorage. Secrets go through `secretKv`.
 */
export interface AsyncKeyValueStore {
  readonly getItem: (key: string) => Promise<string | null>;
  readonly setItem: (key: string, value: string) => Promise<void>;
  readonly removeItem: (key: string) => Promise<void>;
}

export function createMobileKV(store: AsyncKeyValueStore = Storage): KVService {
  return {
    getItem: (key) => store.getItem(key),
    setItem: async (key, value) => {
      await store.setItem(key, value);
    },
    removeItem: async (key) => {
      await store.removeItem(key);
    },
  };
}

export const mobileKV = createMobileKV();
