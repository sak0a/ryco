import { EnvironmentId, ORCHESTRATION_WS_METHODS, WS_METHODS } from "@ryco/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { WsTransport } from "../rpc/wsTransport";
import { hostedHubApi, HostedHubApiError } from "./api";
import { encodeBase64Url } from "./base64url";
import { hostedHubController, useHostedHubStore } from "./state";
import { HostedRelayAttemptFactory, ticketFailure } from "./transport";
import type { HostedHubNode } from "./types";

class MockSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readyState = MockSocket.CONNECTING;
  bufferedAmount = 0;
  binaryType: BinaryType = "blob";
  send() {}
  close() {
    this.readyState = MockSocket.CLOSED;
  }
  fail() {
    this.dispatchEvent(new Event("error"));
    this.dispatchEvent(new CloseEvent("close", { code: 1006 }));
  }
}

const sockets: MockSocket[] = [];
const transports: WsTransport[] = [];

const originalWindow = globalThis.window;
const originalWebSocket = globalThis.WebSocket;
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

async function waitFor(assertion: () => void, timeoutMs = 1_000): Promise<void> {
  const startedAt = Date.now();
  for (;;) {
    try {
      assertion();
      return;
    } catch (error) {
      if (Date.now() - startedAt >= timeoutMs) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}

beforeEach(() => {
  sockets.length = 0;
  transports.length = 0;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { origin: "https://hub.example.test" } },
  });
  globalThis.WebSocket = class extends MockSocket {
    constructor() {
      super();
      sockets.push(this);
    }
  } as unknown as typeof WebSocket;
  useHostedHubStore.setState({
    accountStatus: "authenticated",
    selectedNode,
    generation: 4,
    directoryStatus: "ready",
    effectiveRole: selectedNode.effectiveRole,
    transportStatus: "idle",
  });
});

afterEach(async () => {
  await Promise.allSettled(transports.map((transport) => transport.dispose()));
  transports.length = 0;
  hostedHubController.resetForTests();
  Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  globalThis.WebSocket = originalWebSocket;
  vi.restoreAllMocks();
});

describe("HostedRelayAttemptFactory", () => {
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

  it("authorizes bootstrap subscriptions from a fresh directory role before socket open", () => {
    const lifecycle = new HostedRelayAttemptFactory().lifecycleHandlers();

    expect(
      lifecycle.authorizeRequest?.({
        tag: ORCHESTRATION_WS_METHODS.subscribeShell,
        stream: true,
      }),
    ).toBe(true);

    useHostedHubStore.setState({ directoryStatus: "stale" });
    expect(
      lifecycle.authorizeRequest?.({
        tag: ORCHESTRATION_WS_METHODS.subscribeShell,
        stream: true,
      }),
    ).toBe(false);
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
    expect(firstUrl).toBe("wss://hub.example.test/v1/relay/client");
    factory.createSocket(firstUrl);
    expect(() => factory.createSocket(firstUrl)).toThrow("fresh relay ticket");

    const secondUrl = await factory.nextUrl();
    factory.createSocket(secondUrl);
    expect(issue).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(useHostedHubStore.getState())).not.toContain(ticket);
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
    const transport = new WsTransport(() => factory.nextUrl(), {
      ...factory.lifecycleHandlers(),
      getReconnectDelayMs: () => 0,
    });
    transports.push(transport);

    await waitFor(() => {
      expect(issue).toHaveBeenCalledTimes(2);
      expect(sockets).toHaveLength(1);
    });

    expect(useHostedHubStore.getState().transportStatus).toBe("connecting");
    expect(JSON.stringify(useHostedHubStore.getState())).not.toContain(ticket);
  });

  it("stops terminal ticket preflight without opening a socket", async () => {
    const issue = vi
      .spyOn(hostedHubApi, "issueRelayTicket")
      .mockRejectedValue(new HostedHubApiError("forbidden", 403));
    const factory = new HostedRelayAttemptFactory();
    const transport = new WsTransport(() => factory.nextUrl(), {
      ...factory.lifecycleHandlers(),
      getReconnectDelayMs: () => 0,
    });
    transports.push(transport);

    await waitFor(() => {
      expect(issue).toHaveBeenCalledOnce();
      expect(useHostedHubStore.getState().transportStatus).toBe("terminal-failure");
    });
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(issue).toHaveBeenCalledOnce();
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
    lifecycle.onRequestStart?.({ id: "read-1", tag: WS_METHODS.projectsList, stream: false });
    lifecycle.onRequestExit?.({ id: "read-1", tag: WS_METHODS.projectsList, stream: false });
    sockets[0]!.fail();
    expect(useHostedHubStore.getState()).toMatchObject({
      transportStatus: "reconnecting",
      sessionStatus: "delivery-unknown",
    });
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
    useHostedHubStore.setState({ transportStatus: "online" });
    const transportStatus = vi.spyOn(hostedHubController, "transportStatus");

    expect(lifecycle.getReconnectDelayMs?.(0)).toBeGreaterThan(0);
    expect(useHostedHubStore.getState().transportStatus).toBe("online");
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
    useHostedHubStore.setState({ transportStatus: "online" });

    lifecycle.onClose?.({ code: 1006, reason: "network" }, { intentional: false });
    expect(useHostedHubStore.getState().transportStatus).toBe("reconnecting");

    factory.reset();
    useHostedHubStore.setState({ transportStatus: "online" });
    lifecycle.onClose?.({ code: 1006, reason: "network" }, { intentional: false });
    expect(useHostedHubStore.getState().transportStatus).toBe("online");
  });
});
