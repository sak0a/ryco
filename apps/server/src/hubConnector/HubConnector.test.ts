import { describe, expect, it } from "vite-plus/test";

import {
  RELAY_INITIAL_LIMITS,
  type RelayChannelId,
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

function identity(overrides: Partial<HubIdentityRuntimeShape> = {}): HubIdentityRuntimeShape {
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
    ...overrides,
  };
}

const enrollmentMetadata = {
  label: "Test node",
  platformOs: "darwin" as const,
  platformArch: "arm64" as const,
  clientVersion: "0.1.8",
};

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
      .toSorted((left, right) => left[1].due - right[1].due);
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
      enrollmentMetadata,
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
      enrollmentMetadata,
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

  it("flushes asynchronous channel output without waiting for another inbound frame", async () => {
    const socket = new FakeSocket();
    const channelId = `ch_${"W".repeat(22)}` as RelayChannelId;
    let sendChannelBytes: ((bytes: Uint8Array) => boolean) | undefined;
    const connector = new HubConnector({
      config: enabledConfig,
      identity: identity(),
      transport: { open: () => socket },
      channels: {
        open: async ({ send }) => {
          sendChannelBytes = send;
          return {
            receive: async () => true,
            queuedBytes: async () => 0,
            close: async () => undefined,
          };
        },
      },
      enrollmentMetadata,
    });
    const starting = connector.start();
    await settle();
    socket.emit("open", {} as Event);
    socket.emit("message", {
      data: encoded({
        type: "ready",
        protocolMajor: 1,
        protocolMinor: 2,
        limits: RELAY_INITIAL_LIMITS,
      }),
    } as MessageEvent);
    await starting;
    socket.emit("message", {
      data: encoded({
        type: "channel.open",
        protocolMajor: 1,
        protocolMinor: 2,
        channelId,
        capability: "ryco.rpc",
        effectiveRole: "operator",
      }),
    } as MessageEvent);
    await settle();
    expect(decodeRelayFrame(socket.sent.at(-1)!)).toMatchObject({
      ok: true,
      value: { type: "channel.accept", channelId },
    });

    expect(sendChannelBytes?.(Uint8Array.of(0, 255, 7))).toBe(true);
    await Promise.resolve();
    const output = decodeRelayFrame(socket.sent.at(-1)!);
    expect(output).toMatchObject({
      ok: true,
      value: { type: "data", channelId, sequence: 0 },
    });
    expect(output.ok && output.value.type === "data" && output.value.payload).toEqual(
      Uint8Array.of(0, 255, 7),
    );
    await connector.stop();
  });

  it("handles a channel opened immediately after ready while identity confirmation is pending", async () => {
    const socket = new FakeSocket();
    const channelId = `ch_${"I".repeat(22)}` as RelayChannelId;
    const activeIdentity = identity();
    let readCalls = 0;
    let releaseIdentityRead: (() => void) | undefined;
    const identityRead = new Promise<void>((resolve) => {
      releaseIdentityRead = resolve;
    });
    const connector = new HubConnector({
      config: enabledConfig,
      identity: {
        ...activeIdentity,
        readState: async () => {
          readCalls += 1;
          if (readCalls > 1) await identityRead;
          return activeIdentity.readState();
        },
      },
      transport: { open: () => socket },
      channels: {
        open: async () => ({
          receive: async () => true,
          queuedBytes: async () => 0,
          close: async () => undefined,
        }),
      },
      enrollmentMetadata,
    });
    const starting = connector.start();
    await settle();
    socket.emit("open", {} as Event);
    socket.emit("message", {
      data: encoded({
        type: "ready",
        protocolMajor: 1,
        protocolMinor: 2,
        limits: RELAY_INITIAL_LIMITS,
      }),
    } as MessageEvent);
    await Promise.resolve();
    socket.emit("message", {
      data: encoded({
        type: "channel.open",
        protocolMajor: 1,
        protocolMinor: 2,
        channelId,
        capability: "ryco.rpc",
        effectiveRole: "operator",
      }),
    } as MessageEvent);
    await settle();

    expect(connector.status().state).toBe("authenticating");
    expect(decodeRelayFrame(socket.sent.at(-1)!)).toMatchObject({
      ok: true,
      value: { type: "channel.accept", channelId },
    });

    releaseIdentityRead?.();
    await starting;
    expect(connector.status()).toMatchObject({ state: "online", activeChannels: 1 });
    await connector.stop();
  });

  it("fails closed on a directionally inappropriate post-authentication frame", async () => {
    const socket = new FakeSocket();
    const connector = new HubConnector({
      config: enabledConfig,
      identity: identity(),
      transport: { open: () => socket },
      channels: { open: async () => Promise.reject(new Error("unused")) },
      enrollmentMetadata,
    });
    const starting = connector.start();
    await settle();
    socket.emit("open", {} as Event);
    socket.emit("message", {
      data: encoded({
        type: "ready",
        protocolMajor: 1,
        protocolMinor: 2,
        limits: RELAY_INITIAL_LIMITS,
      }),
    } as MessageEvent);
    await starting;

    socket.emit("message", {
      data: encoded({
        type: "pong",
        protocolMajor: 1,
        protocolMinor: 2,
        nonce: new Uint8Array(8).fill(3),
      }),
    } as MessageEvent);
    await settle();

    expect(socket.closeCalls).toBe(1);
    expect(connector.status()).toMatchObject({ state: "degraded", failure: "protocol_invalid" });
    await connector.stop();
  });

  it("times out a missing heartbeat and resets backoff only after stability", async () => {
    const clock = scheduler();
    const sockets: FakeSocket[] = [];
    const connector = new HubConnector({
      config: { ...enabledConfig, reconnectStableMs: 5_000 },
      identity: identity(),
      transport: {
        open: () => {
          const socket = new FakeSocket();
          sockets.push(socket);
          return socket;
        },
      },
      channels: { open: async () => Promise.reject(new Error("unused")) },
      enrollmentMetadata,
      scheduler: clock.value,
    });
    const starting = connector.start();
    await settle();
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

    sockets[0]!.emit("close", {} as CloseEvent);
    await settle();
    expect(connector.status().reconnectAttempt).toBe(0);
    await clock.advance(1_000);
    await settle();
    sockets[1]!.emit("open", {} as Event);
    sockets[1]!.emit("message", {
      data: encoded({
        type: "ready",
        protocolMajor: 1,
        protocolMinor: 2,
        limits: RELAY_INITIAL_LIMITS,
      }),
    } as MessageEvent);
    await settle();
    await clock.advance(5_000);
    sockets[1]!.emit("close", {} as CloseEvent);
    await settle();
    expect(connector.status()).toMatchObject({
      state: "degraded",
      failure: "network_unavailable",
      reconnectAttempt: 0,
    });

    await clock.advance(1_000);
    await settle();
    sockets[2]!.emit("open", {} as Event);
    sockets[2]!.emit("message", {
      data: encoded({
        type: "ready",
        protocolMajor: 1,
        protocolMinor: 2,
        limits: RELAY_INITIAL_LIMITS,
      }),
    } as MessageEvent);
    await settle();
    await clock.advance(RELAY_INITIAL_LIMITS.deadConnectionTimeoutMs);
    await settle();
    expect(connector.status()).toMatchObject({
      state: "degraded",
      failure: "heartbeat_timeout",
    });
    await connector.stop();
    expect(clock.timers.size).toBe(0);
  });

  it("confirms an activated staged key only after the replacement key authenticates", async () => {
    const socket = new FakeSocket();
    const confirmed: string[] = [];
    const activeState = {
      version: 1 as const,
      revision: 2,
      environmentId: `env_${"E".repeat(22)}`,
      pendingEnrollment: null,
      activeNode: {
        hubOrigin: "https://relay.example",
        nodeId: `node_${"N".repeat(22)}`,
        activeKeyId: `nkey_${"K".repeat(22)}`,
        activeKeySecretName: "node-key.old",
        cleanupPollingSecretName: null,
        enrolledAt: 1,
      },
      stagedRotation: {
        hubOrigin: "https://relay.example",
        rotationRequestId: `rot_${"R".repeat(22)}`,
        newKeyId: `nkey_${"Q".repeat(22)}`,
        newKeySecretName: "node-key.new",
        stagedAt: 2,
        activatedAt: 3,
      },
    };
    const connector = new HubConnector({
      config: enabledConfig,
      identity: identity({
        readState: async () => activeState,
        confirmAuthenticatedKey: async (_origin, keyId) => {
          confirmed.push(keyId);
        },
      }),
      transport: { open: () => socket },
      channels: { open: async () => Promise.reject(new Error("unused")) },
      enrollmentMetadata,
    });
    const starting = connector.start();
    await settle();
    socket.emit("open", {} as Event);
    socket.emit("message", {
      data: encoded({
        type: "ready",
        protocolMajor: 1,
        protocolMinor: 2,
        limits: RELAY_INITIAL_LIMITS,
      }),
    } as MessageEvent);
    await starting;
    expect(confirmed).toEqual([activeState.stagedRotation.newKeyId]);
    await connector.stop();
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
      enrollmentMetadata,
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

  it("revalidates identity origin before an operator-triggered resume", async () => {
    const clock = scheduler();
    const socket = new FakeSocket();
    let changedOrigin = false;
    const activeIdentity = identity();
    const connector = new HubConnector({
      config: enabledConfig,
      identity: {
        ...activeIdentity,
        readState: async () => {
          const state = await activeIdentity.readState();
          return changedOrigin && state.activeNode !== null
            ? {
                ...state,
                activeNode: { ...state.activeNode, hubOrigin: "https://other.example" },
              }
            : state;
        },
      },
      transport: { open: () => socket },
      channels: { open: async () => Promise.reject(new Error("unused")) },
      enrollmentMetadata,
      scheduler: clock.value,
    });
    const starting = connector.start();
    await settle();
    socket.emit("open", {} as Event);
    socket.emit("message", {
      data: encoded({
        type: "ready",
        protocolMajor: 1,
        protocolMinor: 2,
        limits: RELAY_INITIAL_LIMITS,
      }),
    } as MessageEvent);
    await starting;
    socket.emit("close", {} as CloseEvent);
    await settle();

    changedOrigin = true;
    await connector.resume();
    expect(connector.status()).toMatchObject({
      state: "degraded",
      degradedMode: "operator_action_required",
      failure: "identity_origin_mismatch",
    });
    expect(clock.timers.size).toBe(0);
    await connector.stop();
  });

  it("starts enrollment, polls approval, and authenticates without exposing polling material", async () => {
    const clock = scheduler();
    const socket = new FakeSocket();
    let pending = false;
    let polls = 0;
    const connector = new HubConnector({
      config: enabledConfig,
      identity: identity({
        readState: async () => ({
          version: 1,
          revision: 1,
          environmentId: `env_${"E".repeat(22)}`,
          pendingEnrollment: pending
            ? {
                hubOrigin: "https://relay.example",
                keySecretName: "node-key.fixture",
                pollingSecretName: "enrollment-poll.fixture",
                createdAt: 1,
                expiresAt: 2_000_000,
                pollIntervalMs: 1_000,
                cleanupRequested: false,
              }
            : null,
          activeNode: null,
          stagedRotation: null,
        }),
        startEnrollment: async () => {
          pending = true;
          return {
            deviceCode: "ABCD-EFGH",
            expiresAt: 2_000_000,
            pollIntervalMs: 1_000,
            environmentId: `env_${"E".repeat(22)}`,
            publicKey: {
              algorithm: "ed25519",
              publicKey: new Uint8Array(32),
              fingerprint: new Uint8Array(32),
            },
          };
        },
        pollEnrollment: async () => {
          polls += 1;
          if (polls === 1) return { status: "pending", retryAfterMs: 1_000 };
          return {
            status: "approved",
            nodeId: `node_${"N".repeat(22)}`,
            environmentId: `env_${"E".repeat(22)}`,
            activeKeyId: `nkey_${"K".repeat(22)}`,
            enrolledAt: 1,
          };
        },
      }),
      transport: { open: () => socket },
      channels: {
        open: async () => {
          throw new Error("unused");
        },
      },
      enrollmentMetadata,
      scheduler: clock.value,
    });
    await connector.start();
    const started = await connector.enroll();
    expect(started).toMatchObject({
      deviceCode: "ABCD-EFGH",
      fingerprint: `SHA256:${"A".repeat(43)}`,
      pollIntervalMs: 1_000,
      status: { state: "awaiting_approval" },
    });
    expect(Object.keys(started).toSorted()).toEqual([
      "deviceCode",
      "expiresAt",
      "fingerprint",
      "pollIntervalMs",
      "status",
    ]);

    await clock.advance(1_000);
    expect(connector.status().state).toBe("awaiting_approval");
    await clock.advance(1_000);
    await settle();
    socket.emit("open", {} as Event);
    socket.emit("message", {
      data: encoded({
        type: "ready",
        protocolMajor: 1,
        protocolMinor: 2,
        limits: RELAY_INITIAL_LIMITS,
      }),
    } as MessageEvent);
    await settle();
    expect(connector.status().state).toBe("online");
    await connector.stop();
  });

  it("fails enrollment closed when the generated fingerprint is malformed", async () => {
    const clock = scheduler();
    let cancellations = 0;
    let polls = 0;
    const connector = new HubConnector({
      config: enabledConfig,
      identity: identity({
        readState: async () => ({
          version: 1,
          revision: 1,
          environmentId: `env_${"E".repeat(22)}`,
          pendingEnrollment: null,
          activeNode: null,
          stagedRotation: null,
        }),
        startEnrollment: async () => ({
          deviceCode: "ABCD-EFGH",
          expiresAt: 2_000_000,
          pollIntervalMs: 1_000,
          environmentId: `env_${"E".repeat(22)}`,
          publicKey: {
            algorithm: "ed25519",
            publicKey: new Uint8Array(32),
            fingerprint: new Uint8Array(31),
          },
        }),
        pollEnrollment: async () => {
          polls += 1;
          return { status: "pending", retryAfterMs: 1_000 };
        },
        cancelEnrollment: async () => {
          cancellations += 1;
        },
      }),
      transport: { open: () => new FakeSocket() },
      channels: { open: async () => Promise.reject(new Error("unused")) },
      enrollmentMetadata,
      scheduler: clock.value,
    });
    await connector.start();
    await expect(connector.enroll()).rejects.toThrow("Hub enrollment could not be started.");
    expect(connector.status()).toMatchObject({
      state: "degraded",
      degradedMode: "operator_action_required",
      failure: "enrollment_unavailable",
    });
    expect(clock.timers.size).toBe(0);
    await clock.advance(1_000);
    expect(cancellations).toBe(1);
    expect(polls).toBe(0);
    await connector.stop();
  });

  it("resumes pending enrollment after restart and cancels without leaving a poll timer", async () => {
    const clock = scheduler();
    let cancelled = 0;
    let polls = 0;
    const pendingState = {
      version: 1 as const,
      revision: 1,
      environmentId: `env_${"E".repeat(22)}`,
      pendingEnrollment: {
        hubOrigin: "https://relay.example",
        keySecretName: "node-key.fixture",
        pollingSecretName: "enrollment-poll.fixture",
        createdAt: 1,
        expiresAt: 2_000_000,
        pollIntervalMs: 1_000,
        cleanupRequested: false,
      },
      activeNode: null,
      stagedRotation: null,
    };
    const connector = new HubConnector({
      config: enabledConfig,
      identity: identity({
        readState: async () => pendingState,
        pollEnrollment: async () => {
          polls += 1;
          return { status: "pending", retryAfterMs: 1_000 };
        },
        cancelEnrollment: async () => {
          cancelled += 1;
        },
      }),
      transport: { open: () => new FakeSocket() },
      channels: {
        open: async () => {
          throw new Error("unused");
        },
      },
      enrollmentMetadata,
      scheduler: clock.value,
    });
    await connector.start();
    expect(connector.status().state).toBe("awaiting_approval");
    await clock.advance(0);
    expect(polls).toBe(1);
    await connector.cancelEnrollment();
    expect(cancelled).toBe(1);
    expect(connector.status().state).toBe("enrolling");
    expect(clock.timers.size).toBe(0);
    await connector.stop();
  });

  it("fails closed when local enrollment cancellation cannot erase custody", async () => {
    const clock = scheduler();
    const connector = new HubConnector({
      config: enabledConfig,
      identity: identity({
        readState: async () => ({
          version: 1,
          revision: 1,
          environmentId: `env_${"E".repeat(22)}`,
          pendingEnrollment: {
            hubOrigin: "https://relay.example",
            keySecretName: "node-key.fixture",
            pollingSecretName: "enrollment-poll.fixture",
            createdAt: 1,
            expiresAt: 2_000_000,
            pollIntervalMs: 1_000,
            cleanupRequested: false,
          },
          activeNode: null,
          stagedRotation: null,
        }),
        cancelEnrollment: async () => Promise.reject(new Error("custody unavailable")),
      }),
      transport: { open: () => new FakeSocket() },
      channels: { open: async () => Promise.reject(new Error("unused")) },
      enrollmentMetadata,
      scheduler: clock.value,
    });
    await connector.start();
    await expect(connector.cancelEnrollment()).rejects.toThrow(
      "Hub enrollment could not be cancelled.",
    );
    expect(connector.status()).toMatchObject({
      state: "degraded",
      degradedMode: "operator_action_required",
      failure: "enrollment_unavailable",
    });
    expect(clock.timers.size).toBe(0);
    await connector.stop();
  });

  it("stops polling and requires operator action after enrollment denial or expiry", async () => {
    const clock = scheduler();
    const connector = new HubConnector({
      config: enabledConfig,
      identity: identity({
        readState: async () => ({
          version: 1,
          revision: 1,
          environmentId: `env_${"E".repeat(22)}`,
          pendingEnrollment: {
            hubOrigin: "https://relay.example",
            keySecretName: "node-key.fixture",
            pollingSecretName: "enrollment-poll.fixture",
            createdAt: 1,
            expiresAt: 2_000_000,
            pollIntervalMs: 1_000,
            cleanupRequested: false,
          },
          activeNode: null,
          stagedRotation: null,
        }),
        pollEnrollment: async () => ({ status: "unavailable" }),
      }),
      transport: { open: () => new FakeSocket() },
      channels: {
        open: async () => {
          throw new Error("unused");
        },
      },
      enrollmentMetadata,
      scheduler: clock.value,
    });
    await connector.start();
    await clock.advance(0);
    expect(connector.status()).toMatchObject({
      state: "degraded",
      degradedMode: "operator_action_required",
      failure: "enrollment_unavailable",
    });
    expect(clock.timers.size).toBe(0);
    await connector.stop();
  });

  it("ignores an enrollment start that completes after shutdown", async () => {
    let finishEnrollment:
      | ((result: Awaited<ReturnType<HubIdentityRuntimeShape["startEnrollment"]>>) => void)
      | undefined;
    const pendingStart = new Promise<
      Awaited<ReturnType<HubIdentityRuntimeShape["startEnrollment"]>>
    >((resolve) => {
      finishEnrollment = resolve;
    });
    const connector = new HubConnector({
      config: enabledConfig,
      identity: identity({
        readState: async () => ({
          version: 1,
          revision: 1,
          environmentId: `env_${"E".repeat(22)}`,
          pendingEnrollment: null,
          activeNode: null,
          stagedRotation: null,
        }),
        startEnrollment: async () => pendingStart,
      }),
      transport: { open: () => new FakeSocket() },
      channels: {
        open: async () => {
          throw new Error("unused");
        },
      },
      enrollmentMetadata,
    });
    await connector.start();
    const enrolling = connector.enroll();
    await settle();
    await connector.stop();
    finishEnrollment?.({
      deviceCode: "ABCD-EFGH",
      expiresAt: 2_000_000,
      pollIntervalMs: 1_000,
      environmentId: `env_${"E".repeat(22)}`,
      publicKey: {
        algorithm: "ed25519",
        publicKey: new Uint8Array(32),
        fingerprint: new Uint8Array(32),
      },
    });
    await expect(enrolling).rejects.toThrow("superseded");
    expect(connector.status().state).toBe("disabled");
  });
});
