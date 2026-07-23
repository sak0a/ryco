import { RELAY_INITIAL_LIMITS, type RelayChannelId, type RelayFrame } from "@ryco/contracts";
import { encodeBase64Url } from "@ryco/client-runtime/relay";
import { decodeRelayFrame, encodeRelayFrame } from "@ryco/shared/relayCodec";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { BrowserHostedRelaySocket, hostedRelayWebSocketUrl } from "./relaySocket";

/**
 * Facade-level tests for the browser relay adapter (the DOM boundary the
 * package engine cannot cover): destination/expiry validation before a socket
 * is opened, wire coercion of every browser message type, and the
 * draining/closed status transitions.
 */

const CHANNEL_ID = "ch_cccccccccccccccccccccc" as RelayChannelId;
const VERSION = { protocolMajor: 1, protocolMinor: 2 } as const;
const originalWindow = globalThis.window;

class MockWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readyState = MockWebSocket.CONNECTING;
  bufferedAmount = 0;
  binaryType: BinaryType = "blob";
  closeCalls = 0;
  readonly sent: ArrayBuffer[] = [];

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    this.sent.push(
      data instanceof ArrayBuffer
        ? data.slice(0)
        : ArrayBuffer.isView(data)
          ? Uint8Array.from(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)).buffer
          : new ArrayBuffer(0),
    );
  }
  close(): void {
    this.closeCalls += 1;
    this.readyState = MockWebSocket.CLOSED;
  }
  open(): void {
    this.readyState = MockWebSocket.OPEN;
    this.dispatchEvent(new Event("open"));
  }
  deliver(data: unknown): void {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }
  frame(frame: RelayFrame): void {
    const encoded = encodeRelayFrame(frame);
    if (!encoded.ok) throw new Error("test frame encoding failed");
    this.deliver(Uint8Array.from(encoded.value).buffer);
  }
}

function callbacks() {
  return {
    onTransportStatus: vi.fn(),
    onSessionStatus: vi.fn(),
    onRole: vi.fn(),
    onFailure: vi.fn(),
  };
}

function create(handlers = callbacks()) {
  const sockets: MockWebSocket[] = [];
  const facade = new BrowserHostedRelaySocket({
    url: hostedRelayWebSocketUrl(),
    ticket: encodeBase64Url(new Uint8Array(32).fill(7)),
    ticketExpiresAt: Date.now() + 60_000,
    callbacks: handlers,
    createSocket: () => {
      const socket = new MockWebSocket();
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
  });
  return { facade, socket: sockets[0]!, handlers };
}

function authenticate(socket: MockWebSocket) {
  socket.open();
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

function lastPayload(socket: MockWebSocket): number[] | null {
  const decoded = decodeRelayFrame(new Uint8Array(socket.sent.at(-1)!));
  return decoded.ok && decoded.value.type === "data" ? [...decoded.value.payload] : null;
}

beforeEach(() => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { origin: "https://hub.example.test" } },
  });
});

afterEach(() => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  vi.restoreAllMocks();
});

describe("BrowserHostedRelaySocket destination validation", () => {
  it("rejects a non-relay destination before opening a socket or sending the ticket", () => {
    const sockets: MockWebSocket[] = [];
    expect(
      () =>
        new BrowserHostedRelaySocket({
          url: "wss://evil.example.test/v1/relay/client",
          ticket: encodeBase64Url(new Uint8Array(32).fill(7)),
          ticketExpiresAt: Date.now() + 60_000,
          callbacks: callbacks(),
          createSocket: () => {
            const socket = new MockWebSocket();
            sockets.push(socket);
            return socket as unknown as WebSocket;
          },
        }),
    ).toThrow("Relay attempt is no longer valid.");
    expect(sockets).toHaveLength(0);
  });

  it("rejects an expired ticket before opening a socket", () => {
    const sockets: MockWebSocket[] = [];
    expect(
      () =>
        new BrowserHostedRelaySocket({
          url: hostedRelayWebSocketUrl(),
          ticket: encodeBase64Url(new Uint8Array(32).fill(7)),
          ticketExpiresAt: Date.now() - 1,
          callbacks: callbacks(),
          createSocket: () => {
            const socket = new MockWebSocket();
            sockets.push(socket);
            return socket as unknown as WebSocket;
          },
        }),
    ).toThrow("Relay attempt is no longer valid.");
    expect(sockets).toHaveLength(0);
  });

  it("closes the created socket when engine construction fails after prevalidation", () => {
    const sockets: MockWebSocket[] = [];
    // URL and expiry prevalidation pass, so the socket is created — but the
    // ticket material is undecodable, so the engine constructor throws.
    expect(
      () =>
        new BrowserHostedRelaySocket({
          url: hostedRelayWebSocketUrl(),
          ticket: "not valid base64url!!!",
          ticketExpiresAt: Date.now() + 60_000,
          callbacks: callbacks(),
          createSocket: () => {
            const socket = new MockWebSocket();
            sockets.push(socket);
            return socket as unknown as WebSocket;
          },
        }),
    ).toThrow("Invalid encoded material.");
    expect(sockets).toHaveLength(1);
    expect(sockets[0]!.closeCalls).toBe(1);
    expect(sockets[0]!.readyState).toBe(MockWebSocket.CLOSED);
  });
});

