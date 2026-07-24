import type { KVService, SecretKVService } from "@ryco/client-runtime/platform";

// Importing the threads-runtime module registers its lazy configurator (a stored
// callback — no timers/sockets), the sanctioned registration pattern.
import "../state/threadsRuntime";
import { createMobileSavedEnvironmentCatalog } from "../connection/catalog";
import {
  createMobileEnvironmentDriver,
  type MobileEnvironmentDriver,
} from "../connection/environmentDriver";
import { createMobileRemoteEnvironmentApi } from "../connection/remoteApi";
import { initializeWsConnectionState } from "../rpc/wsConnectionState";

type Catalog = ReturnType<typeof createMobileSavedEnvironmentCatalog>;
type RemoteApi = ReturnType<typeof createMobileRemoteEnvironmentApi>;

export interface MobileConnectionRegistry {
  readonly catalog: Catalog;
  readonly remoteApi: RemoteApi;
  readonly driver: MobileEnvironmentDriver;
}

// Single-homed app singletons: the PairingScreen (which persists the paired
// environment) and the supervisor (which reads it and connects) share ONE
// catalog/remoteApi/driver. Built lazily — no import-time side effects.
let appCatalog: Catalog | null = null;
let appRemoteApi: RemoteApi | null = null;
let appDriver: MobileEnvironmentDriver | null = null;

function getAppCatalog(): Catalog {
  return (appCatalog ??= createMobileSavedEnvironmentCatalog());
}
function getAppRemoteApi(): RemoteApi {
  return (appRemoteApi ??= createMobileRemoteEnvironmentApi());
}
function getAppDriver(): MobileEnvironmentDriver {
  return (appDriver ??= createMobileEnvironmentDriver({
    catalog: getAppCatalog(),
    remoteApi: getAppRemoteApi(),
  }));
}

/**
 * The connection registry: the saved-environment catalog (env registry + bearer
 * tokens in SecretKV), the direct-node bearer API (the pairing engine), and the
 * environment-connection driver (the supervisor that opens the live socket and
 * syncs the node stream into state/threads). The app uses the single-homed
 * singletons; a headless test passes `overrides` to build an isolated registry
 * with fake adapters.
 */
export function createMobileConnectionRegistry(overrides?: {
  readonly kv?: Pick<KVService, "getItem" | "setItem">;
  readonly secretKV?: SecretKVService;
  readonly remoteApi?: RemoteApi;
  readonly subscribeResume?: (listener: (reason: string) => void) => () => void;
}): MobileConnectionRegistry {
  if (!overrides) {
    return { catalog: getAppCatalog(), remoteApi: getAppRemoteApi(), driver: getAppDriver() };
  }
  const catalog = createMobileSavedEnvironmentCatalog({
    ...(overrides.kv ? { kv: overrides.kv } : {}),
    ...(overrides.secretKV ? { secretKV: overrides.secretKV } : {}),
  });
  const remoteApi = overrides.remoteApi ?? createMobileRemoteEnvironmentApi();
  const driver = createMobileEnvironmentDriver({
    catalog,
    remoteApi,
    ...(overrides.subscribeResume ? { subscribeResume: overrides.subscribeResume } : {}),
  });
  return { catalog, remoteApi, driver };
}

let initialized = false;

/**
 * One-time runtime initialization run from the app root. Seeds the ws
 * online-status atom from AppLifecycle and starts the environment-connection
 * driver (which subscribes the saved-environment registry, so a newly paired
 * environment auto-connects, and wires AppState resume/reconnect). Idempotent.
 */
export function initializeMobileRuntime(): MobileConnectionRegistry {
  const registry = createMobileConnectionRegistry();
  if (!initialized) {
    initialized = true;
    initializeWsConnectionState();
    registry.driver.start();
  }
  return registry;
}

/** Test seam: drop the app singletons and init flag. */
export function resetMobileRuntimeInitForTests(): void {
  initialized = false;
  appCatalog = null;
  appRemoteApi = null;
  appDriver = null;
}
