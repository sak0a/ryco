import { describe, expect, it } from "vite-plus/test";

import {
  RELAY_INITIAL_LIMITS,
  type RelayFrame,
  type RelayNodeAuthHandshake,
} from "@ryco/contracts/relay";
import { decodeRelayFrame, encodeRelayFrame } from "@ryco/shared/relayCodec";

import { DEFAULT_HUB_CONNECTOR_CONFIG, type HubConnectorConfig } from "../config.ts";
import type { HubIdentityRuntimeShape } from "./HubIdentityRuntime.ts";
import type { HubRelaySocket, HubRelaySocketEventMap } from "./HubRelayTransport.ts";
import { HubConnector, type HubConnectorScheduler } from "./HubConnector.ts";

class FakeSocket implements HubRelaySocket {
  bufferedAmount = 0;
  readyState = 0;
  readonly sent: Uint8Array[] = [];
  readonly listeners = new Map<string, Set<(event: never) => void>>();
  closeCalls = 0;

  send(bytes: Uint8Array): void {
    this.sent.push(Uint8Array.from(bytes));
  }
  close(): void {
    this.closeCalls += 1;
  }
  addEventListener<K extends keyof HubRelaySocketEventMap>(
    type: K,
    listener: (event: HubRelaySocketEventMap[K]) => void,
  ): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener as (event: never) => void);
    this.listeners.set(type, set);
  }
  removeEventListener<K extends keyof HubRelaySocketEventMap>(
    type: K,
    listener: (event: HubRelaySocketEventMap[K]) => void,
  ): void {
    this.listeners.get(type)?.delete(listener as (event: never) => void);
  }
  emit<K extends keyof HubRelaySocketEventMap>(type: K, event: HubRelaySocketEventMap[K]): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event as never);
  }
}

