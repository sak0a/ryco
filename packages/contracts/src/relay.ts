import { Schema } from "effect";

export const RELAY_PROTOCOL_MAJOR = 1 as const;
export const RELAY_PROTOCOL_MINOR = 2 as const;
export const RELAY_PROTOCOL_MINIMUM_MINOR = 0 as const;
export const RELAY_AUTHORIZED_CHANNEL_MINOR = 2 as const;

export const RELAY_MAX_CONTROL_FRAME_BYTES = 256 * 1_024;
export const RELAY_MAX_DATA_CHUNK_BYTES = 256 * 1_024;
export const RELAY_MAX_DATA_FRAME_OVERHEAD_BYTES = 1_024;
export const RELAY_MAX_DATA_FRAME_BYTES =
  RELAY_MAX_DATA_CHUNK_BYTES + RELAY_MAX_DATA_FRAME_OVERHEAD_BYTES;
export const RELAY_MAX_QUEUED_BYTES = 8 * 1_024 * 1_024;
export const RELAY_MAX_CHANNELS = 8;
export const RELAY_HEARTBEAT_INTERVAL_MS = 20_000;
export const RELAY_DEAD_CONNECTION_TIMEOUT_MS = 45_000;
export const RELAY_AUTHENTICATION_DEADLINE_MS = 5_000;

// ─── Application-level message chunking ──────────────────────────────────────
//
// One RPC response is one relay data frame, and a frame is capped at
// RELAY_MAX_DATA_CHUNK_BYTES — so any response above that ceiling destroys the
// channel. See docs/superpowers/plans/2026-07-27-relay-oversized-rpc-framing.md.
//
// The fix splits a large message across several frames with an 8-byte header
// INSIDE `data.payload`. The relay spec keeps that payload opaque ("does not
// parse it as Ryco RPC, events, terminal data, attachments, JSON, text, or any
// other application format"), precisely so the payload schema can change
// without touching relay routing — so this needs no wire-format change, no
// protocol version bump and nothing from the Hub.
//
// Header: magic(1) version(1) flags(1) reserved(1) totalBytes(4, big-endian).
// A payload that already fits stays unchunked. New endpoints may prefix it
// with JSON whitespace to advertise chunk support; legacy JSON decoders accept
// that marker unchanged, so independently upgraded peers remain compatible.
export const RELAY_CHUNK_HEADER_BYTES = 8;
/** JSON payloads never start with NUL, so this distinguishes chunked from legacy. */
export const RELAY_CHUNK_MAGIC = 0x00;
export const RELAY_CHUNK_VERSION = 0x01;
export const RELAY_CHUNK_FLAG_FINAL = 0x01;
/**
 * Hard ceiling on a reassembled message. Bounds what a peer can make a receiver
 * buffer; must stay below `maxQueuedBytes - maxControlFrameBytes` so a message
 * in flight cannot alone exhaust the queue budget.
 */
export const RELAY_MAX_RPC_MESSAGE_BYTES = 4 * 1_024 * 1_024;

export const RELAY_MIN_CONTROL_FRAME_BYTES = 1_024;
export const RELAY_MIN_DATA_CHUNK_BYTES = 1_024;
export const RELAY_MIN_QUEUED_BYTES = 2_048;
export const RELAY_MIN_CHANNELS = 1;
export const RELAY_MIN_HEARTBEAT_INTERVAL_MS = 5_000;
export const RELAY_MIN_DEAD_CONNECTION_TIMEOUT_MS = 15_000;
export const RELAY_MIN_AUTHENTICATION_DEADLINE_MS = 1_000;
export const RELAY_MAX_RETRY_AFTER_MS = 300_000;

