import {
  RELAY_AUTHENTICATION_DEADLINE_MS,
  RELAY_MAX_CONTROL_FRAME_BYTES,
  RELAY_MAX_DATA_CHUNK_BYTES,
  RELAY_MAX_DATA_FRAME_OVERHEAD_BYTES,
  RELAY_MAX_DATA_FRAME_BYTES,
  RELAY_PROTOCOL_MAJOR,
  RELAY_PROTOCOL_MINOR,
  type RelayChannelId,
  type RelayCloseReason,
  type RelayEffectiveRole,
  type RelayFrame,
  type RelayLimits,
} from "@ryco/contracts";
import { decodeRelayFrame, encodeRelayFrame } from "@ryco/shared/relayCodec";

import { decodeBase64Url } from "./base64url";
import type {
  HostedRelayFailure,
  HostedRelayTransportStatus,
  HostedRycoSessionStatus,
} from "./types";

const VERSION = {
  protocolMajor: RELAY_PROTOCOL_MAJOR,
  protocolMinor: RELAY_PROTOCOL_MINOR,
} as const;
const QUEUE_ENTRY_OVERHEAD_BYTES = 32;

export interface HostedRelaySocketCallbacks {
  readonly onTransportStatus: (status: HostedRelayTransportStatus) => void;
  readonly onSessionStatus: (status: HostedRycoSessionStatus) => void;
  readonly onRole: (role: RelayEffectiveRole | null) => void;
  readonly onFailure: (failure: HostedRelayFailure) => void;
}

export interface HostedRelaySocketOptions {
  readonly url: string;
  readonly ticket: string;
  readonly ticketExpiresAt: number;
  readonly callbacks: HostedRelaySocketCallbacks;
  readonly createSocket?: (url: string) => WebSocket;
}

interface QueuedPayload {
  readonly bytes: Uint8Array;
  readonly reservedBytes: number;
}

function relayFailure(
  reason: RelayCloseReason | "protocol_invalid" | "network",
): HostedRelayFailure {
  switch (reason) {
    case "node_offline":
      return { kind: "offline", retryable: true, closeReason: reason };
    case "server_draining":
      return { kind: "draining", retryable: true, closeReason: reason };
    case "connection_replaced":
      return { kind: "replacement", retryable: true, closeReason: reason };
    case "rate_limited":
      return { kind: "rate-limited", retryable: true, closeReason: reason };
    case "slow_consumer":
      return { kind: "slow-consumer", retryable: true, closeReason: reason };
    case "revoked":
    case "node_revoked":
    case "grant_revoked":
      return { kind: "revoked", retryable: false, closeReason: reason };
    case "authorization_failed":
      return { kind: "authorization-removed", retryable: false, closeReason: reason };
    case "authentication_failed":
    case "authentication_required":
    case "ticket_expired":
    case "ticket_consumed":
    case "authentication_timeout":
      return {
        kind: "authentication",
        retryable: reason !== "authentication_required",
        closeReason: reason,
      };
    case "protocol_unsupported":
      return { kind: "incompatible", retryable: false, closeReason: reason };
    case "protocol_invalid":
    case "frame_too_large":
    case "channel_rejected":
    case "transfer_limit":
      return {
        kind: "protocol",
        retryable: false,
        ...(reason === "protocol_invalid" ? {} : { closeReason: reason }),
      };
    case "network":
      return { kind: "network", retryable: true };
    default:
      return { kind: "internal", retryable: true, closeReason: reason };
  }
}

function binaryMessage(value: unknown): Uint8Array | null {
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (value instanceof Uint8Array) return Uint8Array.from(value);
  if (ArrayBuffer.isView(value)) {
    return Uint8Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  }
  return null;
}

