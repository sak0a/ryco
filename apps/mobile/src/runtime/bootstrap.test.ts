import { describe, expect, it, vi } from "vite-plus/test";

// Stub the native modules the wiring pulls in so the bootstrap runs headless.
vi.mock("react-native", () => ({
  AppState: { currentState: "active", addEventListener: () => ({ remove: () => {} }) },
}));
vi.mock("expo-network", () => ({
  addNetworkStateListener: () => ({ remove: () => {} }),
  getNetworkStateAsync: async () => ({ isConnected: true }),
}));
vi.mock("expo-secure-store", () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => {},
  deleteItemAsync: async () => {},
}));
vi.mock("expo-sqlite/kv-store", () => ({
  default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));
vi.mock("expo-linking", () => ({ getInitialURL: async () => null }));
vi.mock("expo-constants", () => ({
  default: { expoConfig: { extra: { node: { httpBaseUrl: "http://node.local:44342" } } } },
}));

import { createMobileConnectionRegistry } from "./bootstrap";

describe("mobile runtime bootstrap", () => {
  it("constructs the connection registry with fake adapters without error", async () => {
    const store = new Map<string, string>();
    const secrets = new Map<string, string>();
    const registry = createMobileConnectionRegistry({
      kv: {
        getItem: async (key) => store.get(key) ?? null,
        setItem: async (key, value) => {
          store.set(key, value);
        },
      },
      secretKV: {
        get: async (key) => secrets.get(key) ?? null,
        set: async (key, value) => {
          secrets.set(key, value);
          return true;
        },
        remove: async (key) => {
          secrets.delete(key);
        },
      },
    });

    // The saved-environment catalog (the environment registry) initializes with
    // an empty registry.
    expect(registry.catalog).toBeDefined();
    await expect(registry.catalog.waitForHydration()).resolves.not.toThrow();
    expect(registry.catalog.hasHydrated()).toBe(true);
    expect(registry.catalog.list()).toEqual([]);

    // Bearer tokens route through the injected SecretKV (the direct-node token
    // store), not the registry KV.
    await registry.catalog.writeBearerToken("env-1" as never, "bearer-token");
    expect(secrets.get("env-1")).toBe("bearer-token");
    await expect(registry.catalog.readBearerToken("env-1" as never)).resolves.toBe("bearer-token");

    // The direct-node bearer API exposes the pairing bootstrap surface.
    expect(typeof registry.remoteApi.bootstrapRemoteBearerSession).toBe("function");
    expect(typeof registry.remoteApi.issueRemoteWebSocketToken).toBe("function");
    expect(typeof registry.remoteApi.resolveRemoteWebSocketConnectionUrl).toBe("function");
  });
});
