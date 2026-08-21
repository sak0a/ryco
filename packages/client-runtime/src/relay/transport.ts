import { ORCHESTRATION_WS_METHODS, type RelayEffectiveRole, WS_METHODS } from "@ryco/contracts";
import { hostedRoleAllows } from "@ryco/shared/rpcAccessPolicy";

import type { WsProtocolLifecycleHandlers } from "@ryco/client-runtime/rpc";
import { HostedHubApiError } from "../authorization/api.ts";
import { getHostedHubApi, getHostedRuntimeConfiguration } from "../authorization/runtime.ts";
import { hostedHubController, hostedHubStore } from "../authorization/state.ts";
import type {
  HostedRelayFailure,
  HostedRelayTransportStatus,
  HostedRycoSessionStatus,
} from "../authorization/types.ts";
import { HostedReconnectPolicy } from "./reconnectPolicy.ts";

interface PendingTicket {
  readonly ticket: string;
  readonly expiresAt: number;
  readonly generation: number;
  readonly preparedSocketContext: unknown;
  used: boolean;
}

const HOSTED_SESSION_SYNC_SUBSCRIPTIONS = new Set<string>([
  ORCHESTRATION_WS_METHODS.subscribeShell,
  ORCHESTRATION_WS_METHODS.subscribeThread,
  ORCHESTRATION_WS_METHODS.subscribeThreadWindow,
  WS_METHODS.subscribeServerConfig,
  WS_METHODS.subscribeServerLifecycle,
  WS_METHODS.subscribeTerminalEvents,
  WS_METHODS.subscribeVcsStatus,
]);

const HOSTED_READ_ONLY_STREAMS = new Set<string>([
  ...HOSTED_SESSION_SYNC_SUBSCRIPTIONS,
  WS_METHODS.subscribeAuthAccess,
]);

type HostedRequestAuthorizationState = Pick<
  ReturnType<typeof hostedHubStore.getState>,
  "effectiveRole" | "directoryStatus" | "transportStatus" | "browserStatus" | "sessionStatus"
>;

export function authorizeHostedRequestForState(
  state: HostedRequestAuthorizationState,
  info: { readonly tag: string; readonly stream: boolean },
): boolean {
  if (!hostedRoleAllows(state.effectiveRole, info.tag, state.directoryStatus === "ready")) {
    return false;
  }
  if (
    state.transportStatus === "online" &&
    state.browserStatus === "current" &&
    state.sessionStatus === "ready"
  ) {
    return true;
  }
  return (
    info.stream &&
    (state.browserStatus === "current" || state.browserStatus === "synchronizing") &&
    (state.sessionStatus === "synchronizing" ||
      state.sessionStatus === "replaying" ||
      state.sessionStatus === "delivery-unknown" ||
      state.sessionStatus === "stale" ||
      state.sessionStatus === "closed") &&
    HOSTED_SESSION_SYNC_SUBSCRIPTIONS.has(info.tag)
  );
}

function authorizeHostedRequest(info: { readonly tag: string; readonly stream: boolean }): boolean {
  return authorizeHostedRequestForState(hostedHubStore.getState(), info);
}

export function ticketFailure(error: HostedHubApiError): HostedRelayFailure {
  switch (error.code) {
    case "node_offline":
      return {
        kind: "offline",
        retryable: true,
        ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }),
      };
    case "server_draining":
      return {
        kind: "draining",
        retryable: true,
        ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }),
      };
    case "rate_limited":
      return {
        kind: "rate-limited",
        retryable: true,
        ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }),
      };
    case "unsupported_version":
      return { kind: "incompatible", retryable: false };
    case "forbidden":
    case "authorization_failed":
      return { kind: "authorization-removed", retryable: false };
    case "revoked":
      return { kind: "revoked", retryable: false };
    default:
      return { kind: "network", retryable: true };
  }
}

/**
 * Per-connection lifecycle binding. Web and single-selection clients omit it
 * and retain the package-owned hosted store/controller behavior. Mobile Wave
 * 3b binds one factory to one environment so a retained socket can neither buy
 * a reconnect ticket for a later selection nor publish delivery state into a
 * different environment's row.
 */
