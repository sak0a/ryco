import { EnvironmentId, ORCHESTRATION_WS_METHODS, WS_METHODS } from "@ryco/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

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

beforeEach(() => {
  sockets.length = 0;
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
  });
});

afterEach(() => {
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

  it("keeps delayed lifecycle callbacks scoped to their socket generation", async () => {
    vi.spyOn(hostedHubApi, "issueRelayTicket").mockResolvedValue({
      ticket: encodeBase64Url(new Uint8Array(32).fill(6)),
      expiresAt: Date.now() + 60_000,
      protocolMajor: 1,
      protocolMinor: 2,
    });
    const factory = new HostedRelayAttemptFactory();
    const lifecycle = factory.lifecycleHandlers();
    factory.createSocket(await factory.nextUrl());
    const transportStatus = vi.spyOn(hostedHubController, "transportStatus");
    const connectionClosed = vi.spyOn(hostedHubController, "connectionClosed");

    useHostedHubStore.setState({ generation: 5 });
    lifecycle.getReconnectDelayMs?.(0);
    lifecycle.onClose?.({ code: 1006, reason: "network" }, { intentional: false });

    expect(transportStatus).toHaveBeenCalledWith(4, "reconnecting");
    expect(connectionClosed).toHaveBeenCalledWith(4);
    factory.reset();
    lifecycle.getReconnectDelayMs?.(1);
    lifecycle.onClose?.({ code: 1006, reason: "network" }, { intentional: false });
    expect(connectionClosed).toHaveBeenCalledTimes(1);
  });
});
