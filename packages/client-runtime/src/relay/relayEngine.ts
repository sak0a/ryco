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
import {
  planRelayMessage,
  prepareRelayMessage,
  RelayMessageAssembler,
} from "@ryco/shared/relayMessageChunks";

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

// ─── the E2EE seam (docs/relay-e2ee-protocol.md §4, §9, §10) ─────────────────
//
// The engine owns relay framing and the send queue; it owns no key material, no
// record protection, and no close machine. Everything this protocol adds is
// reached through the OPTIONAL provider below, and a caller that supplies none
// gets the byte-identical frame sequence it got before the seam existed. THE
// TIER IS NEVER AN ENGINE-INTERNAL CONSTANT: what the engine knows is that a
// provider exists, and every decision the protocol makes belongs to it.

/**
 * §9.3 "reserve before you encrypt": send-queue capacity held for EVERY payload
 * of one record — every chunk of it — before the record's `(epoch, counter)`
 * pair is assigned and before the AEAD runs.
 *
 * A reservation is spent exactly once. `send` is all-or-nothing precisely
 * because the capacity is already held: `false` therefore means no byte of the
 * record reached the relay, which is §9.3's `none` branch and not backpressure.
 */
export interface RelayE2eeReservation {
  send(message: Uint8Array): boolean;
  /** Give the capacity back; the record was never built. */
  release(): void;
}

/** The engine surface one E2EE channel drives, and no more of it. */
export interface RelayE2eeHost {
  /** §4.5: the Hub-asserted `ready` limits, adopted verbatim. */
  readonly limits: RelayLimits;
  /** §9.3: admission for the entire record; `undefined` refuses it. */
  readonly admit: (messageBytes: number) => RelayE2eeReservation | undefined;
  /**
   * The outer relay close (§10.3). With no failure this is the reasonless
   * `channel.close` that follows a clean exchange; with one it is §11.1's
   * fatal teardown.
   */
  readonly close: (failure?: HostedRelayFailure) => void;
  readonly now: () => number;
  readonly setTimeout: (callback: () => void, ms: number) => unknown;
  readonly clearTimeout: (id: unknown) => void;
}

/**
 * What one inbound, reassembled, prelude-stripped payload becomes (§4.3).
 * `rejected` means the channel has already emitted whatever §11 record the
 * condition calls for and asked for the outer close.
 */
export type RelayE2eeInboundDisposition =
  | { readonly kind: "rpc"; readonly message: Uint8Array }
  | { readonly kind: "claimed" }
  | { readonly kind: "rejected" };

/**
 * What one §10.2 close attempt did to the channel.
 *
 * `refused` is §11.4 and nothing else: the `E2EEClose` obtained no transmission
 * admission, so no pair was consumed, no wire record of any kind was produced,
 * and NO CLOSE PHASE OPENED — nothing is owed, no `T_CLOSE` wait is armed, and
 * nothing bounds the channel. The caller must be able to ask again, because
 * ordinary backpressure MUST NOT be escalated into a channel that can never be
 * closed cleanly.
 */
export type RelayE2eeCloseAttempt = "opened" | "refused";

export interface RelayE2eeChannel {
  /** §4.3: discriminate, authenticate, and dispatch one inbound payload. */
  readonly intercept: (payload: Uint8Array) => Promise<RelayE2eeInboundDisposition>;
  /** §4.2: one outbound application RPC message. `false` never closes anything. */
  readonly emit: (message: Uint8Array) => Promise<boolean>;
  /** §10: begin the authenticated close; the channel asks for the outer one. */
  readonly beginClose: () => Promise<RelayE2eeCloseAttempt>;
  /** §9.5, §10.4: the channel ended. Idempotent. */
  readonly dispose: (options?: { readonly incompleteReassembly?: boolean }) => void;
}

/** Built once per channel, at `channel.accept`, from the negotiated limits. */
export type RelayE2eeProvider = (host: RelayE2eeHost) => RelayE2eeChannel;

/**
 * Every way an E2EE channel ends the connection. §11.1 introduces no close
 * reason of its own, so all of them take the existing `channel_rejected`, and
 * none may reach the retryable `internal` default below: a channel that failed
 * a cryptographic check must not be reconnected into the same failure.
 */