export interface HostedRelayAttemptBinding {
  readonly nodeId: () => string | null;
  readonly generation: () => number | null;
  readonly isAuthenticated: () => boolean;
  readonly isCurrent: (generation: number) => boolean;
  readonly prepareSocketContext?: () => Promise<unknown>;
  readonly relayUrl?: () => string;
  readonly createRelaySocket?: (input: {
    readonly url: string;
    readonly ticket: string;
    readonly ticketExpiresAt: number;
    readonly callbacks: {
      readonly onTransportStatus: (status: HostedRelayTransportStatus) => void;
      readonly onSessionStatus: (status: HostedRycoSessionStatus) => void;
      readonly onRole: (role: RelayEffectiveRole | null) => void;
      readonly onFailure: (failure: HostedRelayFailure) => void;
    };
    readonly preparedSocketContext: unknown;
  }) => unknown;
  readonly authorizeRequest: (info: { readonly tag: string; readonly stream: boolean }) => boolean;
  readonly shouldReconnect: (generation: number) => boolean;
  readonly transportStatus: (generation: number, status: HostedRelayTransportStatus) => void;
  readonly sessionStatus: (generation: number, status: HostedRycoSessionStatus) => void;
  readonly role: (generation: number, role: RelayEffectiveRole | null) => void;
  readonly failure: (generation: number, failure: HostedRelayFailure) => void;
  readonly markDeliveryUnknown: (generation: number) => void;
  readonly connectionClosed: (generation: number) => void;
}

function defaultBinding(): HostedRelayAttemptBinding {
  return {
    nodeId: () => hostedHubStore.getState().selectedNode?.id ?? null,
    generation: () => hostedHubStore.getState().generation,
    isAuthenticated: () => hostedHubStore.getState().accountStatus === "authenticated",
    isCurrent: (generation) => hostedHubStore.getState().generation === generation,
    authorizeRequest: authorizeHostedRequest,
    shouldReconnect: (generation) => {
      const state = hostedHubStore.getState();
      return (
        generation === state.generation &&
        state.accountStatus === "authenticated" &&
        state.selectedNode !== null &&
        (state.browserStatus === "current" || state.browserStatus === "synchronizing") &&
        state.transportStatus !== "terminal-failure"
      );
    },
    transportStatus: (generation, status) =>
      hostedHubController.transportStatus(generation, status),
    sessionStatus: (generation, status) => hostedHubController.sessionStatus(generation, status),
    role: (generation, role) => hostedHubController.role(generation, role),
    failure: (generation, failure) => hostedHubController.failure(generation, failure),
    markDeliveryUnknown: (generation) => hostedHubController.markDeliveryUnknown(generation),
    connectionClosed: (generation) => hostedHubController.connectionClosed(generation),
  };
}

export class HostedRelayAttemptFactory {
  readonly #binding: HostedRelayAttemptBinding;
  readonly #reconnect = new HostedReconnectPolicy();
  readonly #pendingRequests = new Map<string, "first-chunk" | "exit">();
  #pendingTicket: PendingTicket | null = null;
  #lastRetryAfterMs: number | undefined;
  #activeGeneration: number | null = null;

  constructor(binding: HostedRelayAttemptBinding = defaultBinding()) {
    this.#binding = binding;
  }

  async nextUrl(): Promise<string> {
    const nodeId = this.#binding.nodeId();
    const generation = this.#binding.generation();
    if (!nodeId || generation === null || !this.#binding.isAuthenticated()) {
      throw new Error("No authorized hosted node is selected.");
    }
    this.#activeGeneration = generation;
    this.#binding.transportStatus(generation, "requesting-ticket");
    this.#pendingTicket = null;
    try {
      const preparedSocketContext = await this.#binding.prepareSocketContext?.();
      if (!this.#binding.isCurrent(generation)) throw new Error("Hosted node selection changed.");
      const issued = await getHostedHubApi().issueRelayTicket(nodeId);
      if (!this.#binding.isCurrent(generation)) {
        throw new Error("Hosted node selection changed.");
      }
      this.#pendingTicket = {
        ticket: issued.ticket,
        expiresAt: issued.expiresAt,
        generation,
        preparedSocketContext,
        used: false,
      };
      return this.#binding.relayUrl?.() ?? getHostedRuntimeConfiguration().relayUrl();
    } catch (error) {
      if (error instanceof HostedHubApiError && error.status === 401) {
        void hostedHubController.expireSession();
      } else if (error instanceof HostedHubApiError) {
        const failure = ticketFailure(error);
        this.#lastRetryAfterMs = failure.retryAfterMs;
        this.#binding.failure(generation, failure);
      }
      throw error;
    }
  }