export const RELAY_CLOSE_REASONS = [
  "authentication_required",
  "authentication_failed",
  "ticket_expired",
  "ticket_consumed",
  "node_offline",
  "node_revoked",
  "grant_revoked",
  "protocol_unsupported",
  "frame_too_large",
  "slow_consumer",
  "rate_limited",
  "server_draining",
  "internal_error",
  "authentication_timeout",
  "authorization_failed",
  "channel_rejected",
  "connection_replaced",
  "transfer_limit",
  "revoked",
] as const;

export const RELAY_MINOR_2_CLOSE_REASONS = [
  "authentication_timeout",
  "authorization_failed",
  "channel_rejected",
  "connection_replaced",
  "transfer_limit",
  "revoked",
] as const;

export const RELAY_FRAME_TYPES = [
  "auth",
  "ready",
  "channel.open",
  "channel.accept",
  "channel.reject",
  "data",
  "flow.pause",
  "flow.resume",
  "channel.close",
  "ping",
  "pong",
  "error",
] as const;

export const RELAY_PROTOCOL_ERROR_CODES = [
  "invalid_encoding",
  "invalid_frame",
  "invalid_limits",
  "missing_discriminant",
  "unknown_frame_type",
  ...RELAY_CLOSE_REASONS,
] as const;

const UInt16 = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(0xffff),
);
const UInt32 = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(0xffff_ffff),
);
const RetryAfterMs = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(RELAY_MAX_RETRY_AFTER_MS),
);

const ProtocolFields = {
  protocolMajor: UInt16,
  protocolMinor: UInt16,
} as const;

const boundedBytes = (minimum: number, maximum: number) =>
  Schema.Uint8Array.check(Schema.isMinLength(minimum), Schema.isMaxLength(maximum));

export const RelayProtocolVersion = Schema.Struct(ProtocolFields);
export type RelayProtocolVersion = typeof RelayProtocolVersion.Type;

export const RelayFrameType = Schema.Literals(RELAY_FRAME_TYPES);
export type RelayFrameType = typeof RelayFrameType.Type;

export const RelayCloseReason = Schema.Literals(RELAY_CLOSE_REASONS);
export type RelayCloseReason = typeof RelayCloseReason.Type;

export const RelayCapability = Schema.Literal("ryco.rpc");
export type RelayCapability = typeof RelayCapability.Type;

export const RelayEffectiveRole = Schema.Literals(["viewer", "operator", "owner"]);
export type RelayEffectiveRole = typeof RelayEffectiveRole.Type;

export const RelayProtocolErrorCode = Schema.Literals(RELAY_PROTOCOL_ERROR_CODES);
export type RelayProtocolErrorCode = typeof RelayProtocolErrorCode.Type;

export const RelayNodeId = Schema.String.check(
  Schema.isPattern(/^node_[A-Za-z0-9_-]{22,43}$/),
  Schema.isMaxLength(48),
).pipe(Schema.brand("RelayNodeId"));
export type RelayNodeId = typeof RelayNodeId.Type;

export const RelayChannelId = Schema.String.check(
  Schema.isPattern(/^ch_[A-Za-z0-9_-]{22}$/),
  Schema.isMaxLength(25),
).pipe(Schema.brand("RelayChannelId"));
export type RelayChannelId = typeof RelayChannelId.Type;

export const RelaySequence = UInt32.pipe(Schema.brand("RelaySequence"));
export type RelaySequence = typeof RelaySequence.Type;

export const RelayHeartbeatNonce = boundedBytes(8, 8);
export type RelayHeartbeatNonce = typeof RelayHeartbeatNonce.Type;

export const RelayAuthenticationNonce = boundedBytes(32, 32);
export type RelayAuthenticationNonce = typeof RelayAuthenticationNonce.Type;

export const RelaySignatureMaterial = boundedBytes(64, 512);
export type RelaySignatureMaterial = typeof RelaySignatureMaterial.Type;

export const RelayTicketMaterial = boundedBytes(32, 64);
export type RelayTicketMaterial = typeof RelayTicketMaterial.Type;

