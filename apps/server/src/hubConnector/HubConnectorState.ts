import type {
  HubConnectorFailureCode,
  HubConnectorState,
  HubConnectorStatus,
} from "@ryco/contracts";
import { RELAY_PROTOCOL_MAJOR, RELAY_PROTOCOL_MINOR } from "@ryco/contracts/relay";

export type ConnectorFailureKind =
  | "configuration_invalid"
  | "identity_unavailable"
  | "identity_origin_mismatch"
  | "enrollment_unavailable"
  | "dns"
  | "network"
  | "tls"
  | "authentication_timeout"
  | "authentication_failed"
  | "connection_replaced"
  | "server_draining"
  | "rate_limited"
  | "heartbeat_timeout"
  | "slow_consumer"
  | "protocol_invalid"
  | "revoked"
  | "version_incompatible"
  | "internal_error";

export type ConnectorFailureDisposition =
  | { readonly action: "retry"; readonly failure: HubConnectorFailureCode }
  | {
      readonly action: "operator";
      readonly failure: HubConnectorFailureCode;
      readonly terminalState?: "revoked" | "version_incompatible";
    };

export function classifyConnectorFailure(
  kind: ConnectorFailureKind,
  protocolViolationsBeforeStability: number,
): ConnectorFailureDisposition {
  switch (kind) {
    case "dns":
    case "network":
      return { action: "retry", failure: "network_unavailable" };
    case "tls":
      return { action: "retry", failure: "tls_unavailable" };
    case "authentication_timeout":
      return { action: "retry", failure: "authentication_timeout" };
    case "server_draining":
      return { action: "retry", failure: "server_draining" };
    case "rate_limited":
      return { action: "retry", failure: "rate_limited" };
    case "heartbeat_timeout":
      return { action: "retry", failure: "heartbeat_timeout" };
    case "slow_consumer":
      return { action: "retry", failure: "slow_consumer" };
    case "internal_error":
      return { action: "retry", failure: "internal_error" };
    case "protocol_invalid":
      return protocolViolationsBeforeStability === 0
        ? { action: "retry", failure: "protocol_invalid" }
        : { action: "operator", failure: "protocol_invalid" };
    case "configuration_invalid":
    case "identity_unavailable":
    case "identity_origin_mismatch":
    case "enrollment_unavailable":
    case "authentication_failed":
    case "connection_replaced":
      return { action: "operator", failure: kind };
    case "revoked":
      return { action: "operator", failure: "authentication_failed", terminalState: "revoked" };
    case "version_incompatible":
      return {
        action: "operator",
        failure: "protocol_invalid",
        terminalState: "version_incompatible",
      };
  }
}

const transitions: Readonly<Record<HubConnectorState, ReadonlySet<HubConnectorState>>> = {
  disabled: new Set(["enrolling", "awaiting_approval", "connecting", "degraded", "stopping"]),
  enrolling: new Set(["awaiting_approval", "connecting", "degraded", "stopping", "disabled"]),
  awaiting_approval: new Set(["enrolling", "connecting", "degraded", "stopping", "disabled"]),
  connecting: new Set([
    "authenticating",
    "degraded",
    "revoked",
    "version_incompatible",
    "stopping",
    "disabled",
  ]),
  authenticating: new Set([
    "online",
    "degraded",
    "revoked",
    "version_incompatible",
    "stopping",
    "disabled",
  ]),
  online: new Set(["degraded", "revoked", "version_incompatible", "stopping", "disabled"]),
  degraded: new Set([
    "enrolling",
    "awaiting_approval",
    "connecting",
    "revoked",
    "version_incompatible",
    "stopping",
    "disabled",
  ]),
  revoked: new Set(["enrolling", "stopping", "disabled"]),
  version_incompatible: new Set(["connecting", "stopping", "disabled"]),
  stopping: new Set(["disabled"]),
};

export class HubConnectorStateMachine {
  readonly #now: () => number;
  #generation = 0;
  #status: HubConnectorStatus;

  constructor(now: () => number = Date.now) {
    this.#now = now;
    this.#status = {
      state: "disabled",
      transitionedAt: new Date(now()).toISOString(),
      activeChannels: 0,
      queuedBytes: 0,
    };
  }

  get generation(): number {
    return this.#generation;
  }

  snapshot(): HubConnectorStatus {
    return { ...this.#status };
  }

  beginGeneration(): number {
    this.#generation += 1;
    return this.#generation;
  }

  invalidateGeneration(): number {
    return this.beginGeneration();
  }

  isCurrent(generation: number): boolean {
    return generation === this.#generation;
  }

  transition(
    state: HubConnectorState,
    fields: Omit<
      HubConnectorStatus,
      "state" | "transitionedAt" | "activeChannels" | "queuedBytes"
    > & { readonly activeChannels?: number; readonly queuedBytes?: number } = {},
  ): HubConnectorStatus {
    if (state !== this.#status.state && !transitions[this.#status.state].has(state)) {
      throw new Error("Hub connector state transition is invalid.");
    }
    this.#status = {
      state,
      transitionedAt: new Date(this.#now()).toISOString(),
      activeChannels: fields.activeChannels ?? 0,
      queuedBytes: fields.queuedBytes ?? 0,
      ...(fields.degradedMode === undefined ? {} : { degradedMode: fields.degradedMode }),
      ...(fields.failure === undefined ? {} : { failure: fields.failure }),
      ...(fields.reconnectAttempt === undefined
        ? {}
        : { reconnectAttempt: fields.reconnectAttempt }),
      ...(fields.nextRetryAt === undefined ? {} : { nextRetryAt: fields.nextRetryAt }),
      ...(fields.protocolMajor === undefined ? {} : { protocolMajor: fields.protocolMajor }),
      ...(fields.protocolMinor === undefined ? {} : { protocolMinor: fields.protocolMinor }),
    };
    return this.snapshot();
  }

  online(activeChannels = 0, queuedBytes = 0): HubConnectorStatus {
    return this.transition("online", {
      protocolMajor: RELAY_PROTOCOL_MAJOR,
      protocolMinor: RELAY_PROTOCOL_MINOR,
      activeChannels,
      queuedBytes,
    });
  }

  updateOnlineMetrics(activeChannels: number, queuedBytes: number): HubConnectorStatus {
    if (this.#status.state !== "online") return this.snapshot();
    this.#status = { ...this.#status, activeChannels, queuedBytes };
    return this.snapshot();
  }
}
