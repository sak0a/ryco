import {
  RELAY_INITIAL_LIMITS,
  RELAY_MAX_RPC_MESSAGE_BYTES,
  RelayLimits,
  type RelayChannelId,
  type RelayFrame,
} from "@ryco/contracts";
import { decodeRelayFrame, encodeRelayFrame } from "@ryco/shared/relayCodec";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { encodeBase64Url } from "./base64url";
import {
  HostedRelayEngine,
  type HostedRelaySocketCallbacks,
  type RelaySocket,
  type RelayTimers,
} from "./relayEngine";

const CHANNEL_ID = "ch_cccccccccccccccccccccc" as RelayChannelId;
const VERSION = { protocolMajor: 1, protocolMinor: 2 } as const;
const OPEN = 1;

/**
 * Fake raw-byte socket implementing the package's `RelaySocket` seam. The
 * engine owns every buffer it passes to `send`, so the fake keeps two views:
 * `sent` is a snapshot taken at call time (what actually went on the wire) and
 * `sentRefs` retains the engine's own buffer so a test can observe that the
 * engine zeroes it afterwards.
 */
class MockRelaySocket implements RelaySocket {
  readyState = 0;
  bufferedAmount = 0;
  readonly sent: Uint8Array[] = [];
  readonly sentRefs: Uint8Array[] = [];
  #open: Array<() => void> = [];
  #message: Array<(bytes: Uint8Array) => void> = [];
  #close: Array<() => void> = [];
  #error: Array<() => void> = [];

  send(bytes: Uint8Array): void {
    this.sentRefs.push(bytes);
    this.sent.push(Uint8Array.from(bytes));
  }
  close(): void {
    this.readyState = 3;
  }
  onOpen(listener: () => void): void {
    this.#open.push(listener);
  }
  onBinaryMessage(listener: (bytes: Uint8Array) => void): void {
    this.#message.push(listener);
  }
  onClose(listener: () => void): void {
    this.#close.push(listener);
  }
  onError(listener: () => void): void {
    this.#error.push(listener);
  }