export const RelayLimits = Schema.Struct({
  maxControlFrameBytes: Schema.Int.check(
    Schema.isGreaterThanOrEqualTo(RELAY_MIN_CONTROL_FRAME_BYTES),
    Schema.isLessThanOrEqualTo(RELAY_MAX_CONTROL_FRAME_BYTES),
  ),
  maxDataChunkBytes: Schema.Int.check(
    Schema.isGreaterThanOrEqualTo(RELAY_MIN_DATA_CHUNK_BYTES),
    Schema.isLessThanOrEqualTo(RELAY_MAX_DATA_CHUNK_BYTES),
  ),
  maxQueuedBytes: Schema.Int.check(
    Schema.isGreaterThanOrEqualTo(RELAY_MIN_QUEUED_BYTES),
    Schema.isLessThanOrEqualTo(RELAY_MAX_QUEUED_BYTES),
  ),
  maxChannels: Schema.Int.check(
    Schema.isGreaterThanOrEqualTo(RELAY_MIN_CHANNELS),
    Schema.isLessThanOrEqualTo(RELAY_MAX_CHANNELS),
  ),
  heartbeatIntervalMs: Schema.Int.check(
    Schema.isGreaterThanOrEqualTo(RELAY_MIN_HEARTBEAT_INTERVAL_MS),
    Schema.isLessThanOrEqualTo(RELAY_HEARTBEAT_INTERVAL_MS),
  ),
  deadConnectionTimeoutMs: Schema.Int.check(
    Schema.isGreaterThanOrEqualTo(RELAY_MIN_DEAD_CONNECTION_TIMEOUT_MS),
    Schema.isLessThanOrEqualTo(RELAY_DEAD_CONNECTION_TIMEOUT_MS),
  ),
  authenticationDeadlineMs: Schema.Int.check(
    Schema.isGreaterThanOrEqualTo(RELAY_MIN_AUTHENTICATION_DEADLINE_MS),
    Schema.isLessThanOrEqualTo(RELAY_AUTHENTICATION_DEADLINE_MS),
  ),
}).check(
  Schema.makeFilter((limits) => {
    const requiredQueuedBytes = Math.max(
      limits.maxControlFrameBytes,
      limits.maxDataChunkBytes + RELAY_MAX_DATA_FRAME_OVERHEAD_BYTES,
    );
    if (limits.maxQueuedBytes < requiredQueuedBytes) {
      return "maxQueuedBytes must hold one maximum encoded frame";
    }
    if (limits.deadConnectionTimeoutMs < limits.heartbeatIntervalMs * 2) {
      return "deadConnectionTimeoutMs must be at least twice heartbeatIntervalMs";
    }
  }),
);
export type RelayLimits = typeof RelayLimits.Type;

export const RELAY_INITIAL_LIMITS = RelayLimits.make({
  maxControlFrameBytes: RELAY_MAX_CONTROL_FRAME_BYTES,
  maxDataChunkBytes: RELAY_MAX_DATA_CHUNK_BYTES,
  maxQueuedBytes: RELAY_MAX_QUEUED_BYTES,
  maxChannels: RELAY_MAX_CHANNELS,
  heartbeatIntervalMs: RELAY_HEARTBEAT_INTERVAL_MS,
  deadConnectionTimeoutMs: RELAY_DEAD_CONNECTION_TIMEOUT_MS,
  authenticationDeadlineMs: RELAY_AUTHENTICATION_DEADLINE_MS,
});

const minorVersionSupportsRetryAfter = (input: {
  readonly protocolMinor: number;
  readonly retryAfterMs?: number | undefined;
}) =>
  input.retryAfterMs === undefined || input.protocolMinor >= 1
    ? undefined
    : "retryAfterMs requires protocol minor version 1 or newer";

const minor2CloseReasons = new Set<string>(RELAY_MINOR_2_CLOSE_REASONS);

