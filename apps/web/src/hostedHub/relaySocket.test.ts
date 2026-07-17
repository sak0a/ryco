import {
  RELAY_INITIAL_LIMITS,
  RelayLimits,
  type RelayChannelId,
  type RelayFrame,
} from "@ryco/contracts";
import { decodeRelayFrame, encodeRelayFrame } from "@ryco/shared/relayCodec";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { encodeBase64Url } from "./base64url";
import { HostedRelayRpcWebSocket } from "./relaySocket";
import type { HostedRelaySocketCallbacks } from "./relaySocket";

type Listener = (event: Event | MessageEvent) => void;
const CHANNEL_ID = "ch_cccccccccccccccccccccc" as RelayChannelId;
const VERSION = { protocolMajor: 1, protocolMinor: 2 } as const;

class MockSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readyState = MockSocket.CONNECTING;
  bufferedAmount = 0;
  binaryType: BinaryType = "blob";
  readonly sent: ArrayBuffer[] = [];
  readonly listeners = new Map<string, Set<Listener>>();

  addEventListener(type: string, listener: Listener) {
    const listeners = this.listeners.get(type) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type: string, listener: Listener) {
    this.listeners.get(type)?.delete(listener);
  }
  send(value: string | ArrayBufferLike | Blob | ArrayBufferView) {
    const bytes =
      value instanceof ArrayBuffer
        ? value.slice(0)
        : ArrayBuffer.isView(value)
          ? Uint8Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)).buffer
          : new ArrayBuffer(0);
    this.sent.push(bytes);
  }
  close() {
    this.readyState = MockSocket.CLOSED;
  }
  open() {
    this.readyState = MockSocket.OPEN;
    this.emit("open", new Event("open"));
  }
  frame(frame: RelayFrame) {
    const encoded = encodeRelayFrame(frame);
    if (!encoded.ok) throw new Error("test frame encoding failed");
    this.emit(
      "message",
      new MessageEvent("message", { data: Uint8Array.from(encoded.value).buffer }),
    );
  }
  emit(type: string, event: Event | MessageEvent) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

const originalWindow = globalThis.window;
const originalWebSocket = globalThis.WebSocket;
const sockets: MockSocket[] = [];

function callbacks() {
  return {
    onTransportStatus: vi.fn(),
    onSessionStatus: vi.fn(),
    onRole: vi.fn(),
    onFailure: vi.fn(),
  } satisfies HostedRelaySocketCallbacks;
}

function create(callbackSet = callbacks()) {
  const socket = new HostedRelayRpcWebSocket({
    url: "ws://localhost:3020/v1/relay/client",
    ticket: encodeBase64Url(new Uint8Array(32).fill(7)),
    ticketExpiresAt: Date.now() + 60_000,
    callbacks: callbackSet,
    createSocket: () => {
      const socket = new MockSocket();
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
  });
  return { client: socket, socket: sockets.at(-1)!, callbacks: callbackSet };
}

function authenticate(socket: MockSocket) {
  socket.open();
  const auth = decodeRelayFrame(new Uint8Array(socket.sent[0]!));
  expect(auth.ok && auth.value.type === "auth" && auth.value.peer === "client").toBe(true);
  socket.frame({ type: "ready", ...VERSION, limits: RELAY_INITIAL_LIMITS });
  socket.frame({
    type: "channel.open",
    ...VERSION,
    channelId: CHANNEL_ID,
    capability: "ryco.rpc",
    effectiveRole: "operator",
  });
  socket.frame({ type: "channel.accept", ...VERSION, channelId: CHANNEL_ID });
}

beforeEach(() => {
  sockets.length = 0;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { origin: "http://localhost:3020" } },
  });
  globalThis.WebSocket = MockSocket as unknown as typeof WebSocket;
});

afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  globalThis.WebSocket = originalWebSocket;
  vi.restoreAllMocks();
});