function encoded(frame: RelayFrame): Uint8Array {
  const result = encodeRelayFrame(frame);
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

function identity(): HubIdentityRuntimeShape {
  return {
    backend: "keytar",
    readState: async () => ({
      version: 1,
      revision: 1,
      environmentId: `env_${"E".repeat(22)}`,
      pendingEnrollment: null,
      activeNode: {
        hubOrigin: "https://relay.example",
        nodeId: `node_${"N".repeat(22)}`,
        activeKeyId: `nkey_${"K".repeat(22)}`,
        activeKeySecretName: "node-key.fixture",
        cleanupPollingSecretName: null,
        enrolledAt: 1,
      },
      stagedRotation: null,
    }),
    startEnrollment: async () => {
      throw new Error("unused");
    },
    pollEnrollment: async () => {
      throw new Error("unused");
    },
    cancelEnrollment: async () => undefined,
    createRelayAuthenticationFrame: async () =>
      ({
        type: "auth",
        peer: "node",
        protocolMajor: 1,
        protocolMinor: 2,
        nodeId: `node_${"N".repeat(22)}`,
        nonce: new Uint8Array(32).fill(1),
        signature: new Uint8Array(64).fill(2),
      }) as RelayNodeAuthHandshake,
    stageKeyRotation: async () => ({ status: "awaiting_owner" }),
    resumeKeyRotation: async () => ({ status: "awaiting_owner" }),
    confirmAuthenticatedKey: async () => undefined,
  };
}

function scheduler() {
  let now = 1_000_000;
  let nextId = 0;
  const timers = new Map<number, { callback: () => void; due: number }>();
  const value: HubConnectorScheduler = {
    now: () => now,
    random: () => 0.5,
    setTimeout: (callback, milliseconds) => {
      const id = ++nextId;
      timers.set(id, { callback, due: now + milliseconds });
      return id;
    },
    clearTimeout: (handle) => {
      timers.delete(handle as number);
    },
  };
  const advance = async (milliseconds: number) => {
    now += milliseconds;
    const due = [...timers.entries()]
      .filter(([, timer]) => timer.due <= now)
      .sort((left, right) => left[1].due - right[1].due);
    for (const [id, timer] of due) {
      timers.delete(id);
      timer.callback();
      await Promise.resolve();
      await Promise.resolve();
    }
  };
  return { value, timers, advance };
}

const enabledConfig: HubConnectorConfig = {
  ...DEFAULT_HUB_CONNECTOR_CONFIG,
  enabled: true,
  origin: "https://relay.example",
};

const settle = async (turns = 10) => {
  for (let index = 0; index < turns; index += 1) await Promise.resolve();
};

describe("HubConnector", () => {
  it("does no network work while disabled", async () => {
    let opens = 0;
    const connector = new HubConnector({
      config: DEFAULT_HUB_CONNECTOR_CONFIG,
      identity: identity(),
      transport: {
        open: () => {
          opens += 1;
          return new FakeSocket();
        },
      },
      channels: {
        open: async () => {
          throw new Error("unused");
        },
      },
    });
    await connector.start();
    expect(connector.status().state).toBe("disabled");
    expect(opens).toBe(0);
    await connector.stop();
  });

  it("authenticates one socket, answers heartbeat, backs off once, and shuts down cleanly", async () => {
    const clock = scheduler();
    const sockets: FakeSocket[] = [];
    const connector = new HubConnector({
      config: enabledConfig,
      identity: identity(),
      transport: {
        open: () => {
          const socket = new FakeSocket();
          sockets.push(socket);
          return socket;
        },
      },
      channels: {
        open: async () => {
          throw new Error("unused");
        },
      },
      scheduler: clock.value,
    });
    const starting = connector.start();
    await settle();
    expect(sockets).toHaveLength(1);
    sockets[0]!.emit("open", {} as Event);
    sockets[0]!.emit("message", {
      data: encoded({
        type: "ready",
        protocolMajor: 1,
        protocolMinor: 2,
        limits: RELAY_INITIAL_LIMITS,
      }),
    } as MessageEvent);
    await starting;
    expect(connector.status()).toMatchObject({ state: "online", activeChannels: 0 });
    expect(sockets[0]!.sent).toHaveLength(1);

    sockets[0]!.emit("message", {
      data: encoded({
        type: "ping",
        protocolMajor: 1,
        protocolMinor: 2,
        nonce: new Uint8Array(8).fill(4),
      }),
    } as MessageEvent);
    await Promise.resolve();
    await Promise.resolve();
    expect(sockets[0]!.sent).toHaveLength(2);
    const pong = decodeRelayFrame(sockets[0]!.sent[1]!);
    expect(pong.ok && pong.value.type).toBe("pong");

    sockets[0]!.emit("close", {} as CloseEvent);
    await Promise.resolve();
    await Promise.resolve();
    expect(connector.status()).toMatchObject({
      state: "degraded",
      degradedMode: "backing_off",
      failure: "network_unavailable",
    });
    expect(clock.timers.size).toBe(1);
    await clock.advance(1_000);
    expect(sockets).toHaveLength(2);

    await connector.stop();
    expect(connector.status().state).toBe("disabled");
    expect(clock.timers.size).toBe(0);
    expect([...sockets[0]!.listeners.values()].every((set) => set.size === 0)).toBe(true);
  });

  it("requires operator action for fresh-proof authentication failure", async () => {
    const socket = new FakeSocket();
    const connector = new HubConnector({
      config: enabledConfig,
      identity: identity(),
      transport: { open: () => socket },
      channels: {
        open: async () => {
          throw new Error("unused");
        },
      },
    });
    const starting = connector.start();
    await settle();
    socket.emit("open", {} as Event);
    socket.emit("message", {
      data: encoded({
        type: "error",
        protocolMajor: 1,
        protocolMinor: 2,
        code: "authentication_failed",
        fatal: true,
      }),
    } as MessageEvent);
    await starting;
    expect(connector.status()).toMatchObject({
      state: "degraded",
      degradedMode: "operator_action_required",
      failure: "authentication_failed",
    });
    await connector.stop();
  });
});