const minorVersionSupportsCloseReason = (
  protocolMinor: number,
  reason: RelayProtocolErrorCode | RelayCloseReason | undefined,
) =>
  reason === undefined || !minor2CloseReasons.has(reason) || protocolMinor >= 2
    ? undefined
    : "close reason requires protocol minor version 2 or newer";

const minorVersionSupportsAuthorizedChannel = (input: {
  readonly protocolMinor: number;
  readonly capability?: RelayCapability | undefined;
  readonly effectiveRole?: RelayEffectiveRole | undefined;
}) => {
  const hasCapability = input.capability !== undefined;
  const hasEffectiveRole = input.effectiveRole !== undefined;
  if (input.protocolMinor >= RELAY_AUTHORIZED_CHANNEL_MINOR) {
    return hasCapability && hasEffectiveRole
      ? undefined
      : "protocol minor version 2 or newer requires channel authorization metadata";
  }
  return !hasCapability && !hasEffectiveRole
    ? undefined
    : "channel authorization metadata requires protocol minor version 2 or newer";
};

export const RelayNodeAuthHandshake = Schema.Struct({
  type: Schema.Literal("auth"),
  peer: Schema.Literal("node"),
  ...ProtocolFields,
  nodeId: RelayNodeId,
  nonce: RelayAuthenticationNonce,
  signature: RelaySignatureMaterial,
});
export type RelayNodeAuthHandshake = typeof RelayNodeAuthHandshake.Type;

export const RelayClientAuthHandshake = Schema.Struct({
  type: Schema.Literal("auth"),
  peer: Schema.Literal("client"),
  ...ProtocolFields,
  relayTicket: RelayTicketMaterial,
});
export type RelayClientAuthHandshake = typeof RelayClientAuthHandshake.Type;

export const RelayAuthHandshake = Schema.Union([RelayNodeAuthHandshake, RelayClientAuthHandshake]);
export type RelayAuthHandshake = typeof RelayAuthHandshake.Type;

export const RelayReadyFrame = Schema.Struct({
  type: Schema.Literal("ready"),
  ...ProtocolFields,
  limits: RelayLimits,
});
export type RelayReadyFrame = typeof RelayReadyFrame.Type;

export const RelayChannelOpenFrame = Schema.Struct({
  type: Schema.Literal("channel.open"),
  ...ProtocolFields,
  channelId: RelayChannelId,
  capability: Schema.optionalKey(RelayCapability),
  effectiveRole: Schema.optionalKey(RelayEffectiveRole),
}).check(Schema.makeFilter(minorVersionSupportsAuthorizedChannel));
export type RelayChannelOpenFrame = typeof RelayChannelOpenFrame.Type;

export const RelayChannelAcceptFrame = Schema.Struct({
  type: Schema.Literal("channel.accept"),
  ...ProtocolFields,
  channelId: RelayChannelId,
});
export type RelayChannelAcceptFrame = typeof RelayChannelAcceptFrame.Type;

export const RelayChannelRejectFrame = Schema.Struct({
  type: Schema.Literal("channel.reject"),
  ...ProtocolFields,
  channelId: RelayChannelId,
  reason: RelayCloseReason,
  retryAfterMs: Schema.optionalKey(RetryAfterMs),
}).check(
  Schema.makeFilter(
    (input) =>
      minorVersionSupportsRetryAfter(input) ??
      minorVersionSupportsCloseReason(input.protocolMinor, input.reason),
  ),
);
export type RelayChannelRejectFrame = typeof RelayChannelRejectFrame.Type;

export const RelayDataFrame = Schema.Struct({
  type: Schema.Literal("data"),
  ...ProtocolFields,
  channelId: RelayChannelId,
  sequence: RelaySequence,
  payload: boundedBytes(0, RELAY_MAX_DATA_CHUNK_BYTES),
});
export type RelayDataFrame = typeof RelayDataFrame.Type;