describe("HostedRelayRpcWebSocket", () => {
  it("authenticates with a memory-only first frame and forwards RPC bytes exactly", async () => {
    const { client, socket, callbacks: handlers } = create();
    const messages: Uint8Array[] = [];
    client.addEventListener("message", (event) => {
      messages.push(Uint8Array.from((event as MessageEvent<Uint8Array>).data));
    });
    authenticate(socket);
    expect(handlers.onFailure.mock.calls).toEqual([]);
    expect(client.readyState).toBe(WebSocket.OPEN);
    expect(handlers.onRole).toHaveBeenCalledWith("operator");

    const outbound = new Uint8Array([0, 1, 2, 254, 255]);
    client.send(outbound);
    const sent = decodeRelayFrame(new Uint8Array(socket.sent.at(-1)!));
    expect(sent.ok && sent.value.type === "data" ? [...sent.value.payload] : null).toEqual([
      ...outbound,
    ]);
    expect(sent.ok && sent.value.type === "data" ? sent.value.sequence : null).toBe(0);

    const inbound = new Uint8Array([9, 8, 7, 0, 255]);
    socket.frame({
      type: "data",
      ...VERSION,
      channelId: CHANNEL_ID,
      sequence: 0 as never,
      payload: inbound,
    });
    await Promise.resolve();
    expect(messages.map((value) => Array.from(value))).toEqual([Array.from(inbound)]);
  });

  it("honors flow pause and resume with a bounded per-instance queue", () => {
    const { client, socket } = create();
    authenticate(socket);
    socket.frame({ type: "flow.pause", ...VERSION, channelId: CHANNEL_ID });
    const sentBefore = socket.sent.length;
    client.send(new Uint8Array([1, 2, 3]));
    expect(socket.sent).toHaveLength(sentBefore);
    socket.frame({ type: "flow.resume", ...VERSION, channelId: CHANNEL_ID });
    expect(socket.sent).toHaveLength(sentBefore + 1);
  });

  it("responds to canonical heartbeat pings", () => {
    const { socket } = create();
    authenticate(socket);
    socket.frame({ type: "ping", ...VERSION, nonce: new Uint8Array(8).fill(4) });
    const response = decodeRelayFrame(new Uint8Array(socket.sent.at(-1)!));
    expect(response.ok && response.value.type === "pong").toBe(true);
  });

  it("enforces the five-second client authentication deadline", () => {
    vi.useFakeTimers();
    const handlers = callbacks();
    const { socket } = create(handlers);
    socket.open();
    vi.advanceTimersByTime(5_000);
    expect(handlers.onFailure).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "authentication" }),
    );
  });

  it("keeps tabs independent and rejects duplicate inbound sequences", async () => {
    const firstHandlers = callbacks();
    const secondHandlers = callbacks();
    const first = create(firstHandlers);
    const second = create(secondHandlers);
    authenticate(first.socket);
    authenticate(second.socket);
    first.socket.frame({
      type: "data",
      ...VERSION,
      channelId: CHANNEL_ID,
      sequence: 1 as never,
      payload: new Uint8Array([1]),
    });
    await Promise.resolve();
    expect(firstHandlers.onFailure).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "protocol" }),
    );
    expect(second.client.readyState).toBe(WebSocket.OPEN);
    expect(secondHandlers.onFailure).not.toHaveBeenCalled();
  });

  it("bounds slow-consumer queues using negotiated limits", () => {
    const handlers = callbacks();
    const { client, socket } = create(handlers);
    socket.open();
    socket.frame({
      type: "ready",
      ...VERSION,
      limits: RelayLimits.make({
        ...RELAY_INITIAL_LIMITS,
        maxControlFrameBytes: 1_024,
        maxDataChunkBytes: 1_024,
        maxQueuedBytes: 2_048,
      }),
    });
    socket.frame({
      type: "channel.open",
      ...VERSION,
      channelId: CHANNEL_ID,
      capability: "ryco.rpc",
      effectiveRole: "operator",
    });
    socket.frame({ type: "channel.accept", ...VERSION, channelId: CHANNEL_ID });
    socket.frame({ type: "flow.pause", ...VERSION, channelId: CHANNEL_ID });
    expect(() => client.send(new Uint8Array(1_024))).toThrow("queue is full");
    expect(handlers.onFailure).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "slow-consumer", retryable: true }),
    );
  });

  it.each([
    ["node_offline", "offline", true],
    ["server_draining", "draining", true],
    ["connection_replaced", "replacement", true],
    ["ticket_expired", "authentication", true],
    ["authentication_required", "authentication", false],
    ["node_revoked", "revoked", false],
    ["authorization_failed", "authorization-removed", false],
    ["protocol_unsupported", "incompatible", false],
  ] as const)("classifies %s relay failures", (code, kind, retryable) => {
    const handlers = callbacks();
    const { socket } = create(handlers);
    authenticate(socket);
    socket.frame({
      type: "error",
      ...VERSION,
      code,
      fatal: !retryable,
      ...(code === "protocol_unsupported"
        ? { supported: { protocolMajor: 1, minimumMinor: 0, maximumMinor: 2 } }
        : {}),
    });
    expect(handlers.onFailure).toHaveBeenCalledWith(expect.objectContaining({ kind, retryable }));
    expect(handlers.onSessionStatus).not.toHaveBeenCalledWith("closed");
  });
});