export type RelayE2eeFailureKind =
  /** §11.2: a pre-key fatal condition, including §4.5's unestablishable channel. */
  | "fatal_pre_key"
  /** §11.3: a post-key fatal condition. */
  | "fatal_post_key"
  /** §11.3 Q10: a local send failure no byte of which reached the relay. */
  | "send_path_unusable";

/**
 * §11.1 and §11.5: one close reason for every E2EE-fatal condition, written as
 * a table so the uniform observable is a fact of the code rather than of three
 * call sites that happen to agree today.
 */
const RELAY_E2EE_CLOSE_REASONS: Readonly<Record<RelayE2eeFailureKind, RelayCloseReason>> = {
  fatal_pre_key: "channel_rejected",
  fatal_post_key: "channel_rejected",
  send_path_unusable: "channel_rejected",
};

export interface RelayEngineOptions {
  ticket: string;
  ticketExpiresAt: number;
  socket: RelaySocket;
  timers: RelayTimers;
  callbacks: HostedRelaySocketCallbacks;
  events: RelayEngineEvents;
  /** §4: the E2EE channel factory. Absent means an unchanged legacy channel. */
  e2ee?: RelayE2eeProvider;
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

/**
 * The failure an E2EE-fatal condition reports. Non-retryable by construction:
 * it routes through the `channel_rejected` row above, so no E2EE condition can
 * reach the retryable `internal` default and have the transport reconnect into
 * the same cryptographic failure.
 */
export function relayE2eeFailure(kind: RelayE2eeFailureKind): HostedRelayFailure {
  return failure(RELAY_E2EE_CLOSE_REASONS[kind]);
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
  #e2ee: RelayE2eeChannel | null = null;
  /** §9.3: capacity held by admitted records that have not yet been queued. */
  #outboundReservedBytes = 0;
  /** §9.2 requires envelopes to reach `unprotect` in arrival order. */
  #e2eeInbound: Promise<void> = Promise.resolve();
  /** A §10 close attempt is in flight, or its phase opened. Never both at once. */
  #e2eeClosing = false;
  /** The application asked for the close; it stands until one attempt opens a phase. */
  #e2eeCloseRequested = false;

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
    return (
      this.options.socket.bufferedAmount + this.#outboundQueuedBytes + this.#outboundReservedBytes
    );
  }

