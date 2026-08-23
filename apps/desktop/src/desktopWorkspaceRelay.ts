import * as Crypto from "node:crypto";

import type { EnvironmentId } from "@ryco/contracts";
import {
  HostedRelayEngine,
  makeRelayE2eeInitiator,
  type HostedRelaySocketCallbacks,
  type RelayE2eeInitiatorAttempt,
  type RelayE2eeProvider,
  type RelaySocket,
} from "@ryco/client-runtime/relay";
import { E2EE_SUITE_25519_CHACHAPOLY_SHA256 } from "@ryco/shared/relayE2eeWire";
import WebSocket, { type RawData } from "ws";

import type {
  DesktopNativeE2eeHandshakeService,
  DesktopNativeE2eePreparation,
} from "./desktopNativeE2eeHandshake.ts";

const MAX_TRANSPORTS = 8;
const MAX_APPLICATION_FRAME_BYTES = 16 * 1024 * 1024;
const PREPARED_LIFETIME_MS = 30_000;

export type DesktopWorkspaceTransportEvent =
  | { readonly type: "open"; readonly transportId: string }
  | { readonly type: "message"; readonly transportId: string; readonly data: Uint8Array }
  | { readonly type: "error"; readonly transportId: string }
  | {
      readonly type: "close";
      readonly transportId: string;
      readonly code: number;
      readonly reason: string;
    };

export interface DesktopWorkspaceRelayTarget {
  readonly accountId: string;
  readonly nodeId: string;
  readonly environmentId: EnvironmentId;
  readonly relayUrl: string;
}

export interface DesktopWorkspaceRelayAuthority {
  readonly resolveTarget: (
    environmentId: EnvironmentId,
  ) => Promise<DesktopWorkspaceRelayTarget | null>;
  readonly prepareE2ee: (
    target: DesktopWorkspaceRelayTarget,
  ) => Promise<DesktopNativeE2eePreparation>;
  readonly handshake: () => Promise<DesktopNativeE2eeHandshakeService>;
  readonly issueTicket: (
    target: DesktopWorkspaceRelayTarget,
  ) => Promise<{ readonly ticket: string; readonly expiresAt: number }>;
  readonly authorizeUpgrade: (
    target: DesktopWorkspaceRelayTarget,
  ) => Promise<Readonly<Record<string, string>>>;
}

interface PreparedTransport {
  readonly environmentId: EnvironmentId;
  readonly expiresAt: number;
  active: DesktopWorkspaceRelaySocket | null;
}

function opaqueTransportId(): string {
  return Crypto.randomBytes(24).toString("base64url");
}

function bytesFromRawData(data: RawData): Uint8Array | null {
  if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0));
  if (Array.isArray(data)) {
    const total = data.reduce((sum, part) => sum + part.byteLength, 0);
    if (total > MAX_APPLICATION_FRAME_BYTES) return null;
    const combined = new Uint8Array(total);
    let offset = 0;
    for (const part of data) {
      combined.set(part, offset);
      offset += part.byteLength;
    }
    return combined;
  }
  const view = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return view.byteLength <= MAX_APPLICATION_FRAME_BYTES ? Uint8Array.from(view) : null;
}

function nativeAttempt(input: {
  readonly target: DesktopWorkspaceRelayTarget;
  readonly preparation: Extract<DesktopNativeE2eePreparation, { readonly kind: "native" }>;
  readonly handshake: DesktopNativeE2eeHandshakeService;
}): RelayE2eeInitiatorAttempt {
  return {
    hubOrigin: new URL(input.target.relayUrl).origin.replace(/^ws/u, "http"),
    selectionClass: "latched",
    legacyPermitted: false,
    pairingOnly: false,
    localSuitePreference: [E2EE_SUITE_25519_CHACHAPOLY_SHA256],
    credentials: input.preparation.credentials,
    verifiedPin: input.preparation.verifiedPin,
    accountId: input.target.accountId,
    acceptedPolicyGeneration: input.preparation.acceptedPolicyGeneration,
    nativeHandshake: {
      start: (startInput) => input.handshake.start(input.preparation.attemptHandle, startInput),
      finish: (handle, payload) => Promise.resolve(input.handshake.finish(handle, payload)),
      destroy: (handle) => input.handshake.destroy(handle),
    },
  };
}

class DesktopWorkspaceRelaySocket {
  readonly #socket: WebSocket;
  readonly #engine: HostedRelayEngine;

