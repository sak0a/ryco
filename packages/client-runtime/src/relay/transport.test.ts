import { EnvironmentId, ORCHESTRATION_WS_METHODS, WS_METHODS } from "@ryco/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type {
  EndpointService,
  HttpClientService,
  PasskeyCeremonyService,
  SessionCredentialsService,
} from "@ryco/client-runtime/platform";

import { HostedHubApi, HostedHubApiError } from "../authorization/api";
import {
  configureHostedRuntime,
  type HostedNodeLifecycle,
  type HostedRuntimeConfiguration,
} from "../authorization/runtime";
import { hostedHubController, hostedHubStore } from "../authorization/state";
import type { HostedHubNode, HostedRelayFailure } from "../authorization/types";
import { encodeBase64Url } from "./base64url";
import {
  HostedRelayAttemptFactory,
  ticketFailure,
  type HostedRelayAttemptBinding,
} from "./transport";

const RELAY_URL = "wss://hub.example.test/v1/relay/client";

/** Callbacks the attempt factory hands to `createRelaySocket`. */
interface RelaySocketCallbacks {
  onTransportStatus(status: string): void;
  onSessionStatus(status: string): void;
  onRole(role: string | null): void;
  onFailure(failure: HostedRelayFailure): void;
}

/**
 * Fake relay socket. The real socket (the package relay engine) publishes
 * "connecting" as soon as it is constructed and surfaces a lost connection via
 * `onFailure`; the fake reproduces exactly those two callback edges so the
 * attempt factory's state wiring can be exercised without a browser WebSocket.
 */
class MockRelaySocket {
  constructor(readonly callbacks: RelaySocketCallbacks) {
    callbacks.onTransportStatus("connecting");
  }
  fail(): void {
    this.callbacks.onFailure({ kind: "network", retryable: true });
  }
}

const sockets: MockRelaySocket[] = [];

/** A configurable Hub API instance the factory reads via the runtime. */
const hostedHubApi = {
  issueRelayTicket: vi.fn(),
  clearSessionMaterial: vi.fn(),
} as unknown as HostedHubApi;

const nodeLifecycle: HostedNodeLifecycle = {
  activate: vi.fn(async () => undefined),
  suspend: vi.fn(async () => undefined),
  deactivate: vi.fn(async () => undefined),
  clearNodeScopedState: vi.fn(),
  writePrimaryEnvironmentDescriptor: vi.fn(),
  connectPrimaryEnvironment: vi.fn(),
  disconnectPrimaryEnvironment: vi.fn(async () => undefined),
  setActiveEnvironmentId: vi.fn(),
};

const unusedService = new Proxy(
  {},
  {
    get() {
      throw new Error("platform service is not used by the relay attempt factory tests");
    },
  },
);

function fakeRuntime(): HostedRuntimeConfiguration {
  return {
    endpoint: unusedService as EndpointService,
    httpClient: unusedService as HttpClientService,
    passkeyCeremony: unusedService as PasskeyCeremonyService,
    sessionCredentials: unusedService as SessionCredentialsService,
    nodeLifecycle,
    timers: {
      now: () => Date.now(),
      setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
      clearTimeout: (timer) => globalThis.clearTimeout(timer),
      queueMicrotask: (callback) => globalThis.queueMicrotask(callback),
    },
    isForeground: () => true,
    subscribeForeground: () => () => undefined,
    hasPendingRelayRequests: () => false,
    resetRelayAttemptFactory: vi.fn(),
    relayUrl: () => RELAY_URL,
    createRelaySocket: (input) => {
      const socket = new MockRelaySocket(input.callbacks as RelaySocketCallbacks);
      sockets.push(socket);
      return socket;
    },
  };
}

const selectedNode: HostedHubNode = {
  id: "node_aaaaaaaaaaaaaaaaaaaaaa",
  environmentId: EnvironmentId.make("env_aaaaaaaaaaaaaaaaaaaaaa"),
  label: "Node",
  platformOs: "linux",
  platformArch: "x64",
  clientVersion: "0.9.0",
  createdAt: 1,
  updatedAt: 1,
  lastAuthenticatedAt: 1,
  revokedAt: null,
  revocationReasonCode: null,
  grant: { id: "grant_aaaaaaaaaaaaaaaaaaaaaa", role: "operator" },
  effectiveRole: "operator",
  presence: { online: true, lastHeartbeatAt: 1 },
};