  createSocket(url: string): unknown {
    const pending = this.#pendingTicket;
    this.#pendingTicket = null;
    if (
      !pending ||
      pending.used ||
      pending.expiresAt <= getHostedRuntimeConfiguration().timers.now()
    ) {
      throw new Error("A fresh relay ticket is required for every connection attempt.");
    }
    pending.used = true;
    const generation = pending.generation;
    const ticket = pending.ticket;
    const ticketExpiresAt = pending.expiresAt;
    const callbacks = {
      onTransportStatus: (status: HostedRelayTransportStatus) =>
        this.#binding.transportStatus(generation, status),
      onSessionStatus: (status: HostedRycoSessionStatus) =>
        this.#binding.sessionStatus(generation, status),
      onRole: (role: RelayEffectiveRole | null) => this.#binding.role(generation, role),
      onFailure: (failure: HostedRelayFailure) => {
        this.#lastRetryAfterMs = failure.retryAfterMs;
        this.#reconnect.closed();
        if (this.#pendingRequests.size > 0) {
          this.#binding.markDeliveryUnknown(generation);
          this.#pendingRequests.clear();
        }
        this.#binding.failure(generation, failure);
      },
    };
    this.#activeGeneration = generation;
    try {
      return this.#binding.createRelaySocket
        ? this.#binding.createRelaySocket({
            url,
            ticket,
            ticketExpiresAt,
            callbacks,
            preparedSocketContext: pending.preparedSocketContext,
          })
        : getHostedRuntimeConfiguration().createRelaySocket({
            url,
            ticket,
            ticketExpiresAt,
            callbacks,
          });
    } catch (error) {
      if (this.#activeGeneration === generation) this.#activeGeneration = null;
      throw error;
    }
  }

  lifecycleHandlers(): WsProtocolLifecycleHandlers {
    return {
      webSocketConstructor: (url) => this.createSocket(url) as WebSocket,
      preserveSocketPath: true,
      retryTransientErrors: false,
      reconnectMaxRetries: 1_000_000,
      shouldReconnect: () =>
        this.#activeGeneration !== null && this.#binding.shouldReconnect(this.#activeGeneration),
      authorizeRequest: (info) => this.#binding.authorizeRequest(info),
      getReconnectDelayMs: () => {
        const delay = this.#reconnect.nextDelay(this.#lastRetryAfterMs);
        this.#lastRetryAfterMs = undefined;
        return delay;
      },
      onOpen: () => this.#reconnect.opened(),
      onClose: (_details, context) => {
        if (context.intentional) return;
        const generation = this.#activeGeneration;
        if (generation === null) return;
        this.#reconnect.closed();
        this.#binding.connectionClosed(generation);
      },
      onRequestStart: (info) => {
        if (info.stream && HOSTED_READ_ONLY_STREAMS.has(info.tag)) return;
        this.#pendingRequests.set(info.id, info.stream ? "exit" : "first-chunk");
      },
      onRequestChunk: (info) => {
        if (this.#pendingRequests.get(info.id) === "first-chunk") {
          this.#pendingRequests.delete(info.id);
        }
      },
      onRequestExit: (info) => this.#pendingRequests.delete(info.id),
      onRequestInterrupt: (info) => this.#pendingRequests.delete(info.id),
    };
  }

  hasPendingRequests(): boolean {
    return this.#pendingRequests.size > 0;
  }

  reset(): void {
    this.#pendingTicket = null;
    this.#pendingRequests.clear();
    this.#lastRetryAfterMs = undefined;
    this.#activeGeneration = null;
    this.#reconnect.reset();
  }
}

let attemptFactory: HostedRelayAttemptFactory | null = null;

export function getHostedRelayAttemptFactory(): HostedRelayAttemptFactory {
  attemptFactory ??= new HostedRelayAttemptFactory();
  return attemptFactory;
}

export function hasHostedRelayPendingRequests(): boolean {
  return attemptFactory?.hasPendingRequests() ?? false;
}

export function resetHostedRelayAttemptFactory(): void {
  attemptFactory?.reset();
  attemptFactory = null;
}
