import type { RelayEffectiveRole } from "@ryco/contracts";
import { hostedRoleAllows } from "@ryco/shared/rpcAccessPolicy";

import type { WsProtocolLifecycleHandlers } from "../rpc/protocol";
import { hostedHubApi, HostedHubApiError } from "./api";
import { HostedReconnectPolicy } from "./reconnectPolicy";
import {
  HostedRelayRpcWebSocket,
  hostedRelayWebSocketUrl,
  type HostedRelaySocketCallbacks,
} from "./relaySocket";
import { hostedHubController, useHostedHubStore } from "./state";
import type { HostedRelayFailure } from "./types";

interface PendingTicket {
  readonly ticket: string;
  readonly expiresAt: number;
  readonly generation: number;
  used: boolean;
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

export class HostedRelayAttemptFactory {
  readonly #reconnect = new HostedReconnectPolicy();
  readonly #pendingRequests = new Set<string>();
  #pendingTicket: PendingTicket | null = null;
  #lastRetryAfterMs: number | undefined;
  #activeGeneration: number | null = null;

  async nextUrl(): Promise<string> {
    const state = useHostedHubStore.getState();
    const node = state.selectedNode;
    if (!node || state.accountStatus !== "authenticated") {
      throw new Error("No authorized hosted node is selected.");
    }
    const generation = state.generation;
    this.#activeGeneration = generation;
    hostedHubController.transportStatus(generation, "requesting-ticket");
    this.#pendingTicket = null;
    try {
      const issued = await hostedHubApi.issueRelayTicket(node.id);
      if (useHostedHubStore.getState().generation !== generation) {
        throw new Error("Hosted node selection changed.");
      }
      this.#pendingTicket = {
        ticket: issued.ticket,
        expiresAt: issued.expiresAt,
        generation,
        used: false,
      };
      return hostedRelayWebSocketUrl();
    } catch (error) {
      if (error instanceof HostedHubApiError && error.status === 401) {
        void hostedHubController.expireSession();
      } else if (error instanceof HostedHubApiError) {
        const failure = ticketFailure(error);
        this.#lastRetryAfterMs = failure.retryAfterMs;
        hostedHubController.failure(generation, failure);
      }
      throw error;
    }
  }

  createSocket(url: string): WebSocket {
    const pending = this.#pendingTicket;
    this.#pendingTicket = null;
    if (!pending || pending.used || pending.expiresAt <= Date.now()) {
      throw new Error("A fresh relay ticket is required for every connection attempt.");
    }
    pending.used = true;
    const generation = pending.generation;
    const ticket = pending.ticket;
    const ticketExpiresAt = pending.expiresAt;
    const callbacks: HostedRelaySocketCallbacks = {
      onTransportStatus: (status) => hostedHubController.transportStatus(generation, status),
      onSessionStatus: (status) => hostedHubController.sessionStatus(generation, status),
      onRole: (role: RelayEffectiveRole | null) => hostedHubController.role(generation, role),
      onFailure: (failure) => {
        this.#lastRetryAfterMs = failure.retryAfterMs;
        this.#reconnect.closed();
        if (this.#pendingRequests.size > 0) {
          hostedHubController.markDeliveryUnknown(generation);
          this.#pendingRequests.clear();
        }
        hostedHubController.failure(generation, failure);
      },
    };
    this.#activeGeneration = generation;
    try {
      return new HostedRelayRpcWebSocket({
        url,
        ticket,
        ticketExpiresAt,
        callbacks,
      }) as unknown as WebSocket;
    } catch (error) {
      if (this.#activeGeneration === generation) this.#activeGeneration = null;
      throw error;
    }
  }

  lifecycleHandlers(): WsProtocolLifecycleHandlers {
    return {
      webSocketConstructor: (url) => this.createSocket(url),
      preserveSocketPath: true,
      retryTransientErrors: false,
      reconnectMaxRetries: 1_000_000,
      shouldReconnect: () => {
        const state = useHostedHubStore.getState();
        return (
          this.#activeGeneration === state.generation &&
          state.accountStatus === "authenticated" &&
          state.selectedNode !== null &&
          state.transportStatus !== "terminal-failure"
        );
      },
      authorizeRequest: (info) => {
        const state = useHostedHubStore.getState();
        return hostedRoleAllows(state.effectiveRole, info.tag, state.directoryStatus === "ready");
      },
      getReconnectDelayMs: () => {
        const delay = this.#reconnect.nextDelay(this.#lastRetryAfterMs);
        this.#lastRetryAfterMs = undefined;
        if (this.#activeGeneration !== null) {
          hostedHubController.transportStatus(this.#activeGeneration, "reconnecting");
        }
        return delay;
      },
      onOpen: () => this.#reconnect.opened(),
      onClose: (_details, context) => {
        if (context.intentional) return;
        const generation = this.#activeGeneration;
        if (generation === null) return;
        this.#reconnect.closed();
        hostedHubController.connectionClosed(generation);
      },
      onRequestStart: (info) => {
        if (!info.stream) this.#pendingRequests.add(info.id);
      },
      onRequestChunk: (info) => this.#pendingRequests.delete(info.id),
      onRequestExit: (info) => this.#pendingRequests.delete(info.id),
      onRequestInterrupt: (info) => this.#pendingRequests.delete(info.id),
    };
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

export function resetHostedRelayAttemptFactory(): void {
  attemptFactory?.reset();
  attemptFactory = null;
}