describe("BrowserHostedRelaySocket wire compatibility", () => {
  it("coerces string, ArrayBuffer, typed-array, and SharedArrayBuffer send inputs", () => {
    const { facade, socket } = create();
    authenticate(socket);

    facade.send(new Uint8Array([1, 2, 3]).buffer);
    expect(lastPayload(socket)).toEqual([1, 2, 3]);
    facade.send(new Uint8Array([4, 5, 6]));
    expect(lastPayload(socket)).toEqual([4, 5, 6]);
    facade.send(new DataView(new Uint8Array([7, 8, 9]).buffer));
    expect(lastPayload(socket)).toEqual([7, 8, 9]);
    facade.send("AB");
    expect(lastPayload(socket)).toEqual([65, 66]);
    if (typeof SharedArrayBuffer !== "undefined") {
      const shared = new SharedArrayBuffer(3);
      new Uint8Array(shared).set([10, 11, 12]);
      facade.send(shared);
      expect(lastPayload(socket)).toEqual([10, 11, 12]);
    }
  });

  it("rejects Blob send inputs", () => {
    const { facade, socket } = create();
    authenticate(socket);
    expect(() => facade.send(new Blob([new Uint8Array([1])]))).toThrow(
      "Blob RPC writes are unsupported.",
    );
  });

  it("throws an InvalidStateError when sending before the channel handshake completes", () => {
    const { facade } = create();
    // No authenticate: the engine has no accepted channel yet, and the
    // WebSocket-API contract requires an InvalidStateError DOMException.
    let thrown: unknown;
    try {
      facade.send(new Uint8Array([1, 2, 3]));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(DOMException);
    expect((thrown as DOMException).name).toBe("InvalidStateError");
    expect((thrown as DOMException).message).toBe("Relay channel is not open.");
  });

  it("delivers ArrayBuffer and typed-array inbound messages", async () => {
    const { facade, socket } = create();
    const received: number[][] = [];
    facade.addEventListener("message", (event) =>
      received.push([...new Uint8Array((event as MessageEvent).data)]),
    );
    authenticate(socket);

    socket.frame({
      type: "data",
      ...VERSION,
      channelId: CHANNEL_ID,
      sequence: 0 as never,
      payload: new Uint8Array([9, 8, 7]),
    });
    const secondFrame = encodeRelayFrame({
      type: "data",
      ...VERSION,
      channelId: CHANNEL_ID,
      sequence: 1 as never,
      payload: new Uint8Array([6, 5, 4]),
    });
    if (!secondFrame.ok) throw new Error("test frame encoding failed");
    // Deliver the second inbound frame as a typed-array view rather than an
    // ArrayBuffer, exercising the view branch of the message coercion.
    socket.deliver(Uint8Array.from(secondFrame.value));

    for (let hop = 0; hop < 6; hop += 1) await Promise.resolve();
    expect(received).toEqual([
      [9, 8, 7],
      [6, 5, 4],
    ]);
  });

  it("classifies a non-binary inbound message as an oversized frame, not a dropped payload", () => {
    const handlers = callbacks();
    const { socket } = create(handlers);
    socket.open();
    socket.deliver("this is a text frame, not relay bytes");
    // The original façade classified a message with no relay byte length as
    // frame_too_large — assert that exact close reason, not protocol_invalid.
    expect(handlers.onFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "protocol",
        retryable: false,
        closeReason: "frame_too_large",
      }),
    );
  });

  it("fails closed on a direct inbound SharedArrayBuffer", () => {
    if (typeof SharedArrayBuffer === "undefined") return;
    const handlers = callbacks();
    const { socket } = create(handlers);
    socket.open();
    socket.deliver(new SharedArrayBuffer(8));
    expect(handlers.onFailure).toHaveBeenCalledWith(expect.objectContaining({ kind: "protocol" }));
    // A raw SharedArrayBuffer is an invalid frame (protocol_invalid), which
    // carries no close reason — distinct from the oversized-frame case.
    const failure = handlers.onFailure.mock.calls.at(-1)?.[0] as { closeReason?: string };
    expect(failure.closeReason).toBeUndefined();
  });

  it("emits draining on close and guards an already-closed facade", () => {
    const handlers = callbacks();
    const { facade, socket } = create(handlers);
    authenticate(socket);
    handlers.onTransportStatus.mockClear();

    facade.close();
    expect(handlers.onTransportStatus).toHaveBeenCalledWith("draining");
    expect(facade.readyState).toBe(WebSocket.CLOSED);

    handlers.onTransportStatus.mockClear();
    facade.close();
    expect(facade.readyState).toBe(WebSocket.CLOSED);
    expect(handlers.onTransportStatus).not.toHaveBeenCalled();
  });
});