  send(payload: Uint8Array): void {
    // Outbound RPC is only permitted after the authorization handshake fully
    // completes (channel.accept); a channel that is merely open is not enough.
    if (this.#closed || !this.#accepted || !this.#channel || !this.#limits)
      throw new Error("Relay channel is not open.");
    if (this.#e2ee) {
      // §4.2: the E2EE layer owns the whole send pipeline from the ceiling
      // check to the reservation, so nothing is chunked or queued here. A
      // record it refuses is §11.4 sender-local — no pair consumed, no wire
      // record, channel unaffected — and §10.2 discards rather than buffers a
      // keepalive `Ping` the close phase stalls, so a refusal is not an error
      // this seam may raise.
      void this.#e2ee
        .emit(Uint8Array.from(payload))
        .catch(() => this.#failE2ee(relayE2eeFailure("fatal_post_key")));
      return;
    }
    const prepared = prepareRelayMessage(payload, this.#messageLimits(this.#limits));
    if (prepared.kind === "error") {
      payload.fill(0);
      this.#fail(failure("transfer_limit"));
      throw new Error(
        prepared.reason === "peer_unsupported"
          ? "Relay peer does not support multi-frame RPC messages."
          : "RPC payload exceeds the maximum relay message size.",
      );
    }
    for (const chunk of prepared.payloads) {
      this.#enqueueOutbound(Uint8Array.from(chunk));
    }
  }

  close(code = 1000, reason = "closed"): void {
    if (this.#closed) return;
    if (this.#e2ee) {
      // §10.3 lower bound: the outer `channel.close` MUST NOT be emitted until
      // the authenticated exchange has produced the encrypted peer proof this
      // endpoint's role requires, or `T_CLOSE` expires. Enqueueing one's own
      // final records is never sufficient, so the channel — not this method —
      // decides when the frame below goes out, through `host.close`. A repeat
      // call while a phase is open is therefore a no-op rather than a shortcut
      // past that bound; the phase is bounded by `T_CLOSE` and ends on its own.
      this.#e2eeCloseRequested = true;
      this.options.callbacks.onTransportStatus("draining");
      this.#attemptE2eeClose();
      return;
    }
    this.#outerClose(code, reason);
  }

  /**
   * §10.2, §11.4: ask the channel to open its close phase, and keep the request
   * standing until one attempt does.
   *
   * A refused attempt opened nothing — no pair consumed, no wire record, no
   * `T_CLOSE` wait armed — so latching on the attempt rather than on its outcome
   * would turn ordinary send-queue backpressure into a channel that can never be
   * closed cleanly, with its §6.5 session secrets never erased. The retry is
   * driven from the outbound drain below, which is where the capacity a refusal
   * was waiting for actually comes back.
   */
  #attemptE2eeClose(): void {
    const channel = this.#e2ee;
    if (this.#closed || !channel || this.#e2eeClosing || !this.#e2eeCloseRequested) return;
    this.#e2eeClosing = true;
    void channel.beginClose().then(
      (outcome) => {
        if (outcome === "refused" && !this.#closed && this.#e2ee === channel) {
          this.#e2eeClosing = false;
        }
      },
      () => this.#failE2ee(relayE2eeFailure("fatal_post_key")),
    );
  }

  #outerClose(code: number, reason: string): void {
    if (this.#closed) return;
    this.#e2eeClosing = true;
    this.options.callbacks.onTransportStatus("draining");
    // §10.3 and §11.3: this endpoint's own final records go out AHEAD of the
    // frame that ends the channel. `#finish` discards whatever is still queued
    // and the control frame below is written straight to the socket, so a close
    // emitted over a non-empty queue destroys the very close-machine record or
    // `E2EEError` the peer needs — after the sequence pair for it was spent.
    this.#flushOutbound(true);
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
      // §4.4 creates the channel's machine at `channel.accept` and destroys it
      // when the channel closes; there is no second acceptance of one channel.
      // A repeat would build a second machine over the first, orphaning its
      // §6.5 secrets unerased and its close timers armed on a channel nothing
      // holds any more — so it is refused rather than obeyed.
      if (this.#accepted || frame.channelId !== this.#channel || !this.#role)
        return this.#fail(failure("channel_rejected"));
      this.#accepted = true;
      if (this.options.e2ee && !this.#openE2eeChannel(this.#limits)) return;
      this.options.callbacks.onTransportStatus("online");
      this.options.callbacks.onSessionStatus("synchronizing");
      this.options.events.onOpen();
      return;
    }
    if (
      frame.type === "channel.close" &&
      frame.reason === undefined &&
      frame.channelId === this.#channel &&
      this.#e2eeClosing
    ) {
      // §10.3: observing the peer's `channel.close` is one of the three events
      // that end this endpoint's linger, and a reasonless one is the relay
      // protocol's orderly close rather than a rejection — §11.1 gives every
      // E2EE-fatal condition a reason. Losing the channel here "changes the
      // peer's verdict, never this endpoint's, and MUST NOT be reported as a
      // failure of this endpoint's exchange"; §10.4 fixed that verdict when the
      // exchange completed or `T_CLOSE` expired, and the channel records the
      // ending itself through `dispose`.
      return this.#outerClose(1000, "closed");
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

  /**
   * §4.4: the channel's E2EE machine is created when the channel is accepted
   * and destroyed when it closes. It is built BEFORE `onOpen`, because §4.5
   * requires a channel whose plaintext ceiling is not positive to fail during
   * establishment rather than be released to the application with a silently
   * shrunk one — so a provider that refuses these limits fails the channel here
   * and the application never sees it open.
   */
  #openE2eeChannel(limits: RelayLimits): boolean {
    try {
      this.#e2ee = this.options.e2ee!({
        limits,
        admit: (messageBytes) => this.#reserveOutbound(messageBytes),
        close: (value) => {
          if (value) return this.#failE2ee(value);
          // §10.3: after a clean exchange the endpoint sends `channel.close`
          // with no reason — the relay protocol's orderly close.
          this.#outerClose(1000, "closed");
        },
        now: () => this.options.timers.now(),
        setTimeout: (callback, ms) => this.options.timers.setTimeout(callback, ms),
        clearTimeout: (id) => this.options.timers.clearTimeout(id),
      });
      return true;
    } catch {
      this.#failE2ee(relayE2eeFailure("fatal_pre_key"));
      return false;
    }
  }

  /**
   * §11.1: the endpoint that detects an E2EE-fatal condition emits the outer
   * relay `channel.close` WITH `channel_rejected` after completing the §11.2 or
   * §11.3 procedure, and only then tears the connection down.
   *
   * The relay-level `#fail` below does not send that frame — a transport that
   * failed underneath the channel has nothing to say on it — so the E2EE path
   * sends it here and then takes the same teardown.
   */
  #failE2ee(value: HostedRelayFailure): void {
    if (this.#closed) return;
    this.#e2eeClosing = true;
    // §11.3's procedure emits one `E2EEError` and only then the close, so the
    // record goes out ahead of the frame here for the same reason `#outerClose`
    // drains: the frame is written past the queue and `#fail` discards it.
    this.#flushOutbound(true);
    if (this.#channel && value.closeReason) {
      this.#frame({
        type: "channel.close",
        ...VERSION,
        channelId: this.#channel,
        reason: value.closeReason,
      });
    }
    this.#fail(value);
  }

  /**
   * §9.3: hold send-queue capacity for every payload of one record before its
   * pair is assigned.
   *
   * The payload layout comes from the chunk layer's own rule
   * (`planRelayMessage`), so the capacity held is the capacity the record will
   * actually spend. A refusal returns `undefined`, which the record session
   * reports as `e2ee_send_unavailable`: no pair consumed, nothing encrypted,
   * nothing on the wire, and the channel unaffected. It never fails the
   * channel — ordinary backpressure is not a fatal condition.
   */
  #reserveOutbound(messageBytes: number): RelayE2eeReservation | undefined {
    const limits = this.#limits;
    if (this.#closed || !this.#channel || !limits) return undefined;
    const plan = planRelayMessage(messageBytes, this.#messageLimits(limits));
    if (plan.kind === "error") return undefined;
    let reserved = 0;
    for (const payloadBytes of plan.payloadBytes) {
      reserved += payloadBytes + QUEUE_ENTRY_OVERHEAD_BYTES;
    }
    if (this.bufferedAmount + reserved > limits.maxQueuedBytes - limits.maxControlFrameBytes) {
      return undefined;
    }
    this.#outboundReservedBytes += reserved;
    let spent = false;
    const settle = (): boolean => {
      if (spent) return false;
      spent = true;
      this.#outboundReservedBytes -= reserved;
      return true;
    };
    return {
      release: () => void settle(),
      send: (message) => (settle() ? this.#sendReserved(message) : false),
    };
  }

  /**
   * Queue every payload of an admitted record. The reservation already covers
   * them, so this cannot overflow the queue and is all-or-nothing: `false`
   * means no byte of the record reached the relay (§9.3).
   */
  #sendReserved(message: Uint8Array): boolean {
    const limits = this.#limits;
    if (this.#closed || !this.#channel || !limits) return false;
    const prepared = prepareRelayMessage(message, this.#messageLimits(limits));
    if (prepared.kind === "error") return false;
    for (const chunk of prepared.payloads) {
      const bytes = Uint8Array.from(chunk);
      const reservedBytes = bytes.byteLength + QUEUE_ENTRY_OVERHEAD_BYTES;
      this.#outboundQueue.push({ bytes, reservedBytes });
      this.#outboundQueuedBytes += reservedBytes;
    }
    this.#flushOutbound();
    return true;
  }

  #messageLimits(limits: RelayLimits): {
    readonly maxChunkBytes: number;
    readonly maxMessageBytes: number;
    readonly peerSupportsChunking: boolean;
  } {
    return {
      maxChunkBytes: limits.maxDataChunkBytes,
      maxMessageBytes: Math.min(
        RELAY_MAX_RPC_MESSAGE_BYTES,
        limits.maxQueuedBytes - limits.maxControlFrameBytes,
      ),
      peerSupportsChunking: this.#assembler.peerSupportsChunking,
    };
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
    if (this.#inboundOwnedBytes() + payload.byteLength > this.#limits.maxQueuedBytes) {
      payload.fill(0);
      return this.#fail(failure("slow_consumer"));
    }
    this.#inboundQueue.push(payload);
    this.#inboundQueuedBytes += payload.byteLength;
    this.#refreshInboundFlow();
    this.#drainInbound();
  }

  #inboundOwnedBytes(): number {
    return this.#inboundQueuedBytes + this.#assembler.heldBytes;
  }

  #refreshInboundFlow(): void {
    if (!this.#limits || !this.#channel) return;
    const ownedBytes = this.#inboundOwnedBytes();
    if (!this.#inboundPaused && ownedBytes >= Math.floor(this.#limits.maxQueuedBytes * 0.75)) {
      this.#inboundPaused = true;
      this.#frame({ type: "flow.pause", ...VERSION, channelId: this.#channel });
    } else if (this.#inboundPaused && ownedBytes <= Math.floor(this.#limits.maxQueuedBytes * 0.5)) {
      this.#inboundPaused = false;
      this.#frame({ type: "flow.resume", ...VERSION, channelId: this.#channel });
    }
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
        if (assembled.kind === "done") this.#deliver(assembled.message);
      }
      this.#refreshInboundFlow();
      if (this.#inboundQueue.length > 0) this.#drainInbound();
    });
  }

  /**
   * One reassembled, prelude-stripped payload (§4.3 step 1).
   *
   * With no E2EE channel this is the application's message and reaches it on
   * the same turn it always did. With one, the payload is the E2EE layer's:
   * §4.3 puts discrimination behind the assembler, and unauthenticated bytes
   * never reach the RPC parser. The interceptions are chained rather than
   * launched, because §9.2 compares each envelope against a single expected
   * pair and two overlapping `unprotect` calls would race that comparison.
   */
  #deliver(message: Uint8Array): void {
    const channel = this.#e2ee;
    if (!channel) return this.options.events.onData(message);
    const intercept = async (): Promise<void> => {
      if (this.#closed || this.#e2ee !== channel) return;
      try {
        const disposition = await channel.intercept(message);
        if (disposition.kind === "rpc" && !this.#closed) {
          this.options.events.onData(disposition.message);
        }
      } catch {
        // The channel decides every condition it can decide; a throw escaping
        // it is a local defect, and the only fail-closed answer is to stop
        // consuming (§4.3: nothing unauthenticated reaches the parser).
        this.#failE2ee(relayE2eeFailure("fatal_post_key"));
      }
    };
    this.#e2eeInbound = this.#e2eeInbound.then(intercept, intercept);
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

  /**
   * `final` is the best-effort drain a close takes before its own frame: it
   * writes past the local queue threshold, because deferring is exactly what
   * loses the payload the caller is about to close over. It stays inside the
   * peer's `flow.pause` — a paused channel cannot be drained without violating
   * relay flow control, and a socket that will not take the bytes cannot be made
   * to. Both lose the record, which is why §10.3 takes delivery proof from the
   * peer and never from a successful enqueue.
   */
  #flushOutbound(final = false): void {
    if (this.#closed || this.#outboundPaused || !this.#channel || !this.#limits) return;
    if (this.#flushTimer) this.options.timers.clearTimeout(this.#flushTimer);
    this.#flushTimer = null;
    while (this.#outboundQueue.length > 0) {
      const next = this.#outboundQueue[0]!;
      if (
        !final &&
        this.options.socket.bufferedAmount + next.reservedBytes > this.#limits.maxQueuedBytes
      ) {
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
    // The queue is empty, so the capacity a §11.4 refusal was waiting for is
    // back: a close the application already asked for gets its next attempt here
    // rather than waiting for a caller that may never come again.
    this.#attemptE2eeClose();
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
    // §10.4: a partial reassembly held when the channel ends IS truncation, and
    // the verdict is recorded at that instant — so the channel is told BEFORE
    // the reset below erases the evidence, and before the outer close.
    const channel = this.#e2ee;
    this.#e2ee = null;
    channel?.dispose({ incompleteReassembly: this.#assembler.incompleteMessage });
    this.#assembler.reset();
    this.#outboundQueue = [];
    this.#inboundQueue = [];
    this.#outboundQueuedBytes = 0;
    this.#outboundReservedBytes = 0;
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
