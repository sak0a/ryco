import { EnvironmentId } from "@ryco/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type {
  EndpointService,
  HttpClientService,
  PasskeyCeremonyService,
  SessionCredentialsService,
} from "@ryco/client-runtime/platform";

import type { HostedHubNode, HostedHubSessionResponse } from "./types";

const originalDocument = globalThis.document;

// The lifecycle transition queue is injected as fakes: state.ts imports these
// directly, and mocking the module is how the controller's lifecycle
// dependency is stubbed. The relay-attempt reset is owned solely by the
// transition queue (see environment.test.ts for the ordered-teardown contract);
// the deactivate fake below mirrors that contract — deactivation resets the
// relay attempt — so state-level teardown can still assert the reset occurs.
const { activateHostedNode, deactivateHostedNode, suspendHostedNode, resetRelayAttemptFactory } =
  vi.hoisted(() => {
    const resetRelayAttemptFactory = vi.fn();
    return {
      activateHostedNode: vi.fn(
        async (
          _node?: HostedHubNode,
          _previousEnvironmentId?: EnvironmentId | null,
          _signal?: AbortSignal,
        ): Promise<void> => undefined,
      ),
      deactivateHostedNode: vi.fn(async (_environmentId?: EnvironmentId): Promise<void> => {
        resetRelayAttemptFactory();
      }),
      suspendHostedNode: vi.fn(async (_environmentId?: EnvironmentId): Promise<void> => undefined),
      resetRelayAttemptFactory,
    };
  });
vi.mock("./environment", () => ({ activateHostedNode, deactivateHostedNode, suspendHostedNode }));

import { HostedHubApiError, type HostedHubApi } from "./api";
import {
  configureHostedRuntime,
  type HostedNodeLifecycle,
  type HostedRuntimeConfiguration,
} from "./runtime";
import {
  HOSTED_ACCOUNT_BUSY_MESSAGE,
  HOSTED_ACCOUNT_SIGNED_OUT_MESSAGE,
  HOSTED_PASSKEY_UNCONFIRMED_MESSAGE,
  hostedAccountStore,
  hostedHubController,
  hostedHubStore,
  markHostedSessionReady,
} from "./state";

const hasHostedRelayPendingRequests = vi.fn(() => false);

/** Configurable Hub API instance the controller reads through the runtime. */
const hostedHubApi = {
  restoreSession: vi.fn(),
  getBootstrapAvailability: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  bootstrapOwner: vi.fn(),
  redeemInvitation: vi.fn(),
  listNodes: vi.fn(),
  listPasskeys: vi.fn(),
  addPasskey: vi.fn(),
  revokePasskey: vi.fn(),
  regenerateRecoveryCodes: vi.fn(),
  setPassword: vi.fn(),
  removePassword: vi.fn(),
  beginTotpEnrollment: vi.fn(),
  confirmTotpEnrollment: vi.fn(),
  revokeTotp: vi.fn(),
  requestEmailVerification: vi.fn(),
  clearSessionMaterial: vi.fn(),
} as unknown as HostedHubApi;

const unusedService = new Proxy(
  {},
  {
    get() {
      throw new Error("platform service is not used by the hosted controller tests");
    },
  },
);

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
    // Mirror the web AppLifecycle foreground signals so the visibility-gated
    // directory scheduling behaves as it does in the browser.
    isForeground: () =>
      (globalThis.document as { visibilityState?: string } | undefined)?.visibilityState !==
      "hidden",
    subscribeForeground: (listener) => {
      const doc = globalThis.document as
        | {
            visibilityState?: string;
            addEventListener: (type: string, handler: () => void, options?: unknown) => void;
            removeEventListener: (type: string, handler: () => void) => void;
          }
        | undefined;
      const onVisibility = () => {
        if (doc?.visibilityState === "visible") listener();
      };
      doc?.addEventListener("visibilitychange", onVisibility, { once: true });
      return () => doc?.removeEventListener("visibilitychange", onVisibility);
    },
    hasPendingRelayRequests: hasHostedRelayPendingRequests,
    resetRelayAttemptFactory,
    relayUrl: () => "wss://hub.example.test/v1/relay/client",
    createRelaySocket: () => ({}),
  };
}

const sessionResponse: HostedHubSessionResponse = {
  account: {
    id: "acct_aaaaaaaaaaaaaaaaaaaaaa",
    displayName: "Ada",
    role: "owner",
    createdAt: 1,
    disabledAt: null,
  },
  session: {
    id: "sess_aaaaaaaaaaaaaaaaaaaaaa",
    accountId: "acct_aaaaaaaaaaaaaaaaaaaaaa",
    createdAt: 1,
    expiresAt: 2,
    lastSeenAt: 1,
    revokedAt: null,
    revocationReasonCode: null,
  },
  csrfToken: "csrf-sensitive-canary",
};

function node(
  id = "node_aaaaaaaaaaaaaaaaaaaaaa",
  role: "viewer" | "operator" | "owner" = "operator",
): HostedHubNode {
  return {
    id,
    environmentId: EnvironmentId.make(`env_${id.slice(5).padEnd(22, "a").slice(0, 22)}`),
    label: `Node ${id.slice(-1)}`,
    platformOs: "linux",
    platformArch: "x64",
    clientVersion: "0.9.0",
    createdAt: 1,
    updatedAt: 1,
    lastAuthenticatedAt: 1,
    revokedAt: null,
    revocationReasonCode: null,
    grant: { id: `grant_${id.slice(5)}`, role },
    effectiveRole: role,
    presence: { online: true, lastHeartbeatAt: 1 },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  hasHostedRelayPendingRequests.mockReturnValue(false);
  configureHostedRuntime(fakeRuntime(), hostedHubApi);
});

afterEach(() => {
  hostedHubController.resetForTests();
  activateHostedNode.mockClear();
  deactivateHostedNode.mockClear();
  suspendHostedNode.mockClear();
  hasHostedRelayPendingRequests.mockReset();
  hasHostedRelayPendingRequests.mockReturnValue(false);
  vi.restoreAllMocks();
  vi.useRealTimers();
  Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
});

describe("hosted account state", () => {
  it("discovers bootstrap availability only after a signed-out session result", async () => {
    vi.spyOn(hostedHubApi, "restoreSession").mockRejectedValue(
      new HostedHubApiError("session_invalid", 401),
    );
    vi.spyOn(hostedHubApi, "getBootstrapAvailability").mockResolvedValue(true);
    await hostedHubController.bootstrap();
    expect(hostedHubStore.getState()).toMatchObject({
      accountStatus: "signed-out",
      bootstrapAvailable: true,
    });
  });

  it("fails closed when bootstrap availability cannot be loaded", async () => {
    vi.spyOn(hostedHubApi, "restoreSession").mockRejectedValue(
      new HostedHubApiError("session_invalid", 401),
    );
    vi.spyOn(hostedHubApi, "getBootstrapAvailability").mockRejectedValue(
      new HostedHubApiError("unavailable", 0),
    );
    await hostedHubController.bootstrap();
    expect(hostedHubStore.getState()).toMatchObject({
      accountStatus: "signed-out",
      bootstrapAvailable: false,
    });
  });

  it("restores a session, signs in, signs out, and expires without exposing credentials", async () => {
    vi.useFakeTimers();
    vi.spyOn(hostedHubApi, "restoreSession").mockResolvedValue(sessionResponse);
    vi.spyOn(hostedHubApi, "listNodes").mockResolvedValue([]);
    await hostedHubController.bootstrap();
    expect(hostedHubStore.getState()).toMatchObject({
      accountStatus: "authenticated",
      directoryStatus: "ready",
    });

    vi.spyOn(hostedHubApi, "signOut").mockResolvedValue();
    await hostedHubController.signOut();
    expect(hostedHubStore.getState().accountStatus).toBe("signed-out");
    expect(JSON.stringify(hostedHubStore.getState())).not.toContain("csrf-sensitive-canary");

    hostedHubStore.setState({
      accountStatus: "authenticated",
      account: sessionResponse.account,
      session: sessionResponse.session,
    });
    await hostedHubController.expireSession();
    expect(hostedHubStore.getState()).toMatchObject({
      accountStatus: "session-expired",
      effectiveRole: null,
      selectedNode: null,
    });
  });

  it.each([
    ["denial", new HostedHubApiError("authentication_failed", 401)],
    ["malformed response", new HostedHubApiError("invalid_response", 502)],
    ["network loss", new HostedHubApiError("unavailable", 0)],
  ])("handles passkey %s with a bounded signed-out error", async (_label, failure) => {
    vi.spyOn(hostedHubApi, "signIn").mockRejectedValue(failure);
    await hostedHubController.signIn();
    const state = hostedHubStore.getState();
    expect(state.accountStatus).toBe("signed-out");
    expect(state.errorMessage).not.toContain("undefined");
  });

  it("cancels an in-flight passkey ceremony", async () => {
    vi.spyOn(hostedHubApi, "signIn").mockImplementation(
      (signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () =>
            reject(new DOMException("cancelled", "AbortError")),
          );
        }),
    );
    const pending = hostedHubController.signIn();
    hostedHubController.cancelAuthentication();
    await pending;
    expect(hostedHubStore.getState()).toMatchObject({
      accountStatus: "signed-out",
      errorMessage: null,
    });
  });

  it("aborts a duplicate sign-in submission before accepting the replacement", async () => {
    let call = 0;
    vi.spyOn(hostedHubApi, "signIn").mockImplementation((signal) => {
      call += 1;
      if (call === 2) return Promise.resolve(sessionResponse);
      return new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new DOMException("replaced", "AbortError")));
      });
    });
    vi.spyOn(hostedHubApi, "listNodes").mockResolvedValue([]);
    const first = hostedHubController.signIn();
    const replacement = hostedHubController.signIn();
    await Promise.all([first, replacement]);
    expect(hostedHubStore.getState().accountStatus).toBe("authenticated");
  });
});

