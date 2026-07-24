import type { KVService, SecretKVService } from "@ryco/client-runtime/platform";

// Importing the threads-runtime module registers its lazy configurator (a stored
// callback — no timers/sockets), the sanctioned registration pattern.
import "../state/threadsRuntime";
import { createMobileSavedEnvironmentCatalog } from "../connection/catalog";
import { createMobileRemoteEnvironmentApi } from "../connection/remoteApi";
import { initializeWsConnectionState } from "../rpc/wsConnectionState";

export interface MobileConnectionRegistry {
  readonly catalog: ReturnType<typeof createMobileSavedEnvironmentCatalog>;
  readonly remoteApi: ReturnType<typeof createMobileRemoteEnvironmentApi>;
}

/**
 * Constructs the connection registry: the saved-environment catalog (the
 * environment registry + its secret store) and the direct-node bearer API (the
 * pairing engine). Adapters are injectable so a headless bootstrap can run with
 * fakes.
 */
export function createMobileConnectionRegistry(overrides?: {
  readonly kv?: Pick<KVService, "getItem" | "setItem">;
  readonly secretKV?: SecretKVService;
}): MobileConnectionRegistry {
  const catalog = createMobileSavedEnvironmentCatalog({
    ...(overrides?.kv ? { kv: overrides.kv } : {}),
    ...(overrides?.secretKV ? { secretKV: overrides.secretKV } : {}),
  });
  const remoteApi = createMobileRemoteEnvironmentApi();
  return { catalog, remoteApi };
}

let initialized = false;

/**
 * One-time runtime initialization run from the app root. Registers the threads
 * configurator (via the import above), seeds the ws online-status atom from the
 * AppLifecycle adapter, and returns the connection registry. Idempotent.
 */
export function initializeMobileRuntime(): MobileConnectionRegistry {
  const registry = createMobileConnectionRegistry();
  if (!initialized) {
    initialized = true;
    initializeWsConnectionState();
  }
  return registry;
}

/** Test seam. */
export function resetMobileRuntimeInitForTests(): void {
  initialized = false;
}