function binaryMessageByteLength(value: unknown): number | null {
  if (value instanceof ArrayBuffer || value instanceof SharedArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  return null;
}

function ownedBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

function relayWebSocketUrl(): string {
  const url = new URL(window.location.origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/v1/relay/client";
  return url.toString();
}

export class HostedRelayRpcWebSocket extends EventTarget {
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

  readonly #callbacks: HostedRelaySocketCallbacks;
  readonly #socket: WebSocket;
  #readyState: number = WebSocket.CONNECTING;
  #limits: RelayLimits | null = null;
  #channelId: RelayChannelId | null = null;
  #role: RelayEffectiveRole | null = null;
  #inboundSequence = 0;
  #outboundSequence = 0;
  #outboundPaused = false;
  #outboundQueue: QueuedPayload[] = [];
  #outboundQueuedBytes = 0;
  #inboundQueue: Uint8Array[] = [];
  #inboundQueuedBytes = 0;
  #inboundPaused = false;
  #drainingInbound = false;
  #closed = false;
  #failureReported = false;
  #authenticationTimer: ReturnType<typeof setTimeout> | null = null;
  #flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: HostedRelaySocketOptions) {
    super();
    this.url = options.url;
    this.#callbacks = options.callbacks;
    if (options.url !== relayWebSocketUrl() || options.ticketExpiresAt <= Date.now()) {
      throw new Error("Relay attempt is no longer valid.");
    }
    const ticket = decodeBase64Url(options.ticket);
    let authenticationBytes: Uint8Array;
    try {
      const encoded = encodeRelayFrame({
        type: "auth",
        peer: "client",
        ...VERSION,
        relayTicket: ticket,
      });
      if (!encoded.ok) throw new Error("Relay authentication could not be encoded.");
      authenticationBytes = encoded.value;
    } finally {
      ticket.fill(0);
    }
    this.#callbacks.onTransportStatus("connecting");
    this.#socket = (options.createSocket ?? ((url) => new WebSocket(url)))(options.url);
    this.#socket.binaryType = "arraybuffer";
    this.#socket.addEventListener("open", () => {
      if (this.#closed) return;
      this.#callbacks.onTransportStatus("authenticating");
      try {
        this.#socket.send(ownedBuffer(authenticationBytes));
      } finally {
        authenticationBytes.fill(0);
      }
      this.#authenticationTimer = setTimeout(
        () => this.#fail(relayFailure("authentication_timeout")),
        RELAY_AUTHENTICATION_DEADLINE_MS,
      );
    });
    this.#socket.addEventListener("message", (event) => this.#receive(event.data));
    this.#socket.addEventListener("error", () => {
      if (!this.#closed) this.#emitError();
    });
    this.#socket.addEventListener("close", () => {
      if (!this.#closed) this.#fail(relayFailure("network"));
    });
  }

  get readyState(): number {
    return this.#readyState;
  }

  get bufferedAmount(): number {
    return this.#socket.bufferedAmount + this.#outboundQueuedBytes;
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    if (this.#readyState !== WebSocket.OPEN || this.#channelId === null) {
      throw new DOMException("Relay channel is not open.", "InvalidStateError");
    }
    if (data instanceof Blob)
      throw new DOMException("Blob RPC writes are unsupported.", "DataError");
    const payload =
      typeof data === "string"
        ? new TextEncoder().encode(data)
        : data instanceof ArrayBuffer || data instanceof SharedArrayBuffer
          ? Uint8Array.from(new Uint8Array(data))
          : Uint8Array.from(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    const limits = this.#limits;
    if (!limits || payload.byteLength > limits.maxDataChunkBytes) {
      payload.fill(0);
      this.#fail(relayFailure("transfer_limit"));
      throw new DOMException(
        "RPC payload exceeds the negotiated relay limit.",
        "QuotaExceededError",
      );
    }
    this.#enqueueOutbound(payload);
  }

  close(code = 1000, reason = ""): void {
    if (this.#closed) return;
    this.#readyState = WebSocket.CLOSING;
    this.#callbacks.onTransportStatus("draining");
    if (this.#channelId) {
      this.#sendFrame({ type: "channel.close", ...VERSION, channelId: this.#channelId });
    }
    this.#finish(this.#failureReported ? 4000 : code, reason || "closed");
  }

  #receive(raw: unknown): void {
    const rawByteLength = binaryMessageByteLength(raw);
    if (rawByteLength === null || rawByteLength > RELAY_MAX_DATA_FRAME_BYTES) {
      this.#fail(relayFailure("frame_too_large"));
      return;
    }
    const bytes = binaryMessage(raw);
    if (!bytes) {
      this.#fail(relayFailure("protocol_invalid"));
      return;
    }
    const decoded = decodeRelayFrame(bytes, this.#limits ? { expectedVersion: VERSION } : {});
    bytes.fill(0);
    if (!decoded.ok) {
      this.#fail(relayFailure("protocol_invalid"));
      return;
    }
    const frame = decoded.value;
    const negotiatedFrameLimit =
      frame.type === "data"
        ? (this.#limits?.maxDataChunkBytes ?? RELAY_MAX_DATA_CHUNK_BYTES) +
          RELAY_MAX_DATA_FRAME_OVERHEAD_BYTES
        : (this.#limits?.maxControlFrameBytes ?? RELAY_MAX_CONTROL_FRAME_BYTES);
    if (rawByteLength > negotiatedFrameLimit) {
      this.#fail(relayFailure("frame_too_large"));
      return;
    }
    if (frame.type === "ping") {
      this.#sendFrame({ type: "pong", ...VERSION, nonce: Uint8Array.from(frame.nonce) });
      return;
    }
    if (frame.type === "error") {
      const failure = relayFailure(
        frame.code === "invalid_encoding" ||
          frame.code === "invalid_frame" ||
          frame.code === "invalid_limits" ||
          frame.code === "missing_discriminant" ||
          frame.code === "unknown_frame_type"
          ? "protocol_invalid"
          : frame.code,
      );
      this.#fail({
        ...failure,
        ...(frame.retryAfterMs === undefined ? {} : { retryAfterMs: frame.retryAfterMs }),
      });
      return;
    }
    if (!this.#limits) {
      if (frame.type !== "ready" || frame.protocolMajor !== 1 || frame.protocolMinor !== 2) {
        this.#fail(
          relayFailure(frame.type === "ready" ? "protocol_unsupported" : "protocol_invalid"),
        );
        return;
      }
      this.#limits = frame.limits;
      if (this.#authenticationTimer) clearTimeout(this.#authenticationTimer);
      this.#authenticationTimer = null;
      this.#callbacks.onTransportStatus("opening-channel");
      return;
    }
    if (frame.type === "channel.open") {
      if (this.#channelId || frame.capability !== "ryco.rpc" || frame.effectiveRole === undefined) {
        this.#fail(relayFailure("channel_rejected"));
        return;
      }
      this.#channelId = frame.channelId;
      this.#role = frame.effectiveRole;
      this.#callbacks.onRole(frame.effectiveRole);
      return;
    }
    if (frame.type === "channel.accept") {
      if (frame.channelId !== this.#channelId || !this.#role) {
        this.#fail(relayFailure("channel_rejected"));
        return;
      }
      this.#readyState = WebSocket.OPEN;
      this.#callbacks.onTransportStatus("online");
      this.#callbacks.onSessionStatus("synchronizing");
      this.#emit("open", new Event("open"));
      return;
    }
    if (frame.type === "channel.reject" || frame.type === "channel.close") {
      if (frame.channelId !== this.#channelId) {
        this.#fail(relayFailure("channel_rejected"));
        return;
      }
      this.#fail(relayFailure(frame.reason ?? "channel_rejected"));
      return;
    }
    if (frame.type === "flow.pause" || frame.type === "flow.resume") {
      if (frame.channelId !== this.#channelId) {
        this.#fail(relayFailure("channel_rejected"));
        return;
      }
      this.#outboundPaused = frame.type === "flow.pause";
      if (!this.#outboundPaused) this.#flushOutbound();
      return;
    }
    if (frame.type === "data") this.#receiveData(frame);
  }

  #receiveData(frame: Extract<RelayFrame, { readonly type: "data" }>): void {
    if (
      this.#readyState !== WebSocket.OPEN ||
      frame.channelId !== this.#channelId ||
      frame.sequence !== this.#inboundSequence ||
      !this.#limits
    ) {
      this.#fail(relayFailure("channel_rejected"));
      return;
    }
    this.#inboundSequence += 1;
    const payload = Uint8Array.from(frame.payload);
    if (this.#inboundQueuedBytes + payload.byteLength > this.#limits.maxQueuedBytes) {
      payload.fill(0);
      this.#fail(relayFailure("slow_consumer"));
      return;
    }
    this.#inboundQueue.push(payload);
    this.#inboundQueuedBytes += payload.byteLength;
    const highWater = Math.floor(this.#limits.maxQueuedBytes * 0.75);
    if (!this.#inboundPaused && this.#inboundQueuedBytes >= highWater && this.#channelId) {
      this.#inboundPaused = true;
      this.#sendFrame({ type: "flow.pause", ...VERSION, channelId: this.#channelId });
    }
    this.#drainInbound();
  }

  #drainInbound(): void {
    if (this.#drainingInbound) return;
    this.#drainingInbound = true;
    queueMicrotask(() => {
      this.#drainingInbound = false;
      if (this.#closed) return;
      const payload = this.#inboundQueue.shift();
      if (payload) {
        this.#inboundQueuedBytes -= payload.byteLength;
        const delivered = Uint8Array.from(payload);
        payload.fill(0);
        this.#emit("message", new MessageEvent("message", { data: delivered }));
      }
      if (
        this.#inboundPaused &&
        this.#limits &&
        this.#inboundQueuedBytes <= Math.floor(this.#limits.maxQueuedBytes * 0.5) &&
        this.#channelId
      ) {
        this.#inboundPaused = false;
        this.#sendFrame({ type: "flow.resume", ...VERSION, channelId: this.#channelId });
      }
      if (this.#inboundQueue.length > 0) this.#drainInbound();
    });
  }

  #enqueueOutbound(payload: Uint8Array): void {
    const limits = this.#limits!;
    const reservedBytes = payload.byteLength + QUEUE_ENTRY_OVERHEAD_BYTES;
    if (this.bufferedAmount + reservedBytes > limits.maxQueuedBytes - limits.maxControlFrameBytes) {
      payload.fill(0);
      this.#fail(relayFailure("slow_consumer"));
      throw new DOMException("Relay send queue is full.", "QuotaExceededError");
    }
    this.#outboundQueue.push({ bytes: payload, reservedBytes });
    this.#outboundQueuedBytes += reservedBytes;
    this.#flushOutbound();
  }

  #flushOutbound(): void {
    if (this.#closed || this.#outboundPaused || !this.#channelId || !this.#limits) return;
    if (this.#flushTimer) clearTimeout(this.#flushTimer);
    this.#flushTimer = null;
    while (this.#outboundQueue.length > 0) {
      const next = this.#outboundQueue[0]!;
      if (this.#socket.bufferedAmount + next.reservedBytes > this.#limits.maxQueuedBytes) {
        this.#flushTimer = setTimeout(() => this.#flushOutbound(), 10);
        return;
      }
      this.#outboundQueue.shift();
      this.#outboundQueuedBytes -= next.reservedBytes;
      const sequence = this.#outboundSequence;
      if (sequence > 0xffff_ffff) {
        next.bytes.fill(0);
        this.#fail(relayFailure("transfer_limit"));
        return;
      }
      this.#outboundSequence += 1;
      this.#sendFrame({
        type: "data",
        ...VERSION,
        channelId: this.#channelId,
        sequence: sequence as never,
        payload: next.bytes,
      });
      next.bytes.fill(0);
    }
  }

  #sendFrame(frame: RelayFrame): void {
    if (this.#closed || this.#socket.readyState !== WebSocket.OPEN) return;
    const encoded = encodeRelayFrame(frame);
    const maximumFrameBytes =
      frame.type === "data" ? RELAY_MAX_DATA_FRAME_BYTES : RELAY_MAX_CONTROL_FRAME_BYTES;
    if (!encoded.ok || encoded.value.byteLength > maximumFrameBytes) {
      this.#fail(relayFailure("protocol_invalid"));
      return;
    }
    try {
      this.#socket.send(ownedBuffer(encoded.value));
    } catch {
      this.#fail(relayFailure("network"));
    } finally {
      encoded.value.fill(0);
    }
  }

  #fail(failure: HostedRelayFailure): void {
    if (this.#closed) return;
    if (!this.#failureReported) {
      this.#failureReported = true;
      this.#callbacks.onFailure(failure);
    }
    this.#emitError();
    this.#finish(4000, failure.kind);
  }

  #emitError(): void {
    this.#emit("error", new Event("error"));
  }

  #finish(code: number, reason: string): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#readyState = WebSocket.CLOSED;
    if (this.#authenticationTimer) clearTimeout(this.#authenticationTimer);
    if (this.#flushTimer) clearTimeout(this.#flushTimer);
    this.#authenticationTimer = null;
    this.#flushTimer = null;
    for (const item of this.#outboundQueue) item.bytes.fill(0);
    for (const item of this.#inboundQueue) item.fill(0);
    this.#outboundQueue = [];
    this.#inboundQueue = [];
    this.#outboundQueuedBytes = 0;
    this.#inboundQueuedBytes = 0;
    this.#callbacks.onRole(null);
    if (code === 1000 && !this.#failureReported) this.#callbacks.onSessionStatus("closed");
    try {
      this.#socket.close(code === 1000 ? 1000 : 4000, reason.slice(0, 64));
    } catch {
      // The underlying socket may already be closed.
    }
    this.#emit("close", new CloseEvent("close", { code, reason, wasClean: code === 1000 }));
  }

  #emit(type: "open" | "message" | "error" | "close", event: Event): void {
    this.dispatchEvent(event);
    const listener = this[`on${type}`];
    if (listener) listener.call(this as unknown as WebSocket, event as never);
  }
}

export function hostedRelayWebSocketUrl(): string {
  return relayWebSocketUrl();
}