  constructor(input: {
    readonly target: DesktopWorkspaceRelayTarget;
    readonly ticket: string;
    readonly ticketExpiresAt: number;
    readonly headers: Readonly<Record<string, string>>;
    readonly e2ee: RelayE2eeProvider;
    readonly callbacks: HostedRelaySocketCallbacks;
    readonly events: {
      readonly open: () => void;
      readonly message: (bytes: Uint8Array) => void;
      readonly error: () => void;
      readonly close: (code: number, reason: string) => void;
    };
  }) {
    const socket = new WebSocket(input.target.relayUrl, { headers: input.headers });
    socket.binaryType = "arraybuffer";
    this.#socket = socket;
    const openListeners: Array<() => void> = [];
    const messageListeners: Array<(bytes: Uint8Array) => void> = [];
    const closeListeners: Array<() => void> = [];
    const errorListeners: Array<() => void> = [];
    const relaySocket: RelaySocket = {
      get bufferedAmount() {
        return socket.bufferedAmount;
      },
      get readyState() {
        return socket.readyState;
      },
      send: (bytes) => socket.send(Buffer.from(bytes)),
      close: (code, reason) => socket.close(code, reason),
      onOpen: (listener) => openListeners.push(listener),
      onBinaryMessage: (listener) => messageListeners.push(listener),
      onClose: (listener) => closeListeners.push(listener),
      onError: (listener) => errorListeners.push(listener),
    };
    this.#engine = new HostedRelayEngine({
      ticket: input.ticket,
      ticketExpiresAt: input.ticketExpiresAt,
      socket: relaySocket,
      callbacks: input.callbacks,
      e2ee: input.e2ee,
      timers: {
        now: Date.now,
        setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
        clearTimeout: (id) => globalThis.clearTimeout(id as ReturnType<typeof setTimeout>),
        queueMicrotask: (callback) => globalThis.queueMicrotask(callback),
      },
      events: {
        onOpen: input.events.open,
        onData: input.events.message,
        onError: input.events.error,
        onClose: input.events.close,
      },
    });
    socket.on("open", () => {
      for (const listener of openListeners) listener();
    });
    socket.on("message", (data, isBinary) => {
      const bytes = isBinary ? bytesFromRawData(data) : null;
      if (bytes === null) {
        this.#engine.reportUndecodableMessage("frame_too_large");
        return;
      }
      for (const listener of messageListeners) listener(bytes);
    });
    socket.on("close", () => {
      for (const listener of closeListeners) listener();
    });
    socket.on("error", () => {
      for (const listener of errorListeners) listener();
    });
  }

  send(bytes: Uint8Array): void {
    if (bytes.byteLength > MAX_APPLICATION_FRAME_BYTES) {
      throw new Error("Desktop workspace RPC frame is too large.");
    }
    this.#engine.send(Uint8Array.from(bytes));
  }

  close(): void {
    this.#engine.close(1000, "");
  }
}

/** Main-process owner for authenticated, E2EE relay sockets addressed by opaque handles. */
export class DesktopWorkspaceRelayManager {
  readonly #authority: DesktopWorkspaceRelayAuthority;
  readonly #emit: (event: DesktopWorkspaceTransportEvent) => void;
  readonly #now: () => number;
  readonly #transports = new Map<string, PreparedTransport>();

  constructor(input: {
    readonly authority: DesktopWorkspaceRelayAuthority;
    readonly emit: (event: DesktopWorkspaceTransportEvent) => void;
    readonly now?: () => number;
  }) {
    this.#authority = input.authority;
    this.#emit = input.emit;
    this.#now = input.now ?? Date.now;
  }

  prepare(environmentId: EnvironmentId): string {
    this.#prune();
    if (this.#transports.size >= MAX_TRANSPORTS) {
      throw new Error("Desktop workspace transport capacity is unavailable.");
    }
    const transportId = opaqueTransportId();
    this.#transports.set(transportId, {
      environmentId,
      expiresAt: this.#now() + PREPARED_LIFETIME_MS,
      active: null,
    });
    return transportId;
  }

  async activate(transportId: string): Promise<void> {
    this.#prune();
    const prepared = this.#transports.get(transportId);
    if (!prepared || prepared.active !== null || prepared.expiresAt <= this.#now()) {
      throw new Error("Desktop workspace transport is unavailable.");
    }
    try {
      const target = await this.#authority.resolveTarget(prepared.environmentId);
      if (!target || target.environmentId !== prepared.environmentId) {
        throw new Error("Desktop workspace target is unavailable.");
      }
      const [preparation, ticket, headers, handshake] = await Promise.all([
        this.#authority.prepareE2ee(target),
        this.#authority.issueTicket(target),
        this.#authority.authorizeUpgrade(target),
        this.#authority.handshake(),
      ]);
      if (preparation.kind !== "native") {
        throw new Error("Desktop workspace target is not natively verified.");
      }
      const attempt = nativeAttempt({ target, preparation, handshake });
      const active = new DesktopWorkspaceRelaySocket({
        target,
        ticket: ticket.ticket,
        ticketExpiresAt: ticket.expiresAt,
        headers,
        e2ee: (host) => makeRelayE2eeInitiator({ host, attempt }),
        callbacks: {
          onTransportStatus: () => undefined,
          onSessionStatus: () => undefined,
          onRole: () => undefined,
          onFailure: () => undefined,
        },
        events: {
          open: () => this.#emit({ type: "open", transportId }),
          message: (data) => this.#emit({ type: "message", transportId, data }),
          error: () => this.#emit({ type: "error", transportId }),
          close: (code, reason) => {
            this.#transports.delete(transportId);
            this.#emit({ type: "close", transportId, code, reason });
          },
        },
      });
      prepared.active = active;
    } catch {
      this.#transports.delete(transportId);
      this.#emit({ type: "error", transportId });
      this.#emit({ type: "close", transportId, code: 4401, reason: "Relay unavailable" });
      throw new Error("Desktop workspace relay activation failed.");
    }
  }

  send(transportId: string, bytes: Uint8Array): void {
    const transport = this.#transports.get(transportId)?.active;
    if (!transport) throw new Error("Desktop workspace transport is unavailable.");
    transport.send(bytes);
  }

  close(transportId: string): void {
    const prepared = this.#transports.get(transportId);
    this.#transports.delete(transportId);
    prepared?.active?.close();
  }

  dispose(): void {
    for (const transport of this.#transports.values()) transport.active?.close();
    this.#transports.clear();
  }

  #prune(): void {
    const now = this.#now();
    for (const [transportId, transport] of this.#transports) {
      if (transport.active === null && transport.expiresAt <= now) {
        this.#transports.delete(transportId);
      }
    }
  }
}

export const DESKTOP_WORKSPACE_MAX_RPC_FRAME_BYTES = MAX_APPLICATION_FRAME_BYTES;
