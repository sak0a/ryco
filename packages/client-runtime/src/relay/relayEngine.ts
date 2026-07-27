import {
  RELAY_AUTHENTICATION_DEADLINE_MS,
  RELAY_MAX_CONTROL_FRAME_BYTES,
  RELAY_MAX_DATA_CHUNK_BYTES,
  RELAY_MAX_RPC_MESSAGE_BYTES,
  RELAY_MAX_DATA_FRAME_BYTES,
  RELAY_MAX_DATA_FRAME_OVERHEAD_BYTES,
  RELAY_PROTOCOL_MAJOR,
  RELAY_PROTOCOL_MINOR,
  type RelayChannelId,
  type RelayCloseReason,
  type RelayEffectiveRole,
  type RelayFrame,
  type RelayLimits,
} from "@ryco/contracts";
import { decodeRelayFrame, encodeRelayFrame } from "@ryco/shared/relayCodec";
import { RelayMessageAssembler, splitRelayMessage } from "@ryco/shared/relayMessageChunks";

import { decodeBase64Url } from "./base64url.ts";
import type {
  HostedRelayFailure,
  HostedRelayTransportStatus,
  HostedRycoSessionStatus,
} from "../authorization/types.ts";

const VERSION = {
  protocolMajor: RELAY_PROTOCOL_MAJOR,
  protocolMinor: RELAY_PROTOCOL_MINOR,
} as const;
const OPEN = 1;
/** Per-entry bookkeeping headroom so the send bound accounts for queue overhead. */
const QUEUE_ENTRY_OVERHEAD_BYTES = 32;

/**
 * Platform socket seam. Implementations must not copy, retain, or re-send any
 * buffer passed to send: relay ticket and frame ownership remains with engine.
 */
export interface RelaySocket {
  readonly bufferedAmount: number;
  readonly readyState: number;
  send(bytes: Uint8Array): void;
  close(code?: number, reason?: string): void;
  onOpen(listener: () => void): void;
  onBinaryMessage(listener: (bytes: Uint8Array) => void): void;
  onClose(listener: () => void): void;
  onError(listener: () => void): void;
}
export interface RelayTimers {
  now(): number;
  setTimeout(cb: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
  queueMicrotask(cb: () => void): void;
}
export interface HostedRelaySocketCallbacks {
  onTransportStatus(status: HostedRelayTransportStatus): void;
  onSessionStatus(status: HostedRycoSessionStatus): void;
  onRole(role: RelayEffectiveRole | null): void;
  onFailure(failure: HostedRelayFailure): void;
}
export interface RelayEngineEvents {
  onOpen(): void;
  onData(bytes: Uint8Array): void;
  onError(): void;
  onClose(code: number, reason: string): void;
}
export interface RelayEngineOptions {
  ticket: string;
  ticketExpiresAt: number;
  socket: RelaySocket;
  timers: RelayTimers;
  callbacks: HostedRelaySocketCallbacks;
  events: RelayEngineEvents;
}

interface QueuedPayload {
  readonly bytes: Uint8Array;
  readonly reservedBytes: number;
}

function failure(reason: RelayCloseReason | "protocol_invalid" | "network"): HostedRelayFailure {
  if (
    [
      "node_offline",
      "server_draining",
      "connection_replaced",
      "rate_limited",
      "slow_consumer",
    ].includes(reason)
  )
    return {
      kind:
        reason === "node_offline"
          ? "offline"
          : reason === "server_draining"
            ? "draining"
            : reason === "connection_replaced"
              ? "replacement"
              : reason === "rate_limited"
                ? "rate-limited"
                : "slow-consumer",
      retryable: true,
      closeReason: reason as RelayCloseReason,
    };
  if (["revoked", "node_revoked", "grant_revoked"].includes(reason))
    return { kind: "revoked", retryable: false, closeReason: reason as RelayCloseReason };
  if (reason === "authorization_failed")
    return { kind: "authorization-removed", retryable: false, closeReason: reason };
  if (
    [
      "authentication_failed",
      "authentication_required",
      "ticket_expired",
      "ticket_consumed",
      "authentication_timeout",
    ].includes(reason)
  )
    return {
      kind: "authentication",
      retryable: reason !== "authentication_required",
      closeReason: reason as RelayCloseReason,
    };
  if (reason === "protocol_unsupported")
    return { kind: "incompatible", retryable: false, closeReason: reason };
  if (
    ["protocol_invalid", "frame_too_large", "channel_rejected", "transfer_limit"].includes(reason)
  )
    return {
      kind: "protocol",
      retryable: false,
      ...(reason === "protocol_invalid" ? {} : { closeReason: reason as RelayCloseReason }),
    };
  return reason === "network"
    ? { kind: "network", retryable: true }
    : { kind: "internal", retryable: true, closeReason: reason as RelayCloseReason };
}

export class HostedRelayEngine {
  readonly options: RelayEngineOptions;
  #limits: RelayLimits | null = null;
  #channel: RelayChannelId | null = null;
  #accepted = false;
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
  #reported = false;
  #auth: Uint8Array | null = null;
  #authTimer: unknown = null;
  #flushTimer: unknown = null;

