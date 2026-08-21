import type { CommandId, EnvironmentId, MessageId, ThreadId } from "@ryco/contracts";
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
vi.mock("expo-constants", () => ({ default: { expoConfig: { extra: {} } } }));
vi.mock("expo-crypto", () => ({ randomUUID: () => "id" }));

import {
  recordWsConnectionAttempt,
  recordWsConnectionClosed,
  recordWsConnectionOpened,
  resetWsConnectionStateForTests,
} from "@ryco/client-runtime/rpc";

import type { QueuedThreadMessage } from "./threadOutboxModel";
import { readThreadDeliveryState } from "./use-thread-outbox-drain";

const ENV_A = "env-node-a" as EnvironmentId;
const ENV_B = "env-node-b" as EnvironmentId;

function queuedFor(environmentId: EnvironmentId): QueuedThreadMessage {
  return {
    environmentId,
    threadId: "t1" as ThreadId,
    messageId: `m-${environmentId}` as MessageId,
    commandId: "c1" as CommandId,
    text: "queued while offline",
    attachments: [],
    createdAt: "2026-08-19T10:00:00.000Z",
  };
}

/** Simulate each environment's socket lifecycle the way the instrumented mobile
 * transports record it (attempt/opened/closed carrying the owning environment). */
function connectEnvironment(environmentId: EnvironmentId, url: string): void {
  recordWsConnectionAttempt(url, { connectionLabel: environmentId, environmentId });
  recordWsConnectionOpened({ connectionLabel: environmentId, environmentId });
}

function dropEnvironment(environmentId: EnvironmentId): void {
  recordWsConnectionClosed({ code: 1006, reason: "server stopped" }, { environmentId });
}

beforeEach(() => resetWsConnectionStateForTests());

describe("outbox drain gate (two environments)", () => {
  it("does not judge a message for a disconnected environment drainable because another environment is connected", () => {
    // Node A connects, then its server stops.
    connectEnvironment(ENV_A, "ws://node-a.local:13773/ws");
    dropEnvironment(ENV_A);
    // Node B connects afterwards — the last writer to any global status.
    connectEnvironment(ENV_B, "ws://node-b.local:13774/ws");

    // The queued message targets node A, which is offline. It must stay queued.
    expect(readThreadDeliveryState(queuedFor(ENV_A)).environmentConnected).toBe(false);
  });

  it("judges a message for the connected environment drainable (positive control)", () => {
    connectEnvironment(ENV_A, "ws://node-a.local:13773/ws");
    dropEnvironment(ENV_A);
    connectEnvironment(ENV_B, "ws://node-b.local:13774/ws");

    expect(readThreadDeliveryState(queuedFor(ENV_B)).environmentConnected).toBe(true);
  });

  it("delivers once the message's own environment reconnects", () => {
    connectEnvironment(ENV_B, "ws://node-b.local:13774/ws");
    connectEnvironment(ENV_A, "ws://node-a.local:13773/ws");
    dropEnvironment(ENV_A);
    expect(readThreadDeliveryState(queuedFor(ENV_A)).environmentConnected).toBe(false);

    // Node A comes back; its own slot — not node B's — must open the gate.
    connectEnvironment(ENV_A, "ws://node-a.local:13773/ws");
    expect(readThreadDeliveryState(queuedFor(ENV_A)).environmentConnected).toBe(true);
    expect(readThreadDeliveryState(queuedFor(ENV_B)).environmentConnected).toBe(true);
  });

  it("treats an environment with no recorded socket as not connected", () => {
    connectEnvironment(ENV_B, "ws://node-b.local:13774/ws");

    expect(readThreadDeliveryState(queuedFor(ENV_A)).environmentConnected).toBe(false);
  });
});

describe("wsUiStateForEnvironment (device-offline overlay)", () => {
  it("reads offline for a never-connected environment when the device is offline", async () => {
    const { getWsConnectionStatusForEnvironment, setBrowserOnlineStatus } = await import(
      "@ryco/client-runtime/rpc"
    );
    const { wsUiStateForEnvironment } = await import("../rpc/wsConnectionState");

    connectEnvironment(ENV_A, "ws://node-a.local:13773/ws");
    setBrowserOnlineStatus(false);
    dropEnvironment(ENV_A);

    // Node A's own slot recorded the disconnect; node B never attempted a
    // socket this session. Both must read "offline" in airplane mode.
    expect(wsUiStateForEnvironment(getWsConnectionStatusForEnvironment(ENV_A))).toBe("offline");
    expect(wsUiStateForEnvironment(getWsConnectionStatusForEnvironment(ENV_B))).toBe("offline");

    setBrowserOnlineStatus(true);
    expect(wsUiStateForEnvironment(getWsConnectionStatusForEnvironment(ENV_B))).not.toBe(
      "offline",
    );
  });

  it("never masks a live socket", async () => {
    const { getWsConnectionStatusForEnvironment, setBrowserOnlineStatus } = await import(
      "@ryco/client-runtime/rpc"
    );
    const { wsUiStateForEnvironment } = await import("../rpc/wsConnectionState");

    connectEnvironment(ENV_A, "ws://node-a.local:13773/ws");
    setBrowserOnlineStatus(false);

    expect(wsUiStateForEnvironment(getWsConnectionStatusForEnvironment(ENV_A))).toBe("connected");
  });
});
