import type { KVService, SecretKVService } from "@ryco/client-runtime/platform";
import {
  createSavedEnvironmentCatalog,
  type SavedEnvironmentKV,
  type SavedEnvironmentRecord,
} from "@ryco/client-runtime/connection";

import { mobileKV, mobileSecretKV } from "../platform";

const REGISTRY_KEY = "ryco.savedEnvironments.registry";

type RegistryKV = Pick<KVService, "getItem" | "setItem">;

/**
 * Adapts the async KV to the catalog's registry persistence: the saved-
 * environment records are stored as one JSON document under a single key.
 * Secrets (bearer tokens) never enter this document — they live in SecretKV.
 */
export function createMobileSavedEnvironmentKV(kv: RegistryKV = mobileKV): SavedEnvironmentKV {
  return {
    getRegistry: async () => {
      const raw = await kv.getItem(REGISTRY_KEY);
      if (!raw) return [];
      try {
        const parsed = JSON.parse(raw) as ReadonlyArray<SavedEnvironmentRecord>;
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    },
    setRegistry: async (records) => {
      await kv.setItem(REGISTRY_KEY, JSON.stringify(records));
    },
  };
}

export function createMobileSavedEnvironmentCatalog(input?: {
  readonly kv?: RegistryKV;
  readonly secretKV?: SecretKVService;
}): ReturnType<typeof createSavedEnvironmentCatalog> {
  return createSavedEnvironmentCatalog({
    kv: createMobileSavedEnvironmentKV(input?.kv ?? mobileKV),
    secretKV: input?.secretKV ?? mobileSecretKV,
  });
}