describe("hosted registration and directory state", () => {
  it("bootstraps the first owner and keeps credentials out of state", async () => {
    vi.useFakeTimers();
    vi.spyOn(hostedHubApi, "bootstrapOwner").mockResolvedValue({
      ...sessionResponse,
      recoveryCodes: ["recovery-sensitive-canary"],
    });
    vi.spyOn(hostedHubApi, "listNodes").mockResolvedValue([]);

    hostedHubStore.setState({ bootstrapAvailable: true });
    await hostedHubController.bootstrapOwner({
      credential: "bootstrap-sensitive-canary",
      displayName: "Ada",
      passkeyLabel: "Primary",
    });

    expect(hostedHubStore.getState()).toMatchObject({
      accountStatus: "authenticated",
      recoveryCodes: ["recovery-sensitive-canary"],
      bootstrapAvailable: false,
    });
    expect(JSON.stringify(hostedHubStore.getState())).not.toContain("bootstrap-sensitive-canary");
  });

  it("handles unavailable owner bootstrap without reflecting the credential", async () => {
    vi.spyOn(hostedHubApi, "bootstrapOwner").mockRejectedValue(
      new HostedHubApiError("registration_unavailable", 409),
    );

    await hostedHubController.bootstrapOwner({
      credential: "bootstrap-sensitive-canary",
      displayName: "Ada",
      passkeyLabel: null,
    });

    expect(hostedHubStore.getState()).toMatchObject({ accountStatus: "signed-out" });
    expect(hostedHubStore.getState().errorMessage).not.toContain("bootstrap-sensitive-canary");
  });

  it("redeems an invitation and keeps one-time recovery codes only in memory", async () => {
    vi.useFakeTimers();
    vi.spyOn(hostedHubApi, "redeemInvitation").mockResolvedValue({
      ...sessionResponse,
      recoveryCodes: ["recovery-sensitive-canary"],
    });
    vi.spyOn(hostedHubApi, "listNodes").mockResolvedValue([]);
    await hostedHubController.redeemInvitation({
      secret: "invitation-sensitive-canary",
      displayName: "Ada",
      passkeyLabel: null,
    });
    expect(hostedHubStore.getState().recoveryCodes).toEqual(["recovery-sensitive-canary"]);
    expect(JSON.stringify(hostedHubStore.getState())).not.toContain("invitation-sensitive-canary");
    hostedHubController.dismissRecoveryCodes();
    expect(hostedHubStore.getState().recoveryCodes).toEqual([]);
  });

  it.each([
    ["denial", new HostedHubApiError("forbidden", 403)],
    ["expiry", new HostedHubApiError("invalid_request", 400)],
    ["replay", new HostedHubApiError("conflict", 409)],
  ])("handles invitation %s without reflecting the secret", async (_label, failure) => {
    vi.spyOn(hostedHubApi, "redeemInvitation").mockRejectedValue(failure);
    await hostedHubController.redeemInvitation({
      secret: "invitation-sensitive-canary",
      displayName: "Ada",
      passkeyLabel: null,
    });
    expect(hostedHubStore.getState()).toMatchObject({ accountStatus: "signed-out" });
    expect(hostedHubStore.getState().errorMessage).not.toContain("invitation-sensitive-canary");
  });

  it("cancels invitation registration without retaining its secret", async () => {
    vi.spyOn(hostedHubApi, "redeemInvitation").mockImplementation(
      (_input, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () =>
            reject(new DOMException("cancelled", "AbortError")),
          );
        }),
    );
    const pending = hostedHubController.redeemInvitation({
      secret: "invitation-sensitive-canary",
      displayName: "Ada",
      passkeyLabel: null,
    });
    hostedHubController.cancelAuthentication();
    await pending;
    expect(JSON.stringify(hostedHubStore.getState())).not.toContain("invitation-sensitive-canary");
  });

  it("preserves an identity-matched selection and clears it when authorization is removed", async () => {
    vi.useFakeTimers();
    const first = node();
    hostedHubStore.setState({
      accountStatus: "authenticated",
      account: sessionResponse.account,
      session: sessionResponse.session,
      directoryStatus: "ready",
      nodes: [first],
      selectedNode: first,
      selectionStatus: "online",
      effectiveRole: first.effectiveRole,
      generation: 3,
    });
    vi.spyOn(hostedHubApi, "listNodes").mockResolvedValue([{ ...first, label: "Refreshed" }]);
    await hostedHubController.refreshDirectory();
    expect(hostedHubStore.getState().selectedNode?.label).toBe("Refreshed");

    vi.mocked(hostedHubApi.listNodes).mockResolvedValue([]);
    await hostedHubController.refreshDirectory();
    expect(deactivateHostedNode).toHaveBeenCalledWith(first.environmentId);
    expect(hostedHubStore.getState()).toMatchObject({
      selectedNode: null,
      selectionStatus: "authorization-removed",
      effectiveRole: null,
    });
  });

  it("tears down a selected node as soon as the directory marks it revoked", async () => {
    vi.useFakeTimers();
    const selected = node();
    hostedHubStore.setState({
      accountStatus: "authenticated",
      account: sessionResponse.account,
      session: sessionResponse.session,
      directoryStatus: "ready",
      nodes: [selected],
      selectedNode: selected,
      selectionStatus: "online",
      effectiveRole: selected.effectiveRole,
      generation: 3,
    });
    vi.spyOn(hostedHubApi, "listNodes").mockResolvedValue([
      { ...selected, revokedAt: 2, revocationReasonCode: "administrative" },
    ]);

    await hostedHubController.refreshDirectory();

    expect(deactivateHostedNode).toHaveBeenCalledWith(selected.environmentId);
    expect(hostedHubStore.getState()).toMatchObject({
      selectedNode: null,
      selectionStatus: "revoked",
      effectiveRole: null,
      transportStatus: "idle",
      sessionStatus: "closed",
      generation: 4,
    });
  });

  it("marks retained directory data stale and fails role checks closed", async () => {
    vi.useFakeTimers();
    const selected = node();
    hostedHubStore.setState({
      accountStatus: "authenticated",
      directoryStatus: "ready",
      nodes: [selected],
      selectedNode: selected,
      effectiveRole: "operator",
    });
    vi.spyOn(hostedHubApi, "listNodes").mockRejectedValue(new HostedHubApiError("unavailable", 0));
    await hostedHubController.refreshDirectory();
    expect(hostedHubStore.getState()).toMatchObject({
      directoryStatus: "stale",
      effectiveRole: null,
      selectedNode: selected,
    });
  });

  it("refreshes the directory when a hidden tab becomes visible", async () => {
    vi.useFakeTimers();
    const listeners = new Set<() => void>();
    let visibilityState: "hidden" | "visible" = "hidden";
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        get visibilityState() {
          return visibilityState;
        },
        addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
        removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
      },
    });
    hostedHubStore.setState({
      accountStatus: "authenticated",
      account: sessionResponse.account,
      session: sessionResponse.session,
      directoryStatus: "ready",
    });
    const listNodes = vi.spyOn(hostedHubApi, "listNodes").mockResolvedValue([]);

    await hostedHubController.refreshDirectory();
    expect(listNodes).toHaveBeenCalledOnce();
    expect(listeners).toHaveLength(1);

    visibilityState = "visible";
    for (const listener of listeners) listener();
    await Promise.resolve();
    await Promise.resolve();
    expect(listNodes).toHaveBeenCalledTimes(2);
    Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
  });

  it("keeps mutations stale until browser resume revalidates access and node state", async () => {
    const selected = node();
    const order: string[] = [];
    hostedHubStore.setState({
      accountStatus: "authenticated",
      account: sessionResponse.account,
      session: sessionResponse.session,
      directoryStatus: "ready",
      nodes: [selected],
      selectedNode: selected,
      selectionStatus: "online",
      effectiveRole: selected.effectiveRole,
      transportStatus: "online",
      sessionStatus: "ready",
      sessionEstablished: true,
      browserStatus: "current",
      generation: 4,
    });
    vi.spyOn(hostedHubApi, "restoreSession").mockImplementation(async () => {
      order.push("session");
      return sessionResponse;
    });
    vi.spyOn(hostedHubApi, "listNodes").mockImplementation(async () => {
      order.push("directory");
      return [selected];
    });
    activateHostedNode.mockImplementationOnce(async () => {
      order.push("relay");
    });

    hostedHubController.suspendBrowser("hidden");
    await vi.waitFor(() => expect(suspendHostedNode).toHaveBeenCalledWith(selected.environmentId));
    expect(hostedHubStore.getState()).toMatchObject({
      browserStatus: "suspended",
      sessionStatus: "stale",
      generation: 5,
    });
    hostedHubController.markSessionReady(selected.environmentId);
    expect(hostedHubStore.getState().browserStatus).toBe("suspended");

    await hostedHubController.resumeBrowser();
    expect(order).toEqual(["session", "directory", "relay"]);
    expect(hostedHubStore.getState()).toMatchObject({
      browserStatus: "synchronizing",
      sessionStatus: "synchronizing",
      generation: 6,
    });

    hostedHubController.markSessionReady(selected.environmentId);
    expect(hostedHubStore.getState()).toMatchObject({
      browserStatus: "current",
      sessionStatus: "ready",
    });
  });

  it("ignores readiness from a superseded hosted connection generation", () => {
    const selected = node();
    hostedHubStore.setState({
      accountStatus: "authenticated",
      selectedNode: selected,
      transportStatus: "online",
      sessionStatus: "synchronizing",
      sessionEstablished: false,
      browserStatus: "synchronizing",
      generation: 5,
    });

    markHostedSessionReady(selected.environmentId, 4);
    expect(hostedHubStore.getState()).toMatchObject({
      browserStatus: "synchronizing",
      sessionStatus: "synchronizing",
      sessionEstablished: false,
    });

    markHostedSessionReady(selected.environmentId, 5);
    expect(hostedHubStore.getState()).toMatchObject({
      browserStatus: "current",
      sessionStatus: "ready",
      sessionEstablished: true,
    });
  });

  it("preserves delivery uncertainty when resume replaces a relay with a pending mutation", async () => {
    const selected = node();
    hostedHubStore.setState({
      accountStatus: "authenticated",
      account: sessionResponse.account,
      session: sessionResponse.session,
      directoryStatus: "ready",
      nodes: [selected],
      selectedNode: selected,
      selectionStatus: "online",
      effectiveRole: selected.effectiveRole,
      transportStatus: "online",
      sessionStatus: "ready",
      sessionEstablished: true,
      browserStatus: "current",
      generation: 4,
    });
    vi.spyOn(hostedHubApi, "restoreSession").mockResolvedValue(sessionResponse);
    vi.spyOn(hostedHubApi, "listNodes").mockResolvedValue([selected]);
    hasHostedRelayPendingRequests.mockReturnValue(true);

    hostedHubController.suspendBrowser("hidden");
    await hostedHubController.resumeBrowser();

    expect(hostedHubStore.getState()).toMatchObject({
      browserStatus: "synchronizing",
      sessionStatus: "delivery-unknown",
      sessionRecoveredAfterUnknown: false,
      generation: 6,
    });
    hostedHubController.markSessionReady(selected.environmentId);
    expect(hostedHubStore.getState()).toMatchObject({
      browserStatus: "current",
      sessionStatus: "delivery-unknown",
      sessionRecoveredAfterUnknown: true,
    });
  });

  it("preserves resumed delivery uncertainty when synchronization times out", async () => {
    vi.useFakeTimers();
    const selected = node();
    hostedHubStore.setState({
      accountStatus: "authenticated",
      account: sessionResponse.account,
      session: sessionResponse.session,
      directoryStatus: "ready",
      nodes: [selected],
      selectedNode: selected,
      selectionStatus: "online",
      effectiveRole: selected.effectiveRole,
      transportStatus: "online",
      sessionStatus: "ready",
      sessionEstablished: true,
      browserStatus: "current",
      generation: 4,
    });
    vi.spyOn(hostedHubApi, "restoreSession").mockResolvedValue(sessionResponse);
    vi.spyOn(hostedHubApi, "listNodes").mockResolvedValue([selected]);
    hasHostedRelayPendingRequests.mockReturnValue(true);

    hostedHubController.suspendBrowser("hidden");
    await hostedHubController.resumeBrowser();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(hostedHubStore.getState()).toMatchObject({
      transportStatus: "terminal-failure",
      sessionStatus: "delivery-unknown",
      sessionEstablished: false,
      sessionRecoveredAfterUnknown: false,
      errorMessage: "Ryco state could not be synchronized.",
    });
  });

  it("starts a fresh access check when suspension cancels an in-flight resume", async () => {
    hostedHubStore.setState({
      accountStatus: "authenticated",
      account: sessionResponse.account,
      session: sessionResponse.session,
      directoryStatus: "ready",
      browserStatus: "current",
    });
    let restoreCalls = 0;
    vi.spyOn(hostedHubApi, "restoreSession").mockImplementation((signal) => {
      restoreCalls += 1;
      if (restoreCalls > 1) return Promise.resolve(sessionResponse);
      return new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () =>
          reject(new DOMException("suspended", "AbortError")),
        );
      });
    });
    vi.spyOn(hostedHubApi, "listNodes").mockResolvedValue([]);

    const interrupted = hostedHubController.resumeBrowser();
    await Promise.resolve();
    hostedHubController.suspendBrowser("hidden");
    const resumed = hostedHubController.resumeBrowser();
    await Promise.all([interrupted, resumed]);

    expect(restoreCalls).toBe(2);
    expect(hostedHubStore.getState()).toMatchObject({
      browserStatus: "current",
      directoryStatus: "ready",
      errorMessage: null,
    });
  });

  it("coalesces repeated browser resume events into one access check and relay activation", async () => {
    const selected = node();
    hostedHubStore.setState({
      accountStatus: "authenticated",
      account: sessionResponse.account,
      session: sessionResponse.session,
      directoryStatus: "ready",
      nodes: [selected],
      selectedNode: selected,
      selectionStatus: "online",
      effectiveRole: selected.effectiveRole,
      transportStatus: "online",
      sessionStatus: "ready",
      sessionEstablished: true,
      browserStatus: "current",
      generation: 4,
    });
    vi.spyOn(hostedHubApi, "restoreSession").mockResolvedValue(sessionResponse);
    vi.spyOn(hostedHubApi, "listNodes").mockResolvedValue([selected]);

    hostedHubController.suspendBrowser("hidden");
    const first = hostedHubController.resumeBrowser();
    const second = hostedHubController.resumeBrowser();
    const third = hostedHubController.resumeBrowser();

    expect(first).toBe(second);
    expect(second).toBe(third);
    await Promise.all([first, second, third]);
    expect(activateHostedNode).toHaveBeenCalledOnce();
    expect(hostedHubStore.getState()).toMatchObject({
      browserStatus: "synchronizing",
      sessionStatus: "synchronizing",
      generation: 6,
    });
  });

  it("expires authority during resume without opening another hosted connection", async () => {
    const selected = node();
    hostedHubStore.setState({
      accountStatus: "authenticated",
      account: sessionResponse.account,
      session: sessionResponse.session,
      directoryStatus: "ready",
      nodes: [selected],
      selectedNode: selected,
      selectionStatus: "online",
      effectiveRole: selected.effectiveRole,
      transportStatus: "online",
      sessionStatus: "ready",
      sessionEstablished: true,
      browserStatus: "current",
      generation: 4,
    });
    vi.spyOn(hostedHubApi, "restoreSession").mockRejectedValue(
      new HostedHubApiError("session_invalid", 401),
    );

    hostedHubController.suspendBrowser("offline");
    await hostedHubController.resumeBrowser();

    expect(activateHostedNode).not.toHaveBeenCalled();
    // Account clear must reset the relay attempt via the deactivation path
    // (the deactivate fake mirrors the transition-queue reset contract; the
    // ordered teardown itself is proven in environment.test.ts).
    expect(deactivateHostedNode).toHaveBeenCalledWith(selected.environmentId);
    expect(resetRelayAttemptFactory).toHaveBeenCalledOnce();
    expect(hostedHubStore.getState()).toMatchObject({
      accountStatus: "session-expired",
      selectedNode: null,
      effectiveRole: null,
      sessionEstablished: false,
    });
  });

  it("replaces an in-flight directory refresh with a post-resume access check", async () => {
    hostedHubStore.setState({
      accountStatus: "authenticated",
      account: sessionResponse.account,
      session: sessionResponse.session,
      directoryStatus: "ready",
      nodes: [],
      browserStatus: "current",
    });
    vi.spyOn(hostedHubApi, "restoreSession").mockResolvedValue(sessionResponse);
    let firstSignal: AbortSignal | undefined;
    const listNodes = vi.spyOn(hostedHubApi, "listNodes").mockImplementation((signal) => {
      if (listNodes.mock.calls.length > 1) return Promise.resolve([]);
      firstSignal = signal;
      return new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () =>
          reject(new DOMException("suspended", "AbortError")),
        );
      });
    });

    const staleRefresh = hostedHubController.refreshDirectory();
    await vi.waitFor(() => expect(listNodes).toHaveBeenCalledOnce());
    hostedHubController.suspendBrowser("hidden");
    await staleRefresh;
    await hostedHubController.resumeBrowser();

    expect(firstSignal?.aborted).toBe(true);
    expect(listNodes).toHaveBeenCalledTimes(2);
    expect(hostedHubStore.getState()).toMatchObject({
      browserStatus: "current",
      directoryStatus: "ready",
    });
  });

  it("aborts same-node activation when the browser is suspended again", async () => {
    vi.useFakeTimers();
    const selected = node();
    hostedHubStore.setState({
      accountStatus: "authenticated",
      account: sessionResponse.account,
      session: sessionResponse.session,
      directoryStatus: "ready",
      nodes: [selected],
      selectedNode: selected,
      selectionStatus: "online",
      effectiveRole: selected.effectiveRole,
      transportStatus: "online",
      sessionStatus: "ready",
      sessionEstablished: true,
      browserStatus: "current",
      generation: 4,
    });
    vi.spyOn(hostedHubApi, "restoreSession").mockResolvedValue(sessionResponse);
    vi.spyOn(hostedHubApi, "listNodes").mockResolvedValue([selected]);
    activateHostedNode.mockImplementationOnce(
      async (_node, _previousEnvironmentId, signal: AbortSignal | undefined) =>
        await new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve())),
    );

    hostedHubController.suspendBrowser("hidden");
    const interrupted = hostedHubController.resumeBrowser();
    await vi.waitFor(() => expect(activateHostedNode).toHaveBeenCalledOnce());
    const firstSignal = activateHostedNode.mock.calls[0]?.[2] as AbortSignal | undefined;
    hostedHubController.suspendBrowser("hidden");
    await interrupted;
    await vi.advanceTimersByTimeAsync(30_000);

    expect(firstSignal?.aborted).toBe(true);
    expect(hostedHubStore.getState()).toMatchObject({
      browserStatus: "suspended",
      sessionStatus: "stale",
      generation: 7,
    });
    expect(hostedHubStore.getState().transportStatus).not.toBe("terminal-failure");

    await hostedHubController.resumeBrowser();
    expect(activateHostedNode).toHaveBeenCalledTimes(2);
    expect(hostedHubStore.getState()).toMatchObject({
      browserStatus: "synchronizing",
      sessionStatus: "synchronizing",
      generation: 8,
    });
  });

  it("restarts full resume after a stale directory retry recovers", async () => {
    vi.useFakeTimers();
    const selected = node();
    hostedHubStore.setState({
      accountStatus: "authenticated",
      account: sessionResponse.account,
      session: sessionResponse.session,
      directoryStatus: "ready",
      nodes: [selected],
      selectedNode: selected,
      selectionStatus: "online",
      effectiveRole: selected.effectiveRole,
      transportStatus: "online",
      sessionStatus: "ready",
      sessionEstablished: true,
      browserStatus: "current",
      generation: 4,
    });
    const restoreSession = vi
      .spyOn(hostedHubApi, "restoreSession")
      .mockResolvedValue(sessionResponse);
    const listNodes = vi
      .spyOn(hostedHubApi, "listNodes")
      .mockRejectedValueOnce(new HostedHubApiError("unavailable", 0))
      .mockResolvedValue([selected]);

    hostedHubController.suspendBrowser("hidden");
    await hostedHubController.resumeBrowser();
    expect(hostedHubStore.getState()).toMatchObject({
      browserStatus: "stale",
      directoryStatus: "stale",
      effectiveRole: null,
    });

    await hostedHubController.refreshDirectory();
    await vi.waitFor(() => expect(restoreSession).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(activateHostedNode).toHaveBeenCalledOnce());

    expect(listNodes).toHaveBeenCalledTimes(3);
    expect(hostedHubStore.getState()).toMatchObject({
      browserStatus: "synchronizing",
      directoryStatus: "ready",
      sessionStatus: "synchronizing",
    });
    hostedHubController.markSessionReady(selected.environmentId);
    expect(hostedHubStore.getState().browserStatus).toBe("current");
  });

  it("switches nodes through the ordered environment teardown boundary", async () => {
    const first = node();
    const second = node("node_bbbbbbbbbbbbbbbbbbbbbb", "owner");
    hostedHubStore.setState({
      accountStatus: "authenticated",
      directoryStatus: "ready",
      nodes: [first, second],
      selectedNode: first,
      effectiveRole: first.effectiveRole,
    });
    await hostedHubController.selectNode(second.id);
    expect(activateHostedNode).toHaveBeenCalledWith(second, first.environmentId);
    expect(hostedHubStore.getState()).toMatchObject({
      selectedNode: second,
      sessionStatus: "synchronizing",
      generation: 1,
    });
    hostedHubController.markSessionReplaying(second.environmentId);
    expect(hostedHubStore.getState().sessionStatus).toBe("replaying");
    hostedHubController.markSessionReady(second.environmentId);
    expect(hostedHubStore.getState().sessionStatus).toBe("ready");
  });

  it("rejects node selection while browser access is being revalidated", async () => {
    const selected = node();
    hostedHubStore.setState({
      accountStatus: "authenticated",
      directoryStatus: "ready",
      browserStatus: "checking-access",
      nodes: [selected],
    });

    await hostedHubController.selectNode(selected.id);

    expect(activateHostedNode).not.toHaveBeenCalled();
    expect(hostedHubStore.getState().selectedNode).toBeNull();
  });

  it("ends browser synchronization after a terminal relay failure", () => {
    const selected = node();
    hostedHubStore.setState({
      accountStatus: "authenticated",
      directoryStatus: "ready",
      browserStatus: "synchronizing",
      nodes: [selected],
      selectedNode: selected,
      selectionStatus: "online",
      effectiveRole: selected.effectiveRole,
      transportStatus: "connecting",
      sessionStatus: "synchronizing",
      generation: 5,
    });

    hostedHubController.failure(5, { kind: "incompatible", retryable: false });

    expect(hostedHubStore.getState()).toMatchObject({
      browserStatus: "current",
      selectionStatus: "incompatible",
      effectiveRole: null,
      transportStatus: "terminal-failure",
      sessionStatus: "stale",
    });
  });

  it("fails initial synchronization after exactly thirty seconds", async () => {
    vi.useFakeTimers();
    const selected = node();
    hostedHubStore.setState({
      accountStatus: "authenticated",
      directoryStatus: "ready",
      nodes: [selected],
    });

    await hostedHubController.selectNode(selected.id);
    hostedHubStore.setState({ browserStatus: "synchronizing" });
    await vi.advanceTimersByTimeAsync(29_999);
    expect(hostedHubStore.getState().transportStatus).not.toBe("terminal-failure");

    await vi.advanceTimersByTimeAsync(1);
    expect(hostedHubStore.getState()).toMatchObject({
      browserStatus: "current",
      transportStatus: "terminal-failure",
      sessionStatus: "stale",
      sessionEstablished: false,
      errorMessage: "Ryco state could not be synchronized.",
    });
  });

  it("cancels the synchronization deadline after the matching snapshot is ready", async () => {
    vi.useFakeTimers();
    const selected = node();
    hostedHubStore.setState({
      accountStatus: "authenticated",
      directoryStatus: "ready",
      nodes: [selected],
    });

    await hostedHubController.selectNode(selected.id);
    hostedHubController.markSessionReady(selected.environmentId);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(hostedHubStore.getState()).toMatchObject({
      transportStatus: "idle",
      sessionStatus: "ready",
      sessionEstablished: true,
      errorMessage: null,
    });
  });

  it("isolates the synchronization deadline to the current selection generation", async () => {
    vi.useFakeTimers();
    const first = node("node_aaaaaaaaaaaaaaaaaaaaaa");
    const second = node("node_bbbbbbbbbbbbbbbbbbbbbb");
    hostedHubStore.setState({
      accountStatus: "authenticated",
      directoryStatus: "ready",
      nodes: [first, second],
    });

    await hostedHubController.selectNode(first.id);
    await vi.advanceTimersByTimeAsync(10_000);
    await hostedHubController.selectNode(second.id);
    await vi.advanceTimersByTimeAsync(20_000);

    expect(hostedHubStore.getState()).toMatchObject({
      selectedNode: second,
      sessionStatus: "synchronizing",
      errorMessage: null,
    });

    await vi.advanceTimersByTimeAsync(10_000);
    expect(hostedHubStore.getState()).toMatchObject({
      selectedNode: second,
      transportStatus: "terminal-failure",
      errorMessage: "Ryco state could not be synchronized.",
    });
  });

  it("ignores a queued session-sync deadline from a superseded generation", async () => {
    vi.useFakeTimers();
    const selected = node();
    hostedHubStore.setState({
      accountStatus: "authenticated",
      directoryStatus: "ready",
      nodes: [selected],
    });

    // Arm the 30s synchronization deadline for generation 1.
    await hostedHubController.selectNode(selected.id);
    hostedHubStore.setState({ browserStatus: "synchronizing" });

    // A newer generation takes over and its session becomes healthy, but the
    // generation-1 deadline's callback is still queued (its timer was never
    // cleared through a controller path here).
    hostedHubStore.setState({
      generation: 99,
      transportStatus: "online",
      sessionStatus: "ready",
      sessionEstablished: false,
    });
    await vi.advanceTimersByTimeAsync(30_000);

    // The stale deadline must not terminal-fail the superseding session.
    expect(hostedHubStore.getState()).toMatchObject({
      generation: 99,
      transportStatus: "online",
      sessionStatus: "ready",
    });
    expect(hostedHubStore.getState().transportStatus).not.toBe("terminal-failure");
  });

  it("retries the selected node once with a fresh generation", async () => {
    const selected = node();
    hostedHubStore.setState({
      accountStatus: "authenticated",
      directoryStatus: "ready",
      nodes: [selected],
      selectedNode: selected,
      selectionStatus: "online",
      effectiveRole: selected.effectiveRole,
      transportStatus: "terminal-failure",
      sessionStatus: "stale",
      sessionEstablished: false,
      errorMessage: "Ryco state could not be synchronized.",
      generation: 7,
    });

    await Promise.all([
      hostedHubController.retrySelectedNode(),
      hostedHubController.retrySelectedNode(),
    ]);

    expect(activateHostedNode).toHaveBeenCalledOnce();
    expect(activateHostedNode).toHaveBeenCalledWith(
      selected,
      selected.environmentId,
      expect.any(AbortSignal),
    );
    expect(hostedHubStore.getState()).toMatchObject({
      generation: 8,
      transportStatus: "idle",
      sessionStatus: "synchronizing",
      sessionEstablished: false,
      errorMessage: null,
    });
  });

  it("fails before readiness and emits only a stable diagnostic after readiness", () => {
    const selected = node();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    hostedHubStore.setState({
      accountStatus: "authenticated",
      selectedNode: selected,
      browserStatus: "synchronizing",
      transportStatus: "online",
      sessionStatus: "synchronizing",
      sessionEstablished: false,
      generation: 3,
    });

    hostedHubController.reportShellSnapshotFailure(selected.environmentId);
    expect(hostedHubStore.getState()).toMatchObject({
      browserStatus: "current",
      transportStatus: "terminal-failure",
      errorMessage: "Ryco state could not be synchronized.",
    });

    hostedHubStore.setState({
      transportStatus: "online",
      sessionStatus: "ready",
      sessionEstablished: true,
      errorMessage: null,
    });
    hostedHubController.reportShellSnapshotFailure(selected.environmentId);
    expect(hostedHubStore.getState()).toMatchObject({
      transportStatus: "online",
      sessionStatus: "ready",
      errorMessage: null,
    });
    expect(warning).toHaveBeenCalledWith("hosted_snapshot_reconciliation_failed");
  });

  it("keeps delivery uncertainty visible through replay until the user acknowledges it", () => {
    const selected = node();
    hostedHubStore.setState({
      accountStatus: "authenticated",
      selectedNode: selected,
      transportStatus: "online",
      sessionStatus: "ready",
      generation: 7,
    });
    hostedHubController.markDeliveryUnknown(7);
    hostedHubController.sessionStatus(7, "synchronizing");
    hostedHubController.markSessionReplaying(selected.environmentId);
    expect(hostedHubStore.getState()).toMatchObject({
      sessionStatus: "delivery-unknown",
      sessionRecoveredAfterUnknown: false,
    });

    hostedHubController.markSessionReady(selected.environmentId);
    expect(hostedHubStore.getState()).toMatchObject({
      sessionStatus: "delivery-unknown",
      sessionRecoveredAfterUnknown: true,
    });
    hostedHubController.acknowledgeDeliveryUnknown();
    expect(hostedHubStore.getState()).toMatchObject({
      sessionStatus: "ready",
      sessionRecoveredAfterUnknown: false,
    });
  });
});