  constructor(options: RelayEngineOptions) {
    this.options = options;
    if (options.ticketExpiresAt <= options.timers.now())
      throw new Error("Relay attempt is no longer valid.");
    const ticket = decodeBase64Url(options.ticket);
    try {
      const encoded = encodeRelayFrame({
        type: "auth",
        peer: "client",
        ...VERSION,
        relayTicket: ticket,
      });
      if (!encoded.ok) throw new Error("Relay authentication could not be encoded.");
      this.#auth = encoded.value;
    } finally {
      ticket.fill(0);
    }
    options.callbacks.onTransportStatus("connecting");
    options.socket.onOpen(() => this.#open());
    options.socket.onBinaryMessage((bytes) => this.#receive(bytes));
    options.socket.onError(() => {
      if (!this.#closed) options.events.onError();
    });
    options.socket.onClose(() => {
      if (!this.#closed) this.#fail(failure("network"));
    });
  }

  /** Socket backpressure plus everything still awaiting a flow.resume flush. */
  readonly #assembler = new RelayMessageAssembler();

  get bufferedAmount(): number {
    return this.options.socket.bufferedAmount + this.#outboundQueuedBytes;
  }

  send(payload: Uint8Array): void {
    // Outbound RPC is only permitted after the authorization handshake fully
    // completes (channel.accept); a channel that is merely open is not enough.
    if (this.#closed || !this.#accepted || !this.#channel || !this.#limits)
      throw new Error("Relay channel is not open.");
    // Only a message above the reassembly ceiling is refused now; anything
    // between the frame limit and that ceiling is split across frames.
    if (payload.byteLength > RELAY_MAX_RPC_MESSAGE_BYTES) {
      payload.fill(0);
      this.#fail(failure("transfer_limit"));
      throw new Error("RPC payload exceeds the maximum relay message size.");
    }
    for (const chunk of splitRelayMessage(payload, this.#limits.maxDataChunkBytes)) {
      this.#enqueueOutbound(Uint8Array.from(chunk));
    }
  }

  close(code = 1000, reason = "closed"): void {
    if (this.#closed) return;
    this.options.callbacks.onTransportStatus("draining");
    if (this.#channel) this.#frame({ type: "channel.close", ...VERSION, channelId: this.#channel });
    this.#finish(code, reason);
  }

  /**
   * Fail closed on a platform message the browser adapter could not read as
   * relay bytes. The DOM boundary classifies the cause and passes the matching
   * relay reason — a non-binary payload maps to an oversized frame, a raw
   * SharedArrayBuffer to an invalid frame — preserving the original semantics.
   */
  reportUndecodableMessage(reason: "frame_too_large" | "protocol_invalid"): void {
    this.#fail(failure(reason));
  }

  #open(): void {
    if (this.#closed || !this.#auth) return;
    this.options.callbacks.onTransportStatus("authenticating");
    try {
      this.options.socket.send(this.#auth);
    } finally {
      this.#auth.fill(0);
      this.#auth = null;
    }
    this.#authTimer = this.options.timers.setTimeout(
      () => this.#fail(failure("authentication_timeout")),
      RELAY_AUTHENTICATION_DEADLINE_MS,
    );
  }

  #receive(bytes: Uint8Array): void {
    if (bytes.byteLength > RELAY_MAX_DATA_FRAME_BYTES)
      return this.#fail(failure("frame_too_large"));
    const owned = Uint8Array.from(bytes);
    const decoded = decodeRelayFrame(owned, this.#limits ? { expectedVersion: VERSION } : {});
    owned.fill(0);
    if (!decoded.ok) return this.#fail(failure("protocol_invalid"));
    const frame = decoded.value;
    const negotiatedFrameLimit =
      frame.type === "data"
        ? (this.#limits?.maxDataChunkBytes ?? RELAY_MAX_DATA_CHUNK_BYTES) +
          RELAY_MAX_DATA_FRAME_OVERHEAD_BYTES
        : (this.#limits?.maxControlFrameBytes ?? RELAY_MAX_CONTROL_FRAME_BYTES);
    if (bytes.byteLength > negotiatedFrameLimit) return this.#fail(failure("frame_too_large"));
    if (frame.type === "ping")
      return this.#frame({ type: "pong", ...VERSION, nonce: Uint8Array.from(frame.nonce) });
    if (frame.type === "error") {
      const classified = failure(
        frame.code === "invalid_encoding" ||
          frame.code === "invalid_frame" ||
          frame.code === "invalid_limits" ||
          frame.code === "missing_discriminant" ||
          frame.code === "unknown_frame_type"
          ? "protocol_invalid"
          : frame.code,
      );
      return this.#fail({
        ...classified,
        ...(frame.retryAfterMs === undefined ? {} : { retryAfterMs: frame.retryAfterMs }),
      });
    }
    if (!this.#limits) {
      if (frame.type !== "ready" || frame.protocolMajor !== 1 || frame.protocolMinor !== 2)
        return this.#fail(
          failure(frame.type === "ready" ? "protocol_unsupported" : "protocol_invalid"),
        );
      this.#limits = frame.limits;
      if (this.#authTimer) this.options.timers.clearTimeout(this.#authTimer);
      this.#authTimer = null;
      this.options.callbacks.onTransportStatus("opening-channel");
      return;
    }
    if (frame.type === "channel.open") {
      if (this.#channel || frame.capability !== "ryco.rpc" || !frame.effectiveRole)
        return this.#fail(failure("channel_rejected"));
      this.#channel = frame.channelId;
      this.#role = frame.effectiveRole;
      this.options.callbacks.onRole(this.#role);
      return;
    }
    if (frame.type === "channel.accept") {
      if (frame.channelId !== this.#channel || !this.#role)
        return this.#fail(failure("channel_rejected"));
      this.#accepted = true;
      this.options.callbacks.onTransportStatus("online");
      this.options.callbacks.onSessionStatus("synchronizing");
      this.options.events.onOpen();
      return;
    }
    if (frame.type === "channel.close" || frame.type === "channel.reject")
      return frame.channelId === this.#channel
        ? this.#fail(failure(frame.reason ?? "channel_rejected"))
        : this.#fail(failure("channel_rejected"));
    if (frame.type === "flow.pause" || frame.type === "flow.resume") {
      if (frame.channelId !== this.#channel) return this.#fail(failure("channel_rejected"));
      this.#outboundPaused = frame.type === "flow.pause";
      if (!this.#outboundPaused) this.#flushOutbound();
      return;
    }
    if (frame.type === "data") this.#receiveData(frame);
  }

  #receiveData(frame: Extract<RelayFrame, { readonly type: "data" }>): void {
    // Reject inbound RPC data delivered before the handshake completes
    // (channel.accept); a peer must not push data during authorization.
    if (
      this.#closed ||
      !this.#accepted ||
      frame.channelId !== this.#channel ||
      frame.sequence !== this.#inboundSequence ||
      !this.#limits
    )
      return this.#fail(failure("channel_rejected"));
    this.#inboundSequence += 1;
    const payload = Uint8Array.from(frame.payload);
    if (this.#inboundQueuedBytes + payload.byteLength > this.#limits.maxQueuedBytes) {
      payload.fill(0);
      return this.#fail(failure("slow_consumer"));
    }
    this.#inboundQueue.push(payload);
    this.#inboundQueuedBytes += payload.byteLength;
    const highWater = Math.floor(this.#limits.maxQueuedBytes * 0.75);
    if (!this.#inboundPaused && this.#inboundQueuedBytes >= highWater && this.#channel) {
      this.#inboundPaused = true;
      this.#frame({ type: "flow.pause", ...VERSION, channelId: this.#channel });
    }
    this.#drainInbound();
  }

  #drainInbound(): void {
    if (this.#drainingInbound) return;
    this.#drainingInbound = true;
    this.options.timers.queueMicrotask(() => {
      this.#drainingInbound = false;
      if (this.#closed) return;
      const payload = this.#inboundQueue.shift();
      if (payload) {
        this.#inboundQueuedBytes -= payload.byteLength;
        const delivered = Uint8Array.from(payload);
        payload.fill(0);
        // Reassemble before delivering. An unchunked payload passes straight
        // through, so an old peer is unaffected; a partial message is held
        // until its final chunk arrives.
        const assembled = this.#assembler.push(delivered);
        if (assembled.kind === "error") {
          this.#fail(failure("transfer_limit"));
          return;
        }
        if (assembled.kind === "done") this.options.events.onData(assembled.message);
      }
      if (
        this.#inboundPaused &&
        this.#limits &&
        this.#inboundQueuedBytes <= Math.floor(this.#limits.maxQueuedBytes * 0.5) &&
        this.#channel
      ) {
        this.#inboundPaused = false;
        this.#frame({ type: "flow.resume", ...VERSION, channelId: this.#channel });
      }
      if (this.#inboundQueue.length > 0) this.#drainInbound();
    });
  }

  #enqueueOutbound(payload: Uint8Array): void {
    const limits = this.#limits!;
    const reservedBytes = payload.byteLength + QUEUE_ENTRY_OVERHEAD_BYTES;
    if (this.bufferedAmount + reservedBytes > limits.maxQueuedBytes - limits.maxControlFrameBytes) {
      payload.fill(0);
      this.#fail(failure("slow_consumer"));
      throw new Error("Relay send queue is full.");
    }
    this.#outboundQueue.push({ bytes: payload, reservedBytes });
    this.#outboundQueuedBytes += reservedBytes;
    this.#flushOutbound();
  }

  #flushOutbound(): void {
    if (this.#closed || this.#outboundPaused || !this.#channel || !this.#limits) return;
    if (this.#flushTimer) this.options.timers.clearTimeout(this.#flushTimer);
    this.#flushTimer = null;
    while (this.#outboundQueue.length > 0) {
      const next = this.#outboundQueue[0]!;
      if (this.options.socket.bufferedAmount + next.reservedBytes > this.#limits.maxQueuedBytes) {
        this.#flushTimer = this.options.timers.setTimeout(() => this.#flushOutbound(), 10);
        return;
      }
      this.#outboundQueue.shift();
      this.#outboundQueuedBytes -= next.reservedBytes;
      const sequence = this.#outboundSequence;
      if (sequence > 0xffff_ffff) {
        next.bytes.fill(0);
        this.#fail(failure("transfer_limit"));
        return;
      }
      this.#outboundSequence += 1;
      this.#frame({
        type: "data",
        ...VERSION,
        channelId: this.#channel,
        sequence: sequence as never,
        payload: next.bytes,
      });
      next.bytes.fill(0);
    }
  }

  #frame(frame: RelayFrame): void {
    if (this.#closed || this.options.socket.readyState !== OPEN) return;
    const encoded = encodeRelayFrame(frame);
    if (
      !encoded.ok ||
      encoded.value.byteLength >
        (frame.type === "data" ? RELAY_MAX_DATA_FRAME_BYTES : RELAY_MAX_CONTROL_FRAME_BYTES)
    )
      return this.#fail(failure("protocol_invalid"));
    try {
      this.options.socket.send(encoded.value);
    } catch {
      this.#fail(failure("network"));
    } finally {
      encoded.value.fill(0);
    }
  }

  #fail(value: HostedRelayFailure): void {
    if (this.#closed) return;
    if (!this.#reported) {
      this.#reported = true;
      this.options.callbacks.onFailure(value);
    }
    this.options.events.onError();
    this.#finish(4000, value.kind);
  }

  #finish(code: number, reason: string): void {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#authTimer) this.options.timers.clearTimeout(this.#authTimer);
    if (this.#flushTimer) this.options.timers.clearTimeout(this.#flushTimer);
    this.#authTimer = null;
    this.#flushTimer = null;
    this.#auth?.fill(0);
    this.#auth = null;
    for (const item of this.#outboundQueue) item.bytes.fill(0);
    for (const item of this.#inboundQueue) item.fill(0);
    this.#outboundQueue = [];
    this.#inboundQueue = [];
    this.#outboundQueuedBytes = 0;
    this.#inboundQueuedBytes = 0;
    this.options.callbacks.onRole(null);
    if (code === 1000 && !this.#reported) this.options.callbacks.onSessionStatus("closed");
    try {
      this.options.socket.close(code === 1000 ? 1000 : 4000, reason.slice(0, 64));
    } catch {
      // The underlying socket may already be closed.
    }
    this.options.events.onClose(code, reason);
  }
}
