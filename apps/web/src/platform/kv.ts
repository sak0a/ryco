import type { KVService } from "@ryco/client-runtime/platform";

import { resolveStorage, type StateStorage } from "../lib/storage";

function browserStorage(): StateStorage {
  return resolveStorage(typeof window === "undefined" ? null : window.localStorage);
}

export function createWebKV(storage: StateStorage = browserStorage()): KVService {
  return {
    getItem: async (key) => await storage.getItem(key),
    setItem: async (key, value) => {
      await storage.setItem(key, value);
    },
    removeItem: async (key) => {
      await storage.removeItem(key);
    },
  };
}

export const webKV = createWebKV();