describe("hosted account management state", () => {
  const passkey = {
    id: "pkey_aaaaaaaaaaaaaaaaaaaaaa",
    label: "Studio laptop",
    createdAt: 10,
    lastUsedAt: null,
    backupEligible: true,
    backupState: false,
    revokedAt: null,
    revocationReasonCode: null,
  } as const;

  /** Bring the controller to an authenticated, ready-directory state. */
  async function authenticate(): Promise<void> {
    vi.spyOn(hostedHubApi, "restoreSession").mockResolvedValue(sessionResponse);
    vi.spyOn(hostedHubApi, "listNodes").mockResolvedValue([]);
    await hostedHubController.bootstrap();
  }

  it("loads the account's passkeys and deduplicates concurrent reads", async () => {
    await authenticate();
    const listPasskeys = vi.spyOn(hostedHubApi, "listPasskeys").mockResolvedValue([passkey]);

    expect(hostedAccountStore.getState()).toMatchObject({
      passkeys: [],
      passkeysStatus: "idle",
      actionStatus: "idle",
    });
    await Promise.all([
      hostedHubController.refreshPasskeys(),
      hostedHubController.refreshPasskeys(),
    ]);

    expect(listPasskeys).toHaveBeenCalledOnce();
    expect(hostedAccountStore.getState()).toMatchObject({
      passkeys: [passkey],
      passkeysStatus: "ready",
      errorMessage: null,
    });
  });

  it("arms deduplication before publishing so a synchronous re-entry joins", async () => {
    await authenticate();
    const listPasskeys = vi.spyOn(hostedHubApi, "listPasskeys").mockResolvedValue([passkey]);
    // A consumer that re-reads on notification — the same shape as the relay
    // adapter bug found earlier in this codebase. If the "loading" publish
    // fires before the handle is armed, this starts a second request and the
    // two handles desynchronise.
    const unsubscribe = hostedAccountStore.subscribe(() => {
      void hostedHubController.refreshPasskeys();
    });

    try {
      await hostedHubController.refreshPasskeys();
    } finally {
      unsubscribe();
    }

    expect(listPasskeys).toHaveBeenCalledOnce();
  });

  it("does not read passkeys while signed out", async () => {
    const listPasskeys = vi.spyOn(hostedHubApi, "listPasskeys").mockResolvedValue([passkey]);
    await hostedHubController.refreshPasskeys();
    expect(listPasskeys).not.toHaveBeenCalled();
    expect(hostedAccountStore.getState().passkeysStatus).toBe("idle");
  });

  it("reports a bounded passkey read failure without dropping the session", async () => {
    await authenticate();
    vi.spyOn(hostedHubApi, "listPasskeys").mockRejectedValue(
      new HostedHubApiError("unavailable", 0),
    );
    await hostedHubController.refreshPasskeys();
    expect(hostedHubStore.getState().accountStatus).toBe("authenticated");
    expect(hostedAccountStore.getState()).toMatchObject({
      passkeysStatus: "stale",
      errorMessage: "Hub is temporarily unavailable.",
    });
  });

  it("expires the session when an account read is rejected as unauthenticated", async () => {
    await authenticate();
    vi.spyOn(hostedHubApi, "listPasskeys").mockRejectedValue(
      new HostedHubApiError("session_invalid", 401),
    );
    await hostedHubController.refreshPasskeys();
    expect(hostedHubStore.getState().accountStatus).toBe("session-expired");
    expect(hostedAccountStore.getState()).toEqual(hostedAccountStore.getInitialState());
  });

  it("adds a passkey and confirms it against a fresh Hub read", async () => {
    await authenticate();
    const addPasskey = vi
      .spyOn(hostedHubApi, "addPasskey")
      .mockResolvedValue({ passkey, confirmed: true });
    const listPasskeys = vi.spyOn(hostedHubApi, "listPasskeys").mockResolvedValue([passkey]);

    await hostedHubController.addPasskey({ passkeyLabel: "Studio laptop" });

    expect(addPasskey).toHaveBeenCalledWith({ passkeyLabel: "Studio laptop" }, expect.anything());
    expect(listPasskeys).toHaveBeenCalledOnce();
    expect(hostedAccountStore.getState()).toMatchObject({
      passkeys: [passkey],
      passkeysStatus: "ready",
      actionStatus: "idle",
      errorMessage: null,
    });
  });

  it("does not confirm an enrolment against a read that predates it", async () => {
    await authenticate();
    // A refresh is already in flight when the enrolment lands. It was issued
    // against the pre-add state and cannot observe the new credential, so
    // joining it would settle the surface on evidence the add had failed.
    let releaseStaleRead: ((value: ReadonlyArray<typeof passkey>) => void) | null = null;
    const listPasskeys = vi
      .spyOn(hostedHubApi, "listPasskeys")
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseStaleRead = resolve;
          }),
      )
      .mockResolvedValue([passkey]);
    vi.spyOn(hostedHubApi, "addPasskey").mockResolvedValue({ passkey, confirmed: true });

    const stale = hostedHubController.refreshPasskeys();
    await hostedHubController.addPasskey({ passkeyLabel: "Studio laptop" });
    releaseStaleRead?.([]);
    await stale;

    expect(listPasskeys).toHaveBeenCalledTimes(2);
    expect(hostedAccountStore.getState()).toMatchObject({
      passkeys: [passkey],
      passkeysStatus: "ready",
      errorMessage: null,
    });
  });

  it("reports an enrolment the Hub cannot confirm rather than presenting it as done", async () => {
    await authenticate();
    // A 2xx verify that describes nothing, and a list that did not grow: the
    // ceremony completed but there is no evidence a credential exists.
    vi.spyOn(hostedHubApi, "addPasskey").mockResolvedValue({ passkey: null, confirmed: false });
    vi.spyOn(hostedHubApi, "listPasskeys").mockResolvedValue([]);

    await hostedHubController.addPasskey({ passkeyLabel: null });

    expect(hostedAccountStore.getState()).toMatchObject({
      passkeys: [],
      passkeysStatus: "ready",
      actionStatus: "idle",
      errorMessage: HOSTED_PASSKEY_UNCONFIRMED_MESSAGE,
    });
  });

  it("accepts an unconfirmed enrolment the list does vouch for", async () => {
    await authenticate();
    vi.spyOn(hostedHubApi, "addPasskey").mockResolvedValue({ passkey: null, confirmed: false });
    vi.spyOn(hostedHubApi, "listPasskeys").mockResolvedValue([passkey]);

    await hostedHubController.addPasskey({ passkeyLabel: null });

    expect(hostedAccountStore.getState()).toMatchObject({
      passkeys: [passkey],
      errorMessage: null,
    });
  });

  it("maps an add-passkey failure to a bounded message and stays authenticated", async () => {
    await authenticate();
    vi.spyOn(hostedHubApi, "addPasskey").mockRejectedValue(
      new HostedHubApiError("browser_only_transport", 400),
    );
    const listPasskeys = vi.spyOn(hostedHubApi, "listPasskeys").mockResolvedValue([]);

    await hostedHubController.addPasskey({ passkeyLabel: null });

    expect(listPasskeys).not.toHaveBeenCalled();
    expect(hostedHubStore.getState().accountStatus).toBe("authenticated");
    expect(hostedAccountStore.getState()).toMatchObject({
      actionStatus: "idle",
      errorMessage: "This action is only available in a browser.",
    });
  });

  it("runs one account action at a time and says so when it refuses", async () => {
    await authenticate();
    let release: ((value: { passkey: null; confirmed: false }) => void) | null = null;
    vi.spyOn(hostedHubApi, "addPasskey").mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const regenerateRecoveryCodes = vi
      .spyOn(hostedHubApi, "regenerateRecoveryCodes")
      .mockResolvedValue(["code"]);
    vi.spyOn(hostedHubApi, "listPasskeys").mockResolvedValue([]);

    const pending = hostedHubController.addPasskey({ passkeyLabel: null });
    expect(hostedAccountStore.getState().actionStatus).toBe("adding-passkey");

    await hostedHubController.regenerateRecoveryCodes();
    expect(regenerateRecoveryCodes).not.toHaveBeenCalled();
    expect(hostedHubStore.getState().recoveryCodes).toEqual([]);
    // A refused action must never look like a no-op: without a message the
    // surface has taps that do nothing and state that never explains it.
    expect(hostedAccountStore.getState().errorMessage).toBe(HOSTED_ACCOUNT_BUSY_MESSAGE);

    release?.({ passkey: null, confirmed: false });
    await pending;
    expect(hostedAccountStore.getState().actionStatus).toBe("idle");
  });

  it("clears a concurrent refusal once the action it refused has succeeded", async () => {
    await authenticate();
    let release: ((value: ReadonlyArray<string>) => void) | null = null;
    vi.spyOn(hostedHubApi, "regenerateRecoveryCodes").mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    vi.spyOn(hostedHubApi, "addPasskey").mockResolvedValue({ passkey: null, confirmed: false });
    vi.spyOn(hostedHubApi, "listPasskeys").mockResolvedValue([]);

    const pending = hostedHubController.regenerateRecoveryCodes();
    await hostedHubController.addPasskey({ passkeyLabel: null });
    expect(hostedAccountStore.getState().errorMessage).toBe(HOSTED_ACCOUNT_BUSY_MESSAGE);

    release?.(["fresh-code"]);
    await pending;

    // An idle surface must not still be showing a failure for an action that
    // then succeeded.
    expect(hostedAccountStore.getState()).toMatchObject({
      actionStatus: "idle",
      errorMessage: null,
    });
    expect(hostedHubStore.getState().recoveryCodes).toEqual(["fresh-code"]);
  });

  it("completes rather than rejects when lifecycle teardown fails on expiry", async () => {
    // Session expiry reaches deactivateHostedNode, which only runs when a node
    // is selected. A teardown failure there is not an authorization failure and
    // must not surface as a rejected account read (or an unhandled rejection
    // for a fire-and-forget caller).
    const selected = node();
    await authenticate();
    hostedHubStore.setState({ selectedNode: selected });
    deactivateHostedNode.mockRejectedValueOnce(new Error("lifecycle-teardown-canary"));
    vi.spyOn(hostedHubApi, "listPasskeys").mockRejectedValue(
      new HostedHubApiError("session_invalid", 401),
    );

    await expect(hostedHubController.refreshPasskeys()).resolves.toBeUndefined();
    expect(deactivateHostedNode).toHaveBeenCalledWith(selected.environmentId);
    expect(hostedHubStore.getState().accountStatus).toBe("session-expired");

    hostedHubStore.setState({
      accountStatus: "authenticated",
      account: sessionResponse.account,
      session: sessionResponse.session,
      selectedNode: selected,
    });
    deactivateHostedNode.mockRejectedValueOnce(new Error("lifecycle-teardown-canary"));
    vi.spyOn(hostedHubApi, "addPasskey").mockRejectedValue(
      new HostedHubApiError("session_invalid", 401),
    );

    await expect(hostedHubController.addPasskey({ passkeyLabel: null })).resolves.toBeUndefined();
    expect(hostedHubStore.getState().accountStatus).toBe("session-expired");
  });

  it("cancels an account ceremony that never returns", async () => {
    await authenticate();
    // A platform passkey sheet the user leaves open never resolves and never
    // rejects. Without a cancel path the surface stays busy for the session.
    vi.spyOn(hostedHubApi, "addPasskey").mockImplementation(() => new Promise(() => undefined));
    const regenerateRecoveryCodes = vi
      .spyOn(hostedHubApi, "regenerateRecoveryCodes")
      .mockResolvedValue(["code"]);
    vi.spyOn(hostedHubApi, "listPasskeys").mockResolvedValue([]);

    void hostedHubController.addPasskey({ passkeyLabel: null });
    expect(hostedAccountStore.getState().actionStatus).toBe("adding-passkey");

    hostedHubController.cancelAccountAction();
    expect(hostedAccountStore.getState()).toMatchObject({
      actionStatus: "idle",
      errorMessage: null,
    });

    // The surface is usable again.
    await hostedHubController.regenerateRecoveryCodes();
    expect(regenerateRecoveryCodes).toHaveBeenCalledOnce();
  });

  it("refuses an account action while signed out with a bounded message", async () => {
    const addPasskey = vi.spyOn(hostedHubApi, "addPasskey");
    await hostedHubController.addPasskey({ passkeyLabel: null });
    expect(addPasskey).not.toHaveBeenCalled();
    expect(hostedAccountStore.getState().errorMessage).toBe(HOSTED_ACCOUNT_SIGNED_OUT_MESSAGE);
  });

  it("surfaces regenerated recovery codes and keeps them out of the account store", async () => {
    await authenticate();
    vi.spyOn(hostedHubApi, "regenerateRecoveryCodes").mockResolvedValue([
      "recovery-sensitive-canary",
    ]);

    await hostedHubController.regenerateRecoveryCodes();

    expect(hostedHubStore.getState().recoveryCodes).toEqual(["recovery-sensitive-canary"]);
    // Codes live only in the dedicated slot: never in the account surface,
    // never in an error message, never in a status.
    expect(JSON.stringify(hostedAccountStore.getState())).not.toContain(
      "recovery-sensitive-canary",
    );

    hostedHubController.dismissRecoveryCodes();
    expect(hostedHubStore.getState().recoveryCodes).toEqual([]);
  });

  it("drops the account surface and any displayed codes when the account clears", async () => {
    await authenticate();
    vi.spyOn(hostedHubApi, "listPasskeys").mockResolvedValue([passkey]);
    vi.spyOn(hostedHubApi, "regenerateRecoveryCodes").mockResolvedValue([
      "recovery-sensitive-canary",
    ]);
    await hostedHubController.refreshPasskeys();
    await hostedHubController.regenerateRecoveryCodes();
    vi.spyOn(hostedHubApi, "signOut").mockResolvedValue();

    await hostedHubController.signOut();

    expect(hostedAccountStore.getState()).toEqual(hostedAccountStore.getInitialState());
    expect(hostedHubStore.getState().recoveryCodes).toEqual([]);
    const persisted = `${JSON.stringify(hostedHubStore.getState())}${JSON.stringify(
      hostedAccountStore.getState(),
    )}`;
    expect(persisted).not.toContain("recovery-sensitive-canary");
    expect(persisted).not.toContain("csrf-sensitive-canary");
  });

  it("fails a read that outlived its session closed, without leaving a spinner", async () => {
    await authenticate();
    vi.spyOn(hostedHubApi, "listPasskeys").mockImplementation(async () => {
      // A session-id rotation that keeps accountStatus "authenticated" — what
      // #resumeBrowser does — so no teardown runs to clean up after this read.
      hostedHubStore.setState({
        session: { ...sessionResponse.session, id: "sess_bbbbbbbbbbbbbbbbbbbbbb" },
      });
      return [passkey];
    });

    await hostedHubController.refreshPasskeys();

    // Never "loading" with nothing in flight: that is a spinner no retry clears.
    expect(hostedAccountStore.getState()).toMatchObject({
      passkeys: [],
      passkeysStatus: "idle",
    });
  });

  it("fails a failed read that outlived its session closed too", async () => {
    await authenticate();
    vi.spyOn(hostedHubApi, "listPasskeys").mockImplementation(async () => {
      hostedHubStore.setState({
        session: { ...sessionResponse.session, id: "sess_bbbbbbbbbbbbbbbbbbbbbb" },
      });
      throw new HostedHubApiError("unavailable", 0);
    });

    await hostedHubController.refreshPasskeys();

    expect(hostedAccountStore.getState()).toMatchObject({
      passkeys: [],
      passkeysStatus: "idle",
    });
  });

  it("routes each credential change to its API method and clears the error on success", async () => {
    await authenticate();
    const setPassword = vi.spyOn(hostedHubApi, "setPassword").mockResolvedValue();
    const removePassword = vi.spyOn(hostedHubApi, "removePassword").mockResolvedValue();
    const confirmTotpEnrollment = vi
      .spyOn(hostedHubApi, "confirmTotpEnrollment")
      .mockResolvedValue();
    const revokeTotp = vi.spyOn(hostedHubApi, "revokeTotp").mockResolvedValue();
    const requestEmailVerification = vi
      .spyOn(hostedHubApi, "requestEmailVerification")
      .mockResolvedValue();
    hostedAccountStore.setState({ errorMessage: "a stale failure from an earlier attempt" });

    await hostedHubController.setPassword({ password: "pw", totpCode: "123456" });
    await hostedHubController.removePassword({ totpCode: "234567" });
    await hostedHubController.confirmTotpEnrollment({ code: "345678" });
    await hostedHubController.revokeTotp({ totpCode: "456789" });
    await hostedHubController.requestEmailVerification({
      email: "ada@example.test",
      totpCode: "567890",
    });

    // The step-up code is threaded through untouched; the runtime never decides
    // whether it is needed, only whether the caller supplied one.
    expect(setPassword).toHaveBeenCalledWith(
      { password: "pw", totpCode: "123456" },
      expect.anything(),
    );
    expect(removePassword).toHaveBeenCalledWith({ totpCode: "234567" }, expect.anything());
    expect(confirmTotpEnrollment).toHaveBeenCalledWith({ code: "345678" }, expect.anything());
    expect(revokeTotp).toHaveBeenCalledWith({ totpCode: "456789" }, expect.anything());
    expect(requestEmailVerification).toHaveBeenCalledWith(
      { email: "ada@example.test", totpCode: "567890" },
      expect.anything(),
    );
    expect(hostedAccountStore.getState()).toMatchObject({
      actionStatus: "idle",
      errorMessage: null,
    });
  });

  it("holds the TOTP enrolment secret in memory only and drops it on dismissal", async () => {
    await authenticate();
    const enrollment = {
      secretBase32: "TOTPSECRETSENSITIVECANARY",
      provisioningUri: "otpauth://totp/Ryco:ada?secret=TOTPSECRETSENSITIVECANARY",
    };
    vi.spyOn(hostedHubApi, "beginTotpEnrollment").mockResolvedValue(enrollment);

    await hostedHubController.beginTotpEnrollment();

    expect(hostedHubStore.getState().totpEnrollment).toEqual(enrollment);
    // The secret lives in exactly ONE slot across both stores. Asserted by
    // blanking that slot and searching everything that is left — an error
    // message, a status, a label, the account surface — rather than by checking
    // the one place a leak was expected.
    const { totpEnrollment: _held, ...restOfHubState } = hostedHubStore.getState();
    expect(
      `${JSON.stringify(restOfHubState)}${JSON.stringify(hostedAccountStore.getState())}`,
    ).not.toContain("TOTPSECRETSENSITIVECANARY");

    hostedHubController.dismissTotpEnrollment();
    expect(hostedHubStore.getState().totpEnrollment).toBeNull();
  });

  it("drops the enrolment secret once the enrolment is confirmed or revoked", async () => {
    await authenticate();
    const enrollment = {
      secretBase32: "TOTPSECRETSENSITIVECANARY",
      provisioningUri: "otpauth://totp/Ryco:ada?secret=TOTPSECRETSENSITIVECANARY",
    };
    vi.spyOn(hostedHubApi, "beginTotpEnrollment").mockResolvedValue(enrollment);
    vi.spyOn(hostedHubApi, "confirmTotpEnrollment").mockResolvedValue();
    vi.spyOn(hostedHubApi, "revokeTotp").mockResolvedValue();

    await hostedHubController.beginTotpEnrollment();
    await hostedHubController.confirmTotpEnrollment({ code: "123456" });
    expect(hostedHubStore.getState().totpEnrollment).toBeNull();

    await hostedHubController.beginTotpEnrollment();
    expect(hostedHubStore.getState().totpEnrollment).toEqual(enrollment);
    await hostedHubController.revokeTotp();
    expect(hostedHubStore.getState().totpEnrollment).toBeNull();
  });

  it("drops the enrolment secret when the account clears", async () => {
    await authenticate();
    vi.spyOn(hostedHubApi, "beginTotpEnrollment").mockResolvedValue({
      secretBase32: "TOTPSECRETSENSITIVECANARY",
      provisioningUri: "otpauth://totp/Ryco:ada?secret=TOTPSECRETSENSITIVECANARY",
    });
    vi.spyOn(hostedHubApi, "signOut").mockResolvedValue();

    await hostedHubController.beginTotpEnrollment();
    await hostedHubController.signOut();

    expect(hostedHubStore.getState().totpEnrollment).toBeNull();
    const persisted = `${JSON.stringify(hostedHubStore.getState())}${JSON.stringify(
      hostedAccountStore.getState(),
    )}`;
    expect(persisted).not.toContain("TOTPSECRETSENSITIVECANARY");
  });

  it("revokes a passkey and confirms the change against a forced fresh read", async () => {
    await authenticate();
    const revoked = { ...passkey, revokedAt: 40, revocationReasonCode: "owner_revoked" } as const;
    const revokePasskey = vi.spyOn(hostedHubApi, "revokePasskey").mockResolvedValue();
    const listPasskeys = vi
      .spyOn(hostedHubApi, "listPasskeys")
      .mockResolvedValueOnce([passkey])
      .mockResolvedValue([revoked]);

    await hostedHubController.refreshPasskeys();
    expect(hostedAccountStore.getState().passkeys).toEqual([passkey]);

    await hostedHubController.revokePasskey(passkey.id);

    expect(revokePasskey).toHaveBeenCalledWith(passkey.id, expect.anything());
    // A revoke changes the list, so it is re-read rather than assumed — and the
    // read is forced, so it cannot join one issued before the revoke.
    expect(listPasskeys).toHaveBeenCalledTimes(2);
    expect(hostedAccountStore.getState()).toMatchObject({
      passkeys: [revoked],
      passkeysStatus: "ready",
      actionStatus: "idle",
      errorMessage: null,
    });
  });

  it("does not re-read the passkey list when a revoke was refused", async () => {
    await authenticate();
    vi.spyOn(hostedHubApi, "revokePasskey").mockRejectedValue(
      new HostedHubApiError("invalid_request", 400),
    );
    const listPasskeys = vi.spyOn(hostedHubApi, "listPasskeys").mockResolvedValue([passkey]);

    await hostedHubController.revokePasskey("pkey_not-a-valid-id");

    expect(listPasskeys).not.toHaveBeenCalled();
    expect(hostedHubStore.getState().accountStatus).toBe("authenticated");
    expect(hostedAccountStore.getState()).toMatchObject({
      actionStatus: "idle",
      errorMessage: "The response was malformed or expired.",
    });
  });

  it("expires the session when a credential change is rejected as unauthenticated", async () => {
    await authenticate();
    vi.spyOn(hostedHubApi, "revokeTotp").mockRejectedValue(
      new HostedHubApiError("session_invalid", 401),
    );

    await expect(hostedHubController.revokeTotp()).resolves.toBeUndefined();

    expect(hostedHubStore.getState().accountStatus).toBe("session-expired");
    expect(hostedAccountStore.getState()).toEqual(hostedAccountStore.getInitialState());
  });

  it("runs one credential change at a time across the whole account surface", async () => {
    await authenticate();
    let release: (() => void) | null = null;
    vi.spyOn(hostedHubApi, "setPassword").mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const revokePasskey = vi.spyOn(hostedHubApi, "revokePasskey").mockResolvedValue();
    const beginTotpEnrollment = vi.spyOn(hostedHubApi, "beginTotpEnrollment").mockResolvedValue({
      secretBase32: "s",
      provisioningUri: "otpauth://totp/Ryco:ada?secret=s",
    });

    const pending = hostedHubController.setPassword({ password: "pw" });
    expect(hostedAccountStore.getState().actionStatus).toBe("setting-password");

    await hostedHubController.revokePasskey(passkey.id);
    await hostedHubController.beginTotpEnrollment();

    expect(revokePasskey).not.toHaveBeenCalled();
    expect(beginTotpEnrollment).not.toHaveBeenCalled();
    expect(hostedHubStore.getState().totpEnrollment).toBeNull();
    expect(hostedAccountStore.getState().errorMessage).toBe(HOSTED_ACCOUNT_BUSY_MESSAGE);

    release?.();
    await pending;
    expect(hostedAccountStore.getState().actionStatus).toBe("idle");
  });

  it("cancels a credential change that never returns", async () => {
    await authenticate();
    vi.spyOn(hostedHubApi, "beginTotpEnrollment").mockImplementation(
      () => new Promise(() => undefined),
    );
    const removePassword = vi.spyOn(hostedHubApi, "removePassword").mockResolvedValue();

    void hostedHubController.beginTotpEnrollment();
    expect(hostedAccountStore.getState().actionStatus).toBe("enrolling-totp");

    hostedHubController.cancelAccountAction();
    expect(hostedAccountStore.getState()).toMatchObject({
      actionStatus: "idle",
      errorMessage: null,
    });
    // Nothing was committed by the abandoned action.
    expect(hostedHubStore.getState().totpEnrollment).toBeNull();

    await hostedHubController.removePassword();
    expect(removePassword).toHaveBeenCalledOnce();
  });

  it("refuses every credential change while signed out with a bounded message", async () => {
    const calls = [
      vi.spyOn(hostedHubApi, "setPassword"),
      vi.spyOn(hostedHubApi, "removePassword"),
      vi.spyOn(hostedHubApi, "beginTotpEnrollment"),
      vi.spyOn(hostedHubApi, "confirmTotpEnrollment"),
      vi.spyOn(hostedHubApi, "revokeTotp"),
      vi.spyOn(hostedHubApi, "requestEmailVerification"),
      vi.spyOn(hostedHubApi, "revokePasskey"),
    ];

    await hostedHubController.setPassword({ password: "pw" });
    await hostedHubController.removePassword();
    await hostedHubController.beginTotpEnrollment();
    await hostedHubController.confirmTotpEnrollment({ code: "123456" });
    await hostedHubController.revokeTotp();
    await hostedHubController.requestEmailVerification({ email: "ada@example.test" });
    await hostedHubController.revokePasskey(passkey.id);

    for (const call of calls) expect(call).not.toHaveBeenCalled();
    expect(hostedAccountStore.getState().errorMessage).toBe(HOSTED_ACCOUNT_SIGNED_OUT_MESSAGE);
  });

  it("threads the step-up code onto a recovery-code rotation", async () => {
    await authenticate();
    const regenerate = vi
      .spyOn(hostedHubApi, "regenerateRecoveryCodes")
      .mockResolvedValue(["fresh"]);

    await hostedHubController.regenerateRecoveryCodes({ totpCode: "123456" });

    expect(regenerate).toHaveBeenCalledWith({ totpCode: "123456" }, expect.anything());
    expect(hostedHubStore.getState().recoveryCodes).toEqual(["fresh"]);
  });
});
