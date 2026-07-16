import type { HubConnectorStatus } from "@ryco/contracts";
import type { RelayErrorFrame, RelayFrame } from "@ryco/contracts/relay";

import type { HubConnectorConfig } from "../config.ts";
import {
  classifyConnectorFailure,
  type ConnectorFailureKind,
  HubConnectorStateMachine,
} from "./HubConnectorState.ts";
import type { HubIdentityRuntimeShape } from "./HubIdentityRuntime.ts";
import type { HubRelayTransport } from "./HubRelayTransport.ts";
import {
  relayErrorKind,
  RelayConnectionError,
  RelayConnectionSession,
  type RelaySessionScheduler,
} from "./RelayConnectionSession.ts";
import { RelayChannelRegistry, type RelayChannelSessionFactory } from "./RelayChannelRegistry.ts";
import { reconnectDelay } from "./ReconnectPolicy.ts";
import { RelaySendQueue } from "./RelaySendQueue.ts";

export interface HubConnectorScheduler extends RelaySessionScheduler {
  readonly now: () => number;
  readonly random: () => number;
}

const defaultScheduler: HubConnectorScheduler = {
  now: Date.now,
  random: Math.random,
  setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class HubConnector {
  readonly #config: HubConnectorConfig;
  readonly #identity: HubIdentityRuntimeShape;
  readonly #transport: HubRelayTransport;
  readonly #channels: RelayChannelSessionFactory;
  readonly #scheduler: HubConnectorScheduler;
  readonly #state: HubConnectorStateMachine;
  #attempt = 0;
  #protocolViolations = 0;
  #started = false;
  #stopping = false;
  #connecting = false;
  #session: RelayConnectionSession | undefined;
  #sendQueue: RelaySendQueue | undefined;
  #registry: RelayChannelRegistry | undefined;
  #retryTimer: unknown;
  #stableTimer: unknown;
  #heartbeatTimer: unknown;
  #drainTimer: unknown;
  #frameChain: Promise<void> = Promise.resolve();

  constructor(options: {
    readonly config: HubConnectorConfig;
    readonly identity: HubIdentityRuntimeShape;
    readonly transport: HubRelayTransport;
    readonly channels: RelayChannelSessionFactory;
    readonly scheduler?: HubConnectorScheduler;
  }) {
    this.#config = options.config;
    this.#identity = options.identity;
    this.#transport = options.transport;
    this.#channels = options.channels;
    this.#scheduler = options.scheduler ?? defaultScheduler;
    this.#state = new HubConnectorStateMachine(this.#scheduler.now);
  }

  status(): HubConnectorStatus {
    return this.#state.snapshot();
  }

  async start(): Promise<void> {
    if (this.#started || this.#stopping) return;
    this.#started = true;
    if (!this.#config.enabled) return;
    if (this.#config.configurationIssue !== undefined || this.#config.origin === undefined) {
      this.#state.transition("degraded", {
        degradedMode: "operator_action_required",
        failure: "configuration_invalid",
      });
      return;
    }
    let identity;
    try {
      identity = await this.#identity.readState();
    } catch {
      this.#state.transition("degraded", {
        degradedMode: "operator_action_required",
        failure: "identity_unavailable",
      });
      return;
    }
    if (identity.activeNode === null) {
      this.#state.transition(
        identity.pendingEnrollment === null ? "enrolling" : "awaiting_approval",
      );
      return;
    }
    if (identity.activeNode.hubOrigin !== this.#config.origin) {
      this.#state.transition("degraded", {
        degradedMode: "operator_action_required",
        failure: "identity_origin_mismatch",
      });
      return;
    }
    await this.#connect();
  }

  async resume(): Promise<void> {
    if (!this.#started || this.#stopping || !this.#config.enabled) return;
    this.#clearTimer("retry");
    await this.#connect();
  }

  async stop(): Promise<void> {
    if (this.#stopping) return this.#frameChain;
    this.#stopping = true;
    this.#state.invalidateGeneration();
    if (this.#state.snapshot().state !== "disabled") this.#state.transition("stopping");
    this.#clearAllTimers();
    const registry = this.#registry;
    this.#registry = undefined;
    await registry?.closeAll();
    this.#sendQueue?.close();
    this.#sendQueue = undefined;
    this.#session?.close();
    this.#session = undefined;
    await this.#frameChain.catch(() => undefined);
    this.#state.transition("disabled");
    this.#started = false;
  }

  async #connect(): Promise<void> {
    if (this.#stopping || this.#connecting || this.#session !== undefined) return;
    const origin = this.#config.origin;
    if (origin === undefined) return;
    this.#connecting = true;
    const generation = this.#state.beginGeneration();
    const current = this.#state.snapshot().state;
    if (current !== "connecting") this.#state.transition("connecting");
    const session = new RelayConnectionSession({
      identity: this.#identity,
      transport: this.#transport,
      hubOrigin: origin,
      scheduler: this.#scheduler,
      onFrame: (frame) => {
        this.#frameChain = this.#frameChain
          .then(() => this.#handleFrame(generation, frame))
          .catch(() => this.#handleFailure(generation, "internal_error"));
      },
      onTerminal: (error) => {
        void this.#handleFailure(generation, error.kind, error.retryAfterMs);
      },
    });
    this.#session = session;
    this.#state.transition("authenticating");
    try {
      const ready = await session.authenticate();
      if (!this.#state.isCurrent(generation) || this.#stopping) {
        session.close();
        return;
      }
      const socket = session.socket;
      if (socket === undefined) throw new RelayConnectionError("internal_error");
      const sendQueue = new RelaySendQueue(socket, ready.limits);
      const registry = new RelayChannelRegistry({
        limits: ready.limits,
        sendQueue,
        factory: this.#channels,
      });
      this.#sendQueue = sendQueue;
      this.#registry = registry;
      this.#state.online();
      this.#scheduleStableReset(generation);
      this.#scheduleHeartbeatTimeout(generation, ready.limits.deadConnectionTimeoutMs);
    } catch (error: unknown) {
      if (!this.#state.isCurrent(generation) || this.#stopping) return;
      const failure =
        error instanceof RelayConnectionError ? error : new RelayConnectionError("internal_error");
      await this.#handleFailure(generation, failure.kind, failure.retryAfterMs);
    } finally {
      this.#connecting = false;
    }
  }

  async #handleFrame(generation: number, frame: RelayFrame): Promise<void> {
    if (!this.#state.isCurrent(generation) || this.#stopping) return;
    if (frame.type === "ping") {
      this.#scheduleHeartbeatTimeout(
        generation,
        this.#session?.ready?.limits.deadConnectionTimeoutMs ?? 45_000,
      );
      if (
        !this.#sendQueue?.enqueueControl({
          type: "pong",
          protocolMajor: frame.protocolMajor,
          protocolMinor: frame.protocolMinor,
          nonce: Uint8Array.from(frame.nonce),
        })
      ) {
        await this.#handleFailure(generation, "internal_error");
        return;
      }
    } else if (frame.type === "error") {
      await this.#handleFailure(
        generation,
        relayErrorKind(frame as RelayErrorFrame),
        frame.retryAfterMs,
      );
      return;
    } else {
      await this.#registry?.handle(frame);
    }
    this.#flushAndScheduleDrain(generation);
    this.#state.updateOnlineMetrics(this.#registry?.size ?? 0, this.#sendQueue?.ownedBytes ?? 0);
  }

  async #handleFailure(
    generation: number,
    kind: ConnectorFailureKind,
    retryAfterMs?: number,
  ): Promise<void> {
    if (!this.#state.isCurrent(generation) || this.#stopping) return;
    this.#state.invalidateGeneration();
    this.#clearTimer("stable");
    this.#clearTimer("heartbeat");
    this.#clearTimer("drain");
    const registry = this.#registry;
    this.#registry = undefined;
    await registry?.closeAll();
    this.#sendQueue?.close();
    this.#sendQueue = undefined;
    this.#session?.close();
    this.#session = undefined;
    const disposition = classifyConnectorFailure(kind, this.#protocolViolations);
    if (kind === "protocol_invalid") this.#protocolViolations += 1;
    if (disposition.action === "operator") {
      if (disposition.terminalState !== undefined) {
        this.#state.transition(disposition.terminalState, { failure: disposition.failure });
      } else {
        this.#state.transition("degraded", {
          degradedMode: "operator_action_required",
          failure: disposition.failure,
        });
      }
      return;
    }
    const decision = reconnectDelay(
      {
        baseDelayMs: this.#config.reconnectBaseMs,
        maxDelayMs: this.#config.reconnectMaxMs,
        jitterRatio: this.#config.reconnectJitterRatio,
      },
      this.#attempt,
      this.#scheduler.random(),
      retryAfterMs,
    );
    this.#attempt += 1;
    const retryGeneration = this.#state.generation;
    this.#state.transition("degraded", {
      degradedMode: "backing_off",
      failure: disposition.failure,
      reconnectAttempt: decision.attempt,
      nextRetryAt: new Date(this.#scheduler.now() + decision.delayMs).toISOString(),
    });
    this.#retryTimer = this.#scheduler.setTimeout(() => {
      this.#retryTimer = undefined;
      if (!this.#state.isCurrent(retryGeneration) || this.#stopping) return;
      void this.#connect();
    }, decision.delayMs);
  }

  #scheduleStableReset(generation: number): void {
    this.#clearTimer("stable");
    this.#stableTimer = this.#scheduler.setTimeout(() => {
      this.#stableTimer = undefined;
      if (!this.#state.isCurrent(generation) || this.#state.snapshot().state !== "online") return;
      this.#attempt = 0;
      this.#protocolViolations = 0;
    }, this.#config.reconnectStableMs);
  }

  #scheduleHeartbeatTimeout(generation: number, milliseconds: number): void {
    this.#clearTimer("heartbeat");
    this.#heartbeatTimer = this.#scheduler.setTimeout(() => {
      this.#heartbeatTimer = undefined;
      void this.#handleFailure(generation, "heartbeat_timeout");
    }, milliseconds);
  }

  #flushAndScheduleDrain(generation: number): void {
    try {
      this.#sendQueue?.flush();
    } catch {
      void this.#handleFailure(generation, "network");
      return;
    }
    if (
      this.#drainTimer !== undefined ||
      ((this.#sendQueue?.queuedBytes ?? 0) === 0 &&
        (this.#session?.socket?.bufferedAmount ?? 0) === 0)
    ) {
      return;
    }
    this.#drainTimer = this.#scheduler.setTimeout(() => {
      this.#drainTimer = undefined;
      if (!this.#state.isCurrent(generation) || this.#stopping) return;
      void this.#registry?.refreshFlow().then(() => this.#flushAndScheduleDrain(generation));
    }, 10);
  }

  #clearTimer(kind: "retry" | "stable" | "heartbeat" | "drain"): void {
    const current =
      kind === "retry"
        ? this.#retryTimer
        : kind === "stable"
          ? this.#stableTimer
          : kind === "heartbeat"
            ? this.#heartbeatTimer
            : this.#drainTimer;
    if (current !== undefined) this.#scheduler.clearTimeout(current);
    if (kind === "retry") this.#retryTimer = undefined;
    else if (kind === "stable") this.#stableTimer = undefined;
    else if (kind === "heartbeat") this.#heartbeatTimer = undefined;
    else this.#drainTimer = undefined;
  }

  #clearAllTimers(): void {
    this.#clearTimer("retry");
    this.#clearTimer("stable");
    this.#clearTimer("heartbeat");
    this.#clearTimer("drain");
  }
}