export const RelayFlowPauseFrame = Schema.Struct({
  type: Schema.Literal("flow.pause"),
  ...ProtocolFields,
  channelId: RelayChannelId,
});
export type RelayFlowPauseFrame = typeof RelayFlowPauseFrame.Type;

export const RelayFlowResumeFrame = Schema.Struct({
  type: Schema.Literal("flow.resume"),
  ...ProtocolFields,
  channelId: RelayChannelId,
});
export type RelayFlowResumeFrame = typeof RelayFlowResumeFrame.Type;

export const RelayChannelCloseFrame = Schema.Struct({
  type: Schema.Literal("channel.close"),
  ...ProtocolFields,
  channelId: RelayChannelId,
  reason: Schema.optionalKey(RelayCloseReason),
}).check(
  Schema.makeFilter((input) => minorVersionSupportsCloseReason(input.protocolMinor, input.reason)),
);
export type RelayChannelCloseFrame = typeof RelayChannelCloseFrame.Type;

export const RelayPingFrame = Schema.Struct({
  type: Schema.Literal("ping"),
  ...ProtocolFields,
  nonce: RelayHeartbeatNonce,
});
export type RelayPingFrame = typeof RelayPingFrame.Type;

export const RelayPongFrame = Schema.Struct({
  type: Schema.Literal("pong"),
  ...ProtocolFields,
  nonce: RelayHeartbeatNonce,
});
export type RelayPongFrame = typeof RelayPongFrame.Type;

export const RelaySupportedVersionRange = Schema.Struct({
  protocolMajor: UInt16,
  minimumMinor: UInt16,
  maximumMinor: UInt16,
}).check(
  Schema.makeFilter((range) =>
    range.minimumMinor <= range.maximumMinor
      ? undefined
      : "minimumMinor must be less than or equal to maximumMinor",
  ),
);
export type RelaySupportedVersionRange = typeof RelaySupportedVersionRange.Type;

export const RELAY_SUPPORTED_VERSION_RANGE = RelaySupportedVersionRange.make({
  protocolMajor: RELAY_PROTOCOL_MAJOR,
  minimumMinor: RELAY_PROTOCOL_MINIMUM_MINOR,
  maximumMinor: RELAY_PROTOCOL_MINOR,
});

export const RelayErrorFrame = Schema.Struct({
  type: Schema.Literal("error"),
  ...ProtocolFields,
  code: RelayProtocolErrorCode,
  fatal: Schema.Boolean,
  supported: Schema.optionalKey(RelaySupportedVersionRange),
  retryAfterMs: Schema.optionalKey(RetryAfterMs),
}).check(
  Schema.makeFilter((input) => {
    const retryAfterIssue = minorVersionSupportsRetryAfter(input);
    if (retryAfterIssue !== undefined) {
      return retryAfterIssue;
    }
    const closeReasonIssue = minorVersionSupportsCloseReason(input.protocolMinor, input.code);
    if (closeReasonIssue !== undefined) {
      return closeReasonIssue;
    }
    if (input.code === "protocol_unsupported") {
      if (!input.fatal) {
        return "protocol_unsupported errors must be fatal";
      }
      if (input.supported === undefined) {
        return "protocol_unsupported errors must include the supported version range";
      }
    }
  }),
);
export type RelayErrorFrame = typeof RelayErrorFrame.Type;

export const RelayControlFrame = Schema.Union([
  RelayNodeAuthHandshake,
  RelayClientAuthHandshake,
  RelayReadyFrame,
  RelayChannelOpenFrame,
  RelayChannelAcceptFrame,
  RelayChannelRejectFrame,
  RelayFlowPauseFrame,
  RelayFlowResumeFrame,
  RelayChannelCloseFrame,
  RelayPingFrame,
  RelayPongFrame,
  RelayErrorFrame,
]);
export type RelayControlFrame = typeof RelayControlFrame.Type;

export const RelayFrame = Schema.Union([RelayControlFrame, RelayDataFrame]);
export type RelayFrame = typeof RelayFrame.Type;