  open(): void {
    this.readyState = OPEN;
    for (const listener of this.#open) listener();
  }
  emitClose(): void {
    for (const listener of this.#close) listener();
  }
  emitError(): void {
    for (const listener of this.#error) listener();
  }
  frame(frame: RelayFrame): void {
    const encoded = encodeRelayFrame(frame);
    if (!encoded.ok) throw new Error("test frame encoding failed");
    for (const listener of this.#message) listener(Uint8Array.from(encoded.value));
  }
}

function callbacks() {
  return {
    onTransportStatus: vi.fn(),
    onSessionStatus: vi.fn(),
    onRole: vi.fn(),
    onFailure: vi.fn(),
  } satisfies HostedRelaySocketCallbacks;
}

function realTimers(): RelayTimers {
  return {
    now: () => Date.now(),
    setTimeout: (cb, ms) => globalThis.setTimeout(cb, ms),
    clearTimeout: (id) => globalThis.clearTimeout(id as ReturnType<typeof setTimeout>),
    queueMicrotask: (cb) => globalThis.queueMicrotask(cb),
  };
}

function create(callbackSet = callbacks(), timers: RelayTimers = realTimers()) {
  const socket = new MockRelaySocket();
  const events = {
    onOpen: vi.fn(),
    onData: vi.fn(),
    onError: vi.fn(),
    onClose: vi.fn(),
  };
  const engine = new HostedRelayEngine({
    ticket: encodeBase64Url(new Uint8Array(32).fill(7)),
    ticketExpiresAt: Date.now() + 60_000,
    socket,
    timers,
    callbacks: callbackSet,
    events,
  });
  return { engine, socket, callbacks: callbackSet, events };
}

function authenticate(socket: MockRelaySocket) {
  socket.open();
  const auth = decodeRelayFrame(socket.sent[0]!);
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
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("HostedRelayEngine", () => {
  it("authenticates with a memory-only first frame and forwards RPC bytes exactly", async () => {
    const { engine, socket, callbacks: handlers, events } = create();
    const received: number[][] = [];
    events.onData.mockImplementation((bytes: Uint8Array) => received.push([...bytes]));

    authenticate(socket);
    expect(handlers.onFailure.mock.calls).toEqual([]);
    expect(events.onOpen).toHaveBeenCalledOnce();
    expect(handlers.onTransportStatus).toHaveBeenCalledWith("online");
    expect(handlers.onSessionStatus).toHaveBeenCalledWith("synchronizing");
    expect(handlers.onRole).toHaveBeenCalledWith("operator");

    const outbound = new Uint8Array([0, 1, 2, 254, 255]);
    engine.send(outbound);
    const sent = decodeRelayFrame(socket.sent.at(-1)!);
    expect(sent.ok && sent.value.type === "data" ? [...sent.value.payload] : null).toEqual([
      0, 1, 2, 254, 255,
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
    expect(received).toEqual([[9, 8, 7, 0, 255]]);
  });

  it("zeroes the ticket-bearing authentication frame after sending it", () => {
    const { socket } = create();
    socket.open();
    const authRef = socket.sentRefs[0]!;
    const authSnapshot = decodeRelayFrame(socket.sent[0]!);
    // The frame that actually went on the wire was a real client auth frame…
    expect(authSnapshot.ok && authSnapshot.value.type === "auth").toBe(true);
    // …and the engine's own buffer holding the ticket is zeroed immediately after.
    expect(authRef.length).toBeGreaterThan(0);
    expect([...authRef].every((byte) => byte === 0)).toBe(true);
  });

  it("responds to canonical heartbeat pings", () => {
    const { socket } = create();
    authenticate(socket);
    socket.frame({ type: "ping", ...VERSION, nonce: new Uint8Array(8).fill(4) });
    const response = decodeRelayFrame(socket.sent.at(-1)!);
    expect(response.ok && response.value.type === "pong").toBe(true);
  });

  it("enforces the five-second client authentication deadline", () => {
    vi.useFakeTimers();
    const handlers = callbacks();
    const { socket } = create(handlers, realTimers());
    socket.open();
    vi.advanceTimersByTime(5_000);
    expect(handlers.onFailure).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "authentication" }),
    );
  });

  it("does not retain or send the authentication frame after a pre-open close", () => {
    const { engine, socket } = create();
    engine.close();
    socket.open();
    expect(socket.sent).toEqual([]);
    expect(socket.sentRefs).toEqual([]);
  });

  it("honors flow pause and resume with a bounded per-instance queue", () => {
    const { engine, socket } = create();
    authenticate(socket);
    socket.frame({ type: "flow.pause", ...VERSION, channelId: CHANNEL_ID });
    const before = socket.sent.length;

    engine.send(new Uint8Array([1, 2, 3]));
    engine.send(new Uint8Array([4, 5, 6]));
    // Paused: data frames must queue, not go on the wire.
    expect(socket.sent.length).toBe(before);

    socket.frame({ type: "flow.resume", ...VERSION, channelId: CHANNEL_ID });
    // Resumed: the queue flushes in submission order with monotonic sequences.
    expect(socket.sent.length).toBe(before + 2);
    const first = decodeRelayFrame(socket.sent[before]!);
    const second = decodeRelayFrame(socket.sent[before + 1]!);
    expect(
      first.ok && first.value.type === "data"
        ? [[...first.value.payload], first.value.sequence]
        : null,
    ).toEqual([[1, 2, 3], 0]);
    expect(
      second.ok && second.value.type === "data"
        ? [[...second.value.payload], second.value.sequence]
        : null,
    ).toEqual([[4, 5, 6], 1]);
  });

  it("keeps engines independent and rejects duplicate inbound sequences", async () => {
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
    expect(second.socket.readyState).toBe(OPEN);
    expect(secondHandlers.onFailure).not.toHaveBeenCalled();
  });

  it("rejects data payloads above the reassembly ceiling", () => {
    const handlers = callbacks();
    const { engine, socket } = create(handlers);
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
    // A message over the per-frame limit is now split rather than refused, so
    // only one above the reassembly ceiling is rejected.
    expect(() => engine.send(new Uint8Array(RELAY_MAX_RPC_MESSAGE_BYTES + 1))).toThrow(
      "RPC payload exceeds the maximum relay message size.",
    );
    expect(handlers.onFailure).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "protocol", retryable: false }),
    );
  });

  it("bounds the outbound send queue using negotiated limits", () => {
    const handlers = callbacks();
    const { engine, socket } = create(handlers);
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
    expect(() => engine.send(new Uint8Array(1_024))).toThrow("queue is full");
    expect(handlers.onFailure).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "slow-consumer", retryable: true }),
    );
  });

  it("bounds the inbound queue at the negotiated memory limit", () => {
    const handlers = callbacks();
    const { socket } = create(handlers);
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
    // Three in-limit chunks arrive before any microtask drains: 1024, 2048, then
    // the third would push queued bytes past the negotiated maxQueuedBytes.
    for (let sequence = 0; sequence < 3; sequence += 1) {
      socket.frame({
        type: "data",
        ...VERSION,
        channelId: CHANNEL_ID,
        sequence: sequence as never,
        payload: new Uint8Array(1_024),
      });
    }
    expect(handlers.onFailure).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "slow-consumer", retryable: true }),
    );
  });

  it("rejects inbound data delivered before the channel handshake completes", () => {
    const handlers = callbacks();
    const { socket, events } = create(handlers);
    socket.open();
    socket.frame({ type: "ready", ...VERSION, limits: RELAY_INITIAL_LIMITS });
    socket.frame({
      type: "channel.open",
      ...VERSION,
      channelId: CHANNEL_ID,
      capability: "ryco.rpc",
      effectiveRole: "operator",
    });
    // No channel.accept: a peer must not push RPC data during authorization.
    socket.frame({
      type: "data",
      ...VERSION,
      channelId: CHANNEL_ID,
      sequence: 0 as never,
      payload: new Uint8Array([1, 2, 3]),
    });
    expect(handlers.onFailure).toHaveBeenCalledWith(expect.objectContaining({ kind: "protocol" }));
    expect(events.onData).not.toHaveBeenCalled();
  });

  it("rejects outbound sends before the channel handshake completes", () => {
    const { engine, socket } = create();
    socket.open();
    socket.frame({ type: "ready", ...VERSION, limits: RELAY_INITIAL_LIMITS });
    socket.frame({
      type: "channel.open",
      ...VERSION,
      channelId: CHANNEL_ID,
      capability: "ryco.rpc",
      effectiveRole: "operator",
    });
    expect(() => engine.send(new Uint8Array([1, 2, 3]))).toThrow("Relay channel is not open.");
  });

  it("emits the draining transport status on an intentional close", () => {
    const handlers = callbacks();
    const { engine, socket } = create(handlers);
    authenticate(socket);
    handlers.onTransportStatus.mockClear();
    engine.close();
    expect(handlers.onTransportStatus).toHaveBeenCalledWith("draining");
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
