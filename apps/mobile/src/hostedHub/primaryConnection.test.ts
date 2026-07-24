import type { ExecutionEnvironmentDescriptor } from "@ryco/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

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
  default: {
    expoConfig: {
      extra: {
        appVariant: "production",
        hosted: {
          hubBaseUrl: "https://hub.example.test",
          appUrl: "https://app.ryco.dev",
          relyingParty: "app.ryco.dev",
        },
      },
    },
  },
}));

import { createHostedPrimaryConnection } from "./primaryConnection";
import {
  resetPrimaryEnvironmentForTests,
  writePrimaryEnvironmentDescriptor,
} from "./primaryEnvironment";
import { resetMobileHostedRuntimeConfigForTests } from "./runtimeConfig";

const descriptor = {
  environmentId: "env-hosted-1",
  label: "Studio",
  platform: { os: "darwin", arch: "arm64" },
  serverVersion: "1.0.0",
  capabilities: { repositoryIdentity: false },
} as unknown as ExecutionEnvironmentDescriptor;

const deps = () => ({
  pushSequenceMonitor: { recordEvent: () => undefined, recordSnapshot: () => undefined },
  applyShellEvent: vi.fn(),
  syncShellSnapshot: vi.fn(),
});

beforeEach(() => {
  resetPrimaryEnvironmentForTests();
  resetMobileHostedRuntimeConfigForTests();
});

describe("hosted primary connection", () => {
  it("returns null when no hosted node is selected", () => {
    // The normal state, including at supervisor start() on a direct-only build.
    expect(createHostedPrimaryConnection(deps())).toBeNull();
  });

  it("returns null again after the descriptor is cleared", () => {
    writePrimaryEnvironmentDescriptor(descriptor);
    writePrimaryEnvironmentDescriptor(null);
    expect(createHostedPrimaryConnection(deps())).toBeNull();
  });

  it("builds a primary-kind connection once a node is selected", async () => {
    writePrimaryEnvironmentDescriptor(descriptor);

    const connection = createHostedPrimaryConnection(deps());

    expect(connection).not.toBeNull();
    // `disconnectPrimary` finds the connection by `entry.kind === "primary"`.
    expect(connection?.kind).toBe("primary");
    expect(connection?.knownEnvironment.environmentId).toBe("env-hosted-1");
    expect(connection?.knownEnvironment.source).toBe("hub-hosted");
    await connection?.dispose().catch(() => undefined);
  });

  it("points the connection target at the relay, never at a node address", async () => {
    writePrimaryEnvironmentDescriptor(descriptor);

    const connection = createHostedPrimaryConnection(deps());

    // The hosted plane never learns a node-owned address; the only reachable
    // endpoint is the Hub's relay.
    expect(connection?.knownEnvironment.target.wsBaseUrl).toBe(
      "wss://hub.example.test/v1/relay/client",
    );
    expect(connection?.knownEnvironment.target.httpBaseUrl).toBe("https://hub.example.test");
    await connection?.dispose().catch(() => undefined);
  });
});

describe("primary environment descriptor store", () => {
  it("notifies subscribers on change and stops after unsubscribe", async () => {
    const { subscribePrimaryEnvironmentDescriptor, readPrimaryEnvironmentDescriptor } =
      await import("./primaryEnvironment");
    const listener = vi.fn();
    const unsubscribe = subscribePrimaryEnvironmentDescriptor(listener);

    writePrimaryEnvironmentDescriptor(descriptor);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(readPrimaryEnvironmentDescriptor()).toBe(descriptor);

    unsubscribe();
    writePrimaryEnvironmentDescriptor(null);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("does not notify when the descriptor is unchanged", async () => {
    const { subscribePrimaryEnvironmentDescriptor } = await import("./primaryEnvironment");
    const listener = vi.fn();
    subscribePrimaryEnvironmentDescriptor(listener);

    writePrimaryEnvironmentDescriptor(descriptor);
    writePrimaryEnvironmentDescriptor(descriptor);

    expect(listener).toHaveBeenCalledTimes(1);
  });
});
