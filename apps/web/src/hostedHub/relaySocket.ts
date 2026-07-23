import {
  HostedRelayEngine,
  type HostedRelaySocketCallbacks,
  type RelaySocket,
} from "@ryco/client-runtime/relay";

export type { HostedRelaySocketCallbacks };
export interface HostedRelaySocketOptions {
  readonly url: string;
  readonly ticket: string;
  readonly ticketExpiresAt: number;
  readonly callbacks: HostedRelaySocketCallbacks;
  readonly createSocket?: (url: string) => WebSocket;
}
export function hostedRelayWebSocketUrl(): string {
  const url = new URL(window.location.origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/v1/relay/client";
  return url.toString();
}

function isSharedArrayBuffer(value: unknown): value is SharedArrayBuffer {
  return typeof SharedArrayBuffer !== "undefined" && value instanceof SharedArrayBuffer;
}

type InboundMessage =
  | { readonly bytes: Uint8Array }
  | { readonly fail: "frame_too_large" | "protocol_invalid" };

/**
 * Classify a browser WebSocket message exactly as the original façade did.
 * ArrayBuffer / typed-array views are copied to relay bytes. A raw
 * SharedArrayBuffer carries a byte length but is not a readable view, so it
 * fails closed as an invalid frame; text, Blob, and anything else have no relay
 * byte length and fail closed as an oversized frame. Nothing is silently
 * dropped.
 */
function classifyInboundMessage(data: unknown): InboundMessage {
  if (data instanceof ArrayBuffer) return { bytes: new Uint8Array(data.slice(0)) };
  if (data instanceof Uint8Array) return { bytes: Uint8Array.from(data) };
  if (ArrayBuffer.isView(data))
    return {
      bytes: Uint8Array.from(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)),
    };
  if (isSharedArrayBuffer(data)) return { fail: "protocol_invalid" };
  return { fail: "frame_too_large" };
}

/** Map the DOM-free engine's send errors back to the original WebSocket-API
 *  DOMException names at the façade boundary. */
function sendException(error: unknown): unknown {
  if (!(error instanceof Error) || error instanceof DOMException) return error;
  const name =
    error.message === "RPC payload exceeds the negotiated relay limit." ||
    error.message === "Relay send queue is full."
      ? "QuotaExceededError"
      : "InvalidStateError";
  return new DOMException(error.message, name);
}

/** Browser-only EventTarget facade over the package-owned relay engine. */
export class BrowserHostedRelaySocket extends EventTarget {
  readonly url: string;
  readonly protocol = "";
  readonly extensions = "";
  binaryType: BinaryType = "arraybuffer";
  readonly CONNECTING = WebSocket.CONNECTING;
  readonly OPEN = WebSocket.OPEN;
  readonly CLOSING = WebSocket.CLOSING;
  readonly CLOSED = WebSocket.CLOSED;
  onopen: ((this: WebSocket, event: Event) => unknown) | null = null;
  onmessage: ((this: WebSocket, event: MessageEvent) => unknown) | null = null;
  onerror: ((this: WebSocket, event: Event) => unknown) | null = null;
  onclose: ((this: WebSocket, event: CloseEvent) => unknown) | null = null;
  #engine: HostedRelayEngine;
  #state: number = WebSocket.CONNECTING;
  constructor(options: HostedRelaySocketOptions) {
    super();
    this.url = options.url;
    // Fail closed before opening a socket: the bearer ticket may only be sent
    // to the origin-pinned relay endpoint, and an expired attempt must never
    // reach the wire.
    if (options.url !== hostedRelayWebSocketUrl() || options.ticketExpiresAt <= Date.now()) {
      throw new Error("Relay attempt is no longer valid.");
    }
    const ws = (options.createSocket ?? ((url) => new WebSocket(url)))(options.url);
    ws.binaryType = "arraybuffer";
    const socket: RelaySocket = {
      get bufferedAmount() {
        return ws.bufferedAmount;
      },
      get readyState() {
        return ws.readyState;
      },
      send: (b) => ws.send(Uint8Array.from(b).buffer),
      close: (c, r) => ws.close(c, r),
      onOpen: (f) => ws.addEventListener("open", f),
      onBinaryMessage: (f) =>
        ws.addEventListener("message", (e) => {
          const message = classifyInboundMessage(e.data);
          if ("bytes" in message) f(message.bytes);
          else this.#engine.reportUndecodableMessage(message.fail);
        }),
      onClose: (f) => ws.addEventListener("close", f),
      onError: (f) => ws.addEventListener("error", f),
    };
    try {
      this.#engine = new HostedRelayEngine({
        ticket: options.ticket,
        ticketExpiresAt: options.ticketExpiresAt,
        socket,
        callbacks: options.callbacks,
        timers: {
          now: () => Date.now(),
          setTimeout: (f, ms) => globalThis.setTimeout(f, ms),
          clearTimeout: (id) => globalThis.clearTimeout(id as number),
          queueMicrotask: (f) => globalThis.queueMicrotask(f),
        },
        events: {
          onOpen: () => {
            this.#state = WebSocket.OPEN;
            this.#emit("open", new Event("open"));
          },
          onData: (b) => this.#emit("message", new MessageEvent("message", { data: b })),
          onError: () => this.#emit("error", new Event("error")),
          onClose: (c, r) => {
            this.#state = WebSocket.CLOSED;
            this.#emit(
              "close",
              new CloseEvent("close", { code: c, reason: r, wasClean: c === 1000 }),
            );
          },
        },
      });
    } catch (error) {
      try {
        ws.close();
      } catch {
        // The underlying socket may already be closing.
      }
      throw error;
    }
  }
  get readyState() {
    return this.#state;
  }
  get bufferedAmount() {
    return this.#engine.bufferedAmount;
  }
  send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
    const b =
      typeof data === "string"
        ? new TextEncoder().encode(data)
        : data instanceof ArrayBuffer || isSharedArrayBuffer(data)
          ? new Uint8Array(data)
          : ArrayBuffer.isView(data)
            ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
            : (() => {
                throw new DOMException("Blob RPC writes are unsupported.", "DataError");
              })();
    try {
      this.#engine.send(Uint8Array.from(b));
    } catch (error) {
      throw sendException(error);
    }
  }
  close(code = 1000, reason = "") {
    if (this.#state === WebSocket.CLOSED || this.#state === WebSocket.CLOSING) return;
    this.#state = WebSocket.CLOSING;
    this.#engine.close(code, reason);
  }
  #emit(type: "open" | "message" | "error" | "close", event: Event) {
    this.dispatchEvent(event);
    const listener = this[`on${type}`];
    if (listener) listener.call(this as unknown as WebSocket, event as never);
  }
}
export { BrowserHostedRelaySocket as HostedRelayRpcWebSocket };
