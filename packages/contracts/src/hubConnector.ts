import { Schema } from "effect";

import {
  RELAY_MAX_CHANNELS,
  RELAY_MAX_QUEUED_BYTES,
  RELAY_PROTOCOL_MAJOR,
  RELAY_PROTOCOL_MINOR,
} from "./relay.ts";
import { IsoDateTime, NonNegativeInt } from "./baseSchemas.ts";

export const HubConnectorState = Schema.Literals([
  "disabled",
  "enrolling",
  "awaiting_approval",
  "connecting",
  "authenticating",
  "online",
  "degraded",
  "revoked",
  "version_incompatible",
  "stopping",
]);
export type HubConnectorState = typeof HubConnectorState.Type;

export const HubConnectorDegradedMode = Schema.Literals([
  "backing_off",
  "operator_action_required",
]);
export type HubConnectorDegradedMode = typeof HubConnectorDegradedMode.Type;

export const HUB_CONNECTOR_FAILURE_CODES = [
  "configuration_invalid",
  "identity_unavailable",
  "identity_origin_mismatch",
  "enrollment_unavailable",
  "network_unavailable",
  "tls_unavailable",
  "authentication_timeout",
  "authentication_failed",
  "connection_replaced",
  "server_draining",
  "rate_limited",
  "heartbeat_timeout",
  "slow_consumer",
  "protocol_invalid",
  "internal_error",
] as const;

export const HubConnectorFailureCode = Schema.Literals(HUB_CONNECTOR_FAILURE_CODES);
export type HubConnectorFailureCode = typeof HubConnectorFailureCode.Type;

const BoundedReconnectAttempt = NonNegativeInt.check(Schema.isLessThanOrEqualTo(1_000_000));
const BoundedProtocolVersion = NonNegativeInt.check(Schema.isLessThanOrEqualTo(65_535));
const BoundedChannelCount = NonNegativeInt.check(Schema.isLessThanOrEqualTo(RELAY_MAX_CHANNELS));
const BoundedQueuedBytes = NonNegativeInt.check(Schema.isLessThanOrEqualTo(RELAY_MAX_QUEUED_BYTES));

export const HubConnectorStatus = Schema.Struct({
  state: HubConnectorState,
  transitionedAt: IsoDateTime,
  degradedMode: Schema.optional(HubConnectorDegradedMode),
  failure: Schema.optional(HubConnectorFailureCode),
  reconnectAttempt: Schema.optional(BoundedReconnectAttempt),
  nextRetryAt: Schema.optional(IsoDateTime),
  protocolMajor: Schema.optional(BoundedProtocolVersion),
  protocolMinor: Schema.optional(BoundedProtocolVersion),
  activeChannels: BoundedChannelCount,
  queuedBytes: BoundedQueuedBytes,
}).check(
  Schema.makeFilter((status) => {
    if (status.state === "degraded" && status.degradedMode === undefined) {
      return "degraded status requires degradedMode";
    }
    if (status.state !== "degraded" && status.degradedMode !== undefined) {
      return "degradedMode is allowed only for degraded status";
    }
    if (status.state === "online") {
      if (
        status.protocolMajor !== RELAY_PROTOCOL_MAJOR ||
        status.protocolMinor !== RELAY_PROTOCOL_MINOR
      ) {
        return "online status requires the supported relay protocol";
      }
    } else if (status.protocolMajor !== undefined || status.protocolMinor !== undefined) {
      return "protocol is exposed only while online";
    }
    if (status.nextRetryAt !== undefined && status.degradedMode !== "backing_off") {
      return "nextRetryAt requires backing_off";
    }
    if (status.state !== "online" && status.activeChannels !== 0) {
      return "active channels require online status";
    }
  }),
);
export type HubConnectorStatus = typeof HubConnectorStatus.Type;

export const HubNodePublicKeyFingerprint = Schema.String.check(
  Schema.isPattern(/^SHA256:[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/),
);
export type HubNodePublicKeyFingerprint = typeof HubNodePublicKeyFingerprint.Type;

/**
 * The fields an approver compares, in the order the approval screen renders them.
 *
 * The node and the approval surface must show the same set: a reviewer holding
 * both screens is asked to compare every field, so a field present on one and
 * absent on the other silently narrows the check.
 */
export const HubEnrollmentCeremonyDetail = Schema.Struct({
  deviceCode: Schema.String.check(Schema.isPattern(/^[A-Z0-9-]{4,32}$/)),
  fingerprint: HubNodePublicKeyFingerprint,
  label: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  platformOs: Schema.Literals(["darwin", "linux", "windows", "unknown"]),
  platformArch: Schema.Literals(["arm64", "x64", "other"]),
  clientVersion: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  algorithm: Schema.Literals(["ed25519"]),
  expiresAt: IsoDateTime,
  pollIntervalMs: NonNegativeInt.check(Schema.isBetween({ minimum: 1_000, maximum: 60_000 })),
});
export type HubEnrollmentCeremonyDetail = typeof HubEnrollmentCeremonyDetail.Type;

export const HubEnrollmentStartResult = Schema.Struct({
  status: HubConnectorStatus,
  ...HubEnrollmentCeremonyDetail.fields,
});
export type HubEnrollmentStartResult = typeof HubEnrollmentStartResult.Type;