beforeEach(() => {
  vi.clearAllMocks();
  sockets.length = 0;
  configureHostedRuntime(fakeRuntime(), hostedHubApi);
  hostedHubStore.setState({
    accountStatus: "authenticated",
    selectedNode,
    generation: 4,
    directoryStatus: "ready",
    effectiveRole: selectedNode.effectiveRole,
    transportStatus: "idle",
  });
});

afterEach(() => {
  hostedHubController.resetForTests();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("HostedRelayAttemptFactory", () => {
  it("holds native grant context for one socket and disposes abandoned attempts", async () => {
    let current = true;
    let sequence = 0;
    const disposed: unknown[] = [];
    const created: unknown[] = [];
    const binding: HostedRelayAttemptBinding = {
      nodeId: () => selectedNode.id,
      generation: () => 4,
      isAuthenticated: () => true,
      isCurrent: () => current,
      prepareSocketContext: async () => ({ publicMaterial: ++sequence }),
      issueRelayAttempt: async ({ preparedSocketContext }) => ({
        ticket: encodeBase64Url(new Uint8Array(32).fill(sequence)),
        expiresAt: Date.now() + 60_000,
        preparedSocketContext: {
          preparedSocketContext,
          transientGrant: `grant-canary-${sequence}`,
        },
      }),
      disposeSocketContext: (context) => disposed.push(context),
      relayUrl: () => RELAY_URL,
      createRelaySocket: (input) => {
        created.push(input.preparedSocketContext);
        return new MockRelaySocket(input.callbacks as RelaySocketCallbacks);
      },
      authorizeRequest: () => true,
      shouldReconnect: () => true,
      transportStatus: () => undefined,
      sessionStatus: () => undefined,
      role: () => undefined,
      failure: () => undefined,
      markDeliveryUnknown: () => undefined,
      connectionClosed: () => undefined,
    };
    const factory = new HostedRelayAttemptFactory(binding);

    await factory.nextUrl();
    await factory.nextUrl();
    expect(disposed).toEqual([
      {
        preparedSocketContext: { publicMaterial: 1 },
        transientGrant: "grant-canary-1",
      },
    ]);
    factory.createSocket(RELAY_URL);
    expect(created).toEqual([
      {
        preparedSocketContext: { publicMaterial: 2 },
        transientGrant: "grant-canary-2",
      },
    ]);
    expect(disposed).toHaveLength(1);

    current = false;
    await expect(factory.nextUrl()).rejects.toThrow("Hosted node selection changed.");
    expect(disposed).toHaveLength(2);
    expect(disposed[1]).toEqual({ publicMaterial: 3 });
  });

  it.each([
    ["node_offline", "offline", true],
    ["server_draining", "draining", true],
    ["rate_limited", "rate-limited", true],
    ["unsupported_version", "incompatible", false],
    ["forbidden", "authorization-removed", false],
    ["revoked", "revoked", false],
  ] as const)("classifies ticket HTTP failure %s", (code, kind, retryable) => {
    expect(ticketFailure(new HostedHubApiError(code, 400, 1_500))).toMatchObject({
      kind,
      retryable,
      ...(retryable ? { retryAfterMs: 1_500 } : {}),
    });
  });

  it("treats an unclassified ticket transport failure as retryable network loss", () => {
    expect(ticketFailure(new HostedHubApiError("unavailable", 0))).toEqual({
      kind: "network",
      retryable: true,
    });
  });

  it("authorizes only bootstrap subscriptions while the hosted session opens", () => {
    const lifecycle = new HostedRelayAttemptFactory().lifecycleHandlers();

    expect(
      lifecycle.authorizeRequest?.({
        tag: ORCHESTRATION_WS_METHODS.subscribeShell,
        stream: true,
      }),
    ).toBe(true);
    expect(
      lifecycle.authorizeRequest?.({
        tag: WS_METHODS.subscribeTerminalEvents,
        stream: true,
      }),
    ).toBe(true);
    expect(
      lifecycle.authorizeRequest?.({
        tag: ORCHESTRATION_WS_METHODS.dispatchCommand,
        stream: false,
      }),
    ).toBe(false);
    expect(
      lifecycle.authorizeRequest?.({
        tag: WS_METHODS.gitRunStackedAction,
        stream: true,
      }),
    ).toBe(false);

    hostedHubStore.setState({ directoryStatus: "stale" });
    expect(
      lifecycle.authorizeRequest?.({
        tag: ORCHESTRATION_WS_METHODS.subscribeShell,
        stream: true,
      }),
    ).toBe(false);
  });

  it("retains only session-sync authority across a retryable socket close", async () => {
    vi.spyOn(hostedHubApi, "issueRelayTicket").mockResolvedValue({
      ticket: encodeBase64Url(new Uint8Array(32).fill(5)),
      expiresAt: Date.now() + 60_000,
      protocolMajor: 1,
      protocolMinor: 2,
    });
    const factory = new HostedRelayAttemptFactory();
    const lifecycle = factory.lifecycleHandlers();
    const subscribeShell = {
      tag: ORCHESTRATION_WS_METHODS.subscribeShell,
      stream: true,
    } as const;
    const dispatch = {
      tag: ORCHESTRATION_WS_METHODS.dispatchCommand,
      stream: false,
    } as const;
    factory.createSocket(await factory.nextUrl());
    hostedHubStore.setState({
      transportStatus: "online",
      sessionStatus: "ready",
      browserStatus: "current",
    });

    lifecycle.onClose?.({ code: 4000, reason: "network" }, { intentional: false });

    expect(hostedHubStore.getState()).toMatchObject({
      effectiveRole: "operator",
      transportStatus: "reconnecting",
      sessionStatus: "stale",
    });
    expect(lifecycle.authorizeRequest?.(subscribeShell)).toBe(true);
    expect(lifecycle.authorizeRequest?.(dispatch)).toBe(false);
  });

  it("re-enters the selected-node lifecycle only after the relay channel recovers", async () => {
    vi.spyOn(hostedHubApi, "issueRelayTicket").mockResolvedValue({
      ticket: encodeBase64Url(new Uint8Array(32).fill(10)),
      expiresAt: Date.now() + 60_000,
      protocolMajor: 1,
      protocolMinor: 2,
    });
    const retrySelectedNode = vi
      .spyOn(hostedHubController, "retrySelectedNode")
      .mockResolvedValue(undefined);
    hostedHubStore.setState({
      nodes: [selectedNode],
      browserStatus: "current",
      sessionStatus: "ready",
      transportStatus: "online",
    });
    const factory = new HostedRelayAttemptFactory();
    const lifecycle = factory.lifecycleHandlers();
    factory.createSocket(await factory.nextUrl());

    lifecycle.onClose?.({ code: 4000, reason: "network" }, { intentional: false });
    expect(retrySelectedNode).not.toHaveBeenCalled();

    factory.createSocket(await factory.nextUrl());
    sockets.at(-1)?.callbacks.onTransportStatus("online");
    await vi.waitFor(() => expect(retrySelectedNode).toHaveBeenCalledOnce());
  });

  it("does not rebuild the rpc client for the initial relay connection", async () => {
    vi.spyOn(hostedHubApi, "issueRelayTicket").mockResolvedValue({
      ticket: encodeBase64Url(new Uint8Array(32).fill(11)),
      expiresAt: Date.now() + 60_000,
      protocolMajor: 1,
      protocolMinor: 2,
    });
    const retrySelectedNode = vi
      .spyOn(hostedHubController, "retrySelectedNode")
      .mockResolvedValue(undefined);
    const factory = new HostedRelayAttemptFactory();

    factory.createSocket(await factory.nextUrl());
    sockets.at(-1)?.callbacks.onTransportStatus("online");

    expect(retrySelectedNode).not.toHaveBeenCalled();
  });

  it("denies RPCs at the transport boundary until browser recovery is complete", () => {
    const lifecycle = new HostedRelayAttemptFactory().lifecycleHandlers();
    const dispatch = {
      tag: ORCHESTRATION_WS_METHODS.dispatchCommand,
      stream: false,
    } as const;
    const subscribeShell = {
      tag: ORCHESTRATION_WS_METHODS.subscribeShell,
      stream: true,
    } as const;
    hostedHubStore.setState({
      transportStatus: "online",
      sessionStatus: "ready",
      browserStatus: "current",
    });

    expect(lifecycle.authorizeRequest?.(dispatch)).toBe(true);
    hostedHubController.suspendBrowser("hidden");
    expect(hostedHubStore.getState()).toMatchObject({
      directoryStatus: "ready",
      effectiveRole: "operator",
      browserStatus: "suspended",
      sessionStatus: "stale",
    });
    expect(lifecycle.authorizeRequest?.(dispatch)).toBe(false);
    expect(lifecycle.authorizeRequest?.(subscribeShell)).toBe(false);

    hostedHubStore.setState({
      browserStatus: "synchronizing",
      sessionStatus: "stale",
    });
    expect(lifecycle.authorizeRequest?.(dispatch)).toBe(false);
    expect(lifecycle.authorizeRequest?.(subscribeShell)).toBe(true);

    hostedHubStore.setState({ browserStatus: "current", sessionStatus: "ready" });
    expect(lifecycle.authorizeRequest?.(dispatch)).toBe(true);
  });

  it("requests and consumes one memory-only ticket per connection attempt", async () => {
    const ticket = encodeBase64Url(new Uint8Array(32).fill(9));
    const issue = vi.spyOn(hostedHubApi, "issueRelayTicket").mockResolvedValue({
      ticket,
      expiresAt: Date.now() + 60_000,
      protocolMajor: 1,
      protocolMinor: 2,
    });
    const factory = new HostedRelayAttemptFactory();
    const firstUrl = await factory.nextUrl();
    expect(firstUrl).toBe(RELAY_URL);
    factory.createSocket(firstUrl);
    expect(() => factory.createSocket(firstUrl)).toThrow("fresh relay ticket");

    const secondUrl = await factory.nextUrl();
    factory.createSocket(secondUrl);
    expect(issue).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(hostedHubStore.getState())).not.toContain(ticket);
  });

  it("retries transient ticket preflight with fresh attempt material", async () => {
    const ticket = encodeBase64Url(new Uint8Array(32).fill(7));
    const issue = vi
      .spyOn(hostedHubApi, "issueRelayTicket")
      .mockRejectedValueOnce(new HostedHubApiError("server_draining", 503, 0))
      .mockResolvedValue({
        ticket,
        expiresAt: Date.now() + 60_000,
        protocolMajor: 1,
        protocolMinor: 2,
      });
    const factory = new HostedRelayAttemptFactory();

    await expect(factory.nextUrl()).rejects.toBeInstanceOf(HostedHubApiError);
    expect(hostedHubStore.getState().transportStatus).toBe("reconnecting");

    const url = await factory.nextUrl();
    factory.createSocket(url);

    expect(issue).toHaveBeenCalledTimes(2);
    expect(sockets).toHaveLength(1);
    expect(hostedHubStore.getState().transportStatus).toBe("connecting");
    expect(JSON.stringify(hostedHubStore.getState())).not.toContain(ticket);
  });

  it("stops automatic relay reconnects while the browser is suspended", async () => {
    vi.spyOn(hostedHubApi, "issueRelayTicket").mockResolvedValue({
      ticket: encodeBase64Url(new Uint8Array(32).fill(8)),
      expiresAt: Date.now() + 60_000,
      protocolMajor: 1,
      protocolMinor: 2,
    });
    const factory = new HostedRelayAttemptFactory();
    const lifecycle = factory.lifecycleHandlers();
    await factory.nextUrl();

    expect(lifecycle.shouldReconnect?.()).toBe(true);
    hostedHubController.suspendBrowser("hidden");
    expect(lifecycle.shouldReconnect?.()).toBe(false);

    hostedHubStore.setState({ browserStatus: "checking-access" });
    expect(lifecycle.shouldReconnect?.()).toBe(false);
    hostedHubStore.setState({ browserStatus: "synchronizing" });
    expect(lifecycle.shouldReconnect?.()).toBe(false);

    await factory.nextUrl();
    expect(lifecycle.shouldReconnect?.()).toBe(true);
  });

  it("stops terminal ticket preflight without opening a socket", async () => {
    const issue = vi
      .spyOn(hostedHubApi, "issueRelayTicket")
      .mockRejectedValue(new HostedHubApiError("forbidden", 403));
    const factory = new HostedRelayAttemptFactory();

    await expect(factory.nextUrl()).rejects.toBeInstanceOf(HostedHubApiError);

    expect(issue).toHaveBeenCalledOnce();
    expect(hostedHubStore.getState().transportStatus).toBe("terminal-failure");
    expect(sockets).toHaveLength(0);
  });

  it("rejects expired tickets before opening a relay socket", async () => {
    vi.spyOn(hostedHubApi, "issueRelayTicket").mockResolvedValue({
      ticket: encodeBase64Url(new Uint8Array(32).fill(2)),
      expiresAt: Date.now() - 1,
      protocolMajor: 1,
      protocolMinor: 2,
    });
    const factory = new HostedRelayAttemptFactory();
    const url = await factory.nextUrl();
    expect(() => factory.createSocket(url)).toThrow("fresh relay ticket");
    expect(sockets).toHaveLength(0);
  });

  it("marks any unacknowledged request delivery unknown without replaying it", async () => {
    vi.spyOn(hostedHubApi, "issueRelayTicket").mockResolvedValue({
      ticket: encodeBase64Url(new Uint8Array(32).fill(3)),
      expiresAt: Date.now() + 60_000,
      protocolMajor: 1,
      protocolMinor: 2,
    });
    const factory = new HostedRelayAttemptFactory();
    const lifecycle = factory.lifecycleHandlers();
    const url = await factory.nextUrl();
    factory.createSocket(url);
    lifecycle.onRequestStart?.({
      id: "mutation-1",
      tag: ORCHESTRATION_WS_METHODS.dispatchCommand,
      stream: false,
    });
    expect(factory.hasPendingRequests()).toBe(true);
    lifecycle.onRequestStart?.({ id: "read-1", tag: WS_METHODS.projectsList, stream: false });
    lifecycle.onRequestExit?.({ id: "read-1", tag: WS_METHODS.projectsList, stream: false });
    sockets[0]!.fail();
    expect(hostedHubStore.getState()).toMatchObject({
      transportStatus: "reconnecting",
      sessionStatus: "delivery-unknown",
    });
    expect(factory.hasPendingRequests()).toBe(false);
  });

  it("preserves streaming mutation uncertainty through progress until final exit", async () => {
    vi.spyOn(hostedHubApi, "issueRelayTicket").mockResolvedValue({
      ticket: encodeBase64Url(new Uint8Array(32).fill(4)),
      expiresAt: Date.now() + 60_000,
      protocolMajor: 1,
      protocolMinor: 2,
    });
    const factory = new HostedRelayAttemptFactory();
    const lifecycle = factory.lifecycleHandlers();
    factory.createSocket(await factory.nextUrl());

    lifecycle.onRequestStart?.({
      id: "subscription-1",
      tag: ORCHESTRATION_WS_METHODS.subscribeShell,
      stream: true,
    });
    expect(factory.hasPendingRequests()).toBe(false);

    lifecycle.onRequestStart?.({
      id: "stacked-action-1",
      tag: WS_METHODS.gitRunStackedAction,
      stream: true,
    });
    lifecycle.onRequestChunk?.({
      id: "stacked-action-1",
      tag: WS_METHODS.gitRunStackedAction,
      chunkCount: 1,
    });
    expect(factory.hasPendingRequests()).toBe(true);

    sockets[0]!.fail();
    expect(hostedHubStore.getState()).toMatchObject({
      transportStatus: "reconnecting",
      sessionStatus: "delivery-unknown",
    });
    expect(factory.hasPendingRequests()).toBe(false);
  });

  it("clears streaming mutation uncertainty after final exit", () => {
    const factory = new HostedRelayAttemptFactory();
    const lifecycle = factory.lifecycleHandlers();

    lifecycle.onRequestStart?.({
      id: "stacked-action-1",
      tag: WS_METHODS.gitRunStackedAction,
      stream: true,
    });
    expect(factory.hasPendingRequests()).toBe(true);

    lifecycle.onRequestExit?.({
      id: "stacked-action-1",
      tag: WS_METHODS.gitRunStackedAction,
      stream: true,
    });
    expect(factory.hasPendingRequests()).toBe(false);
  });

  it("keeps generic retry delays state-neutral", async () => {
    vi.spyOn(hostedHubApi, "issueRelayTicket").mockResolvedValue({
      ticket: encodeBase64Url(new Uint8Array(32).fill(6)),
      expiresAt: Date.now() + 60_000,
      protocolMajor: 1,
      protocolMinor: 2,
    });
    const factory = new HostedRelayAttemptFactory();
    const lifecycle = factory.lifecycleHandlers();
    factory.createSocket(await factory.nextUrl());
    hostedHubStore.setState({ transportStatus: "online" });
    const transportStatus = vi.spyOn(hostedHubController, "transportStatus");

    expect(lifecycle.getReconnectDelayMs?.(0)).toBeGreaterThan(0);
    expect(hostedHubStore.getState().transportStatus).toBe("online");
    expect(transportStatus).not.toHaveBeenCalled();

    factory.reset();
    lifecycle.getReconnectDelayMs?.(1);
    expect(transportStatus).not.toHaveBeenCalled();
  });

  it("transitions on an actual close and ignores delayed close callbacks after reset", async () => {
    vi.spyOn(hostedHubApi, "issueRelayTicket").mockResolvedValue({
      ticket: encodeBase64Url(new Uint8Array(32).fill(6)),
      expiresAt: Date.now() + 60_000,
      protocolMajor: 1,
      protocolMinor: 2,
    });
    const factory = new HostedRelayAttemptFactory();
    const lifecycle = factory.lifecycleHandlers();
    factory.createSocket(await factory.nextUrl());
    hostedHubStore.setState({ transportStatus: "online" });

    lifecycle.onClose?.({ code: 1006, reason: "network" }, { intentional: false });
    expect(hostedHubStore.getState().transportStatus).toBe("reconnecting");

    factory.reset();
    hostedHubStore.setState({ transportStatus: "online" });
    lifecycle.onClose?.({ code: 1006, reason: "network" }, { intentional: false });
    expect(hostedHubStore.getState().transportStatus).toBe("online");
  });

  it("ignores callbacks from a superseded socket attempt in the same selection generation", async () => {
    vi.spyOn(hostedHubApi, "issueRelayTicket").mockResolvedValue({
      ticket: encodeBase64Url(new Uint8Array(32).fill(6)),
      expiresAt: Date.now() + 60_000,
      protocolMajor: 1,
      protocolMinor: 2,
    });
    const factory = new HostedRelayAttemptFactory();
    const lifecycle = factory.lifecycleHandlers();
    const first = factory.createSocket(await factory.nextUrl()) as MockRelaySocket;
    const second = factory.createSocket(await factory.nextUrl()) as MockRelaySocket;

    second.callbacks.onRole("operator");
    second.callbacks.onSessionStatus("ready");
    second.callbacks.onTransportStatus("online");
    expect(lifecycle.isSocketCurrent?.(first as unknown as WebSocket)).toBe(false);
    expect(lifecycle.isSocketCurrent?.(second as unknown as WebSocket)).toBe(true);

    first.callbacks.onRole(null);
    first.callbacks.onSessionStatus("stale");
    first.callbacks.onTransportStatus("reconnecting");
    first.fail();

    expect(hostedHubStore.getState()).toMatchObject({
      effectiveRole: "operator",
      sessionStatus: "ready",
      transportStatus: "online",
    });
  });
});
