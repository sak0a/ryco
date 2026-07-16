import { describe, expect, it } from "vite-plus/test";

import {
  RELAY_INITIAL_LIMITS,
  type RelayFrame,
  type RelayNodeAuthHandshake,
} from "@ryco/contracts/relay";
import { decodeRelayFrame, encodeRelayFrame } from "@ryco/shared/relayCodec";

import type { HubIdentityRuntimeShape } from "./HubIdentityRuntime.ts";
import type { HubRelaySocket, HubRelaySocketEventMap } from "./HubRelayTransport.ts";
import {
  RelayConnectionError,
  RelayConnectionSession,
  type RelaySessionScheduler,
} from "./RelayConnectionSession.ts";

class FakeSocket implements HubRelaySocket {
  bufferedAmount = 0;
  readyState = 0;
  readonly sent: Uint8Array[] = [];
  readonly listeners = new Map<string, Set<(event: never) => void>>();
  closeCalls = 0;

  send(data: Uint8Array): void {
    this.sent.push(Uint8Array.from(data));
  }

  close(): void {
    this.closeCalls += 1;
  }

  addEventListener<K extends keyof HubRelaySocketEventMap>(
    type: K,
    listener: (event: HubRelaySocketEventMap[K]) => void,
  ): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener as (event: never) => void);
    this.listeners.set(type, listeners);
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
  let challenge = 0;
  return {
    backend: "keytar",
    readState: async () => {
      throw new Error("unused");
    },
    startEnrollment: async () => {
      throw new Error("unused");
    },
    pollEnrollment: async () => {
      throw new Error("unused");
    },
    cancelEnrollment: async () => undefined,
    createRelayAuthenticationFrame: async () => {
      challenge += 1;
      return {
        type: "auth",
        peer: "node",
        protocolMajor: 1,
        protocolMinor: 2,
        nodeId: `node_${"A".repeat(22)}`,
        nonce: new Uint8Array(32).fill(challenge),
        signature: new Uint8Array(64).fill(0x53),
      } as RelayNodeAuthHandshake;
    },
    stageKeyRotation: async () => ({ status: "awaiting_owner" }),
    resumeKeyRotation: async () => ({ status: "awaiting_owner" }),
    confirmAuthenticatedKey: async () => undefined,
  };
}

describe("RelayConnectionSession", () => {
  it("sends canonical auth first, accepts exact ready, and routes later binary frames", async () => {
    const socket = new FakeSocket();
    const routed: RelayFrame[] = [];
    const terminal: RelayConnectionError[] = [];
    const session = new RelayConnectionSession({
      identity: identity(),
      transport: { open: () => socket },
      hubOrigin: "https://relay.example",
      onFrame: (frame) => routed.push(frame),
      onTerminal: (error) => terminal.push(error),
    });
    const authenticating = session.authenticate();
    await Promise.resolve();
    socket.emit("open", {} as Event);
    expect(socket.sent).toHaveLength(1);
    const auth = decodeRelayFrame(socket.sent[0]!);
    expect(auth.ok && auth.value.type).toBe("auth");
    socket.emit("message", {
      data: encoded({
        type: "ready",
        protocolMajor: 1,
        protocolMinor: 2,
        limits: RELAY_INITIAL_LIMITS,
      }),
    } as MessageEvent);
    await expect(authenticating).resolves.toMatchObject({ type: "ready" });

    const ping = {
      type: "ping",
      protocolMajor: 1,
      protocolMinor: 2,
      nonce: new Uint8Array(8).fill(7),
    } as const;
    socket.emit("message", { data: encoded(ping) } as MessageEvent);
    expect(routed).toHaveLength(1);
    expect(routed[0]).toMatchObject({ type: "ping" });
    expect(terminal).toHaveLength(0);
  });

  it("enforces the five-second authentication timeout and removes every listener", async () => {
    const socket = new FakeSocket();
    const callbacks = new Map<number, () => void>();
    let nextHandle = 0;
    const scheduler: RelaySessionScheduler = {
      setTimeout: (callback, milliseconds) => {
        expect(milliseconds).toBe(5_000);
        const handle = ++nextHandle;
        callbacks.set(handle, callback);
        return handle;
      },
      clearTimeout: (handle) => {
        callbacks.delete(handle as number);
      },
    };
    const session = new RelayConnectionSession({
      identity: identity(),
      transport: { open: () => socket },
      hubOrigin: "https://relay.example",
      scheduler,
      onFrame: () => undefined,
      onTerminal: () => undefined,
    });
    const authenticating = session.authenticate();
    await Promise.resolve();
    socket.emit("open", {} as Event);
    callbacks.get(1)?.();
    await expect(authenticating).rejects.toMatchObject({ kind: "authentication_timeout" });
    expect(socket.closeCalls).toBe(1);
    expect([...socket.listeners.values()].every((listeners) => listeners.size === 0)).toBe(true);
  });

  it("maps bounded fatal errors without retaining remote material", async () => {
    const socket = new FakeSocket();
    const session = new RelayConnectionSession({
      identity: identity(),
      transport: { open: () => socket },
      hubOrigin: "https://relay.example",
      onFrame: () => undefined,
      onTerminal: () => undefined,
    });
    const authenticating = session.authenticate();
    await Promise.resolve();
    socket.emit("open", {} as Event);
    socket.emit("message", {
      data: encoded({
        type: "error",
        protocolMajor: 1,
        protocolMinor: 2,
        code: "rate_limited",
        fatal: true,
        retryAfterMs: 30_000,
      }),
    } as MessageEvent);
    let error: unknown;
    try {
      await authenticating;
    } catch (cause) {
      error = cause;
    }
    expect(error).toMatchObject({ kind: "rate_limited", retryAfterMs: 30_000 });
    expect(String(error)).toBe("RelayConnectionError: Hub relay connection failed.");
  });
});
