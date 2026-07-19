import type { HostedHubNode, HostedHubSessionResponse } from "./types";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId } from "@ryco/contracts";

const originalDocument = globalThis.document;

const { activateHostedNode, deactivateHostedNode, hasHostedRelayPendingRequests } = vi.hoisted(
  () => ({
    activateHostedNode: vi.fn(
      async (
        _node?: HostedHubNode,
        _previousEnvironmentId?: EnvironmentId | null,
        _signal?: AbortSignal,
      ): Promise<void> => undefined,
    ),
    deactivateHostedNode: vi.fn(async () => undefined),
    hasHostedRelayPendingRequests: vi.fn(() => false),
  }),
);
vi.mock("./environment", () => ({ activateHostedNode, deactivateHostedNode }));
vi.mock("./transport", () => ({ hasHostedRelayPendingRequests }));

import { hostedHubApi, HostedHubApiError } from "./api";
import { hostedHubController, markHostedSessionReady, useHostedHubStore } from "./state";

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

afterEach(() => {
  hostedHubController.resetForTests();
  activateHostedNode.mockClear();
  deactivateHostedNode.mockClear();
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
    expect(useHostedHubStore.getState()).toMatchObject({
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
    expect(useHostedHubStore.getState()).toMatchObject({
      accountStatus: "signed-out",
      bootstrapAvailable: false,
    });
  });

  it("restores a session, signs in, signs out, and expires without exposing credentials", async () => {
    vi.useFakeTimers();
    vi.spyOn(hostedHubApi, "restoreSession").mockResolvedValue(sessionResponse);
    vi.spyOn(hostedHubApi, "listNodes").mockResolvedValue([]);
    await hostedHubController.bootstrap();
    expect(useHostedHubStore.getState()).toMatchObject({
      accountStatus: "authenticated",
      directoryStatus: "ready",
    });

    vi.spyOn(hostedHubApi, "signOut").mockResolvedValue();
    await hostedHubController.signOut();
    expect(useHostedHubStore.getState().accountStatus).toBe("signed-out");
    expect(JSON.stringify(useHostedHubStore.getState())).not.toContain("csrf-sensitive-canary");

    useHostedHubStore.setState({
      accountStatus: "authenticated",
      account: sessionResponse.account,
      session: sessionResponse.session,
    });
    await hostedHubController.expireSession();
    expect(useHostedHubStore.getState()).toMatchObject({
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
    const state = useHostedHubStore.getState();
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
    expect(useHostedHubStore.getState()).toMatchObject({
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
    expect(useHostedHubStore.getState().accountStatus).toBe("authenticated");
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

    useHostedHubStore.setState({ bootstrapAvailable: true });
    await hostedHubController.bootstrapOwner({
      credential: "bootstrap-sensitive-canary",
      displayName: "Ada",
      passkeyLabel: "Primary",
    });

    expect(useHostedHubStore.getState()).toMatchObject({
      accountStatus: "authenticated",
      recoveryCodes: ["recovery-sensitive-canary"],
      bootstrapAvailable: false,
    });
    expect(JSON.stringify(useHostedHubStore.getState())).not.toContain(
      "bootstrap-sensitive-canary",
    );
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

    expect(useHostedHubStore.getState()).toMatchObject({ accountStatus: "signed-out" });
    expect(useHostedHubStore.getState().errorMessage).not.toContain("bootstrap-sensitive-canary");
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
    expect(useHostedHubStore.getState().recoveryCodes).toEqual(["recovery-sensitive-canary"]);
    expect(JSON.stringify(useHostedHubStore.getState())).not.toContain(
      "invitation-sensitive-canary",
    );
    hostedHubController.dismissRecoveryCodes();
    expect(useHostedHubStore.getState().recoveryCodes).toEqual([]);
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
    expect(useHostedHubStore.getState()).toMatchObject({ accountStatus: "signed-out" });
    expect(useHostedHubStore.getState().errorMessage).not.toContain("invitation-sensitive-canary");
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
    expect(JSON.stringify(useHostedHubStore.getState())).not.toContain(
      "invitation-sensitive-canary",
    );
  });

  it("preserves an identity-matched selection and clears it when authorization is removed", async () => {
    vi.useFakeTimers();
    const first = node();
    useHostedHubStore.setState({
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
    expect(useHostedHubStore.getState().selectedNode?.label).toBe("Refreshed");

    vi.mocked(hostedHubApi.listNodes).mockResolvedValue([]);
    await hostedHubController.refreshDirectory();
    expect(deactivateHostedNode).toHaveBeenCalledWith(first.environmentId);
    expect(useHostedHubStore.getState()).toMatchObject({
      selectedNode: null,
      selectionStatus: "authorization-removed",
      effectiveRole: null,
    });
  });

  it("tears down a selected node as soon as the directory marks it revoked", async () => {
    vi.useFakeTimers();
    const selected = node();
    useHostedHubStore.setState({
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
    expect(useHostedHubStore.getState()).toMatchObject({
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
    useHostedHubStore.setState({
      accountStatus: "authenticated",
      directoryStatus: "ready",
      nodes: [selected],
      selectedNode: selected,
      effectiveRole: "operator",
    });
    vi.spyOn(hostedHubApi, "listNodes").mockRejectedValue(new HostedHubApiError("unavailable", 0));
    await hostedHubController.refreshDirectory();
    expect(useHostedHubStore.getState()).toMatchObject({
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
    useHostedHubStore.setState({
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
    useHostedHubStore.setState({
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
    expect(useHostedHubStore.getState()).toMatchObject({
      browserStatus: "suspended",
      sessionStatus: "stale",
    });
    hostedHubController.markSessionReady(selected.environmentId);
    expect(useHostedHubStore.getState().browserStatus).toBe("suspended");

    await hostedHubController.resumeBrowser();
    expect(order).toEqual(["session", "directory", "relay"]);
    expect(useHostedHubStore.getState()).toMatchObject({
      browserStatus: "synchronizing",
      sessionStatus: "synchronizing",
      generation: 5,
    });

    hostedHubController.markSessionReady(selected.environmentId);
    expect(useHostedHubStore.getState()).toMatchObject({
      browserStatus: "current",
      sessionStatus: "ready",
    });
  });

  it("ignores readiness from a superseded hosted connection generation", () => {
    const selected = node();
    useHostedHubStore.setState({
      accountStatus: "authenticated",
      selectedNode: selected,
      transportStatus: "online",
      sessionStatus: "synchronizing",
      sessionEstablished: false,
      browserStatus: "synchronizing",
      generation: 5,
    });

    markHostedSessionReady(selected.environmentId, 4);
    expect(useHostedHubStore.getState()).toMatchObject({
      browserStatus: "synchronizing",
      sessionStatus: "synchronizing",
      sessionEstablished: false,
    });

    markHostedSessionReady(selected.environmentId, 5);
    expect(useHostedHubStore.getState()).toMatchObject({
      browserStatus: "current",
      sessionStatus: "ready",
      sessionEstablished: true,
    });
  });

  it("preserves delivery uncertainty when resume replaces a relay with a pending mutation", async () => {
    const selected = node();
    useHostedHubStore.setState({
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

    expect(useHostedHubStore.getState()).toMatchObject({
      browserStatus: "synchronizing",
      sessionStatus: "delivery-unknown",
      sessionRecoveredAfterUnknown: false,
      generation: 5,
    });
    hostedHubController.markSessionReady(selected.environmentId);
    expect(useHostedHubStore.getState()).toMatchObject({
      browserStatus: "current",
      sessionStatus: "delivery-unknown",
      sessionRecoveredAfterUnknown: true,
    });
  });

  it("preserves resumed delivery uncertainty when synchronization times out", async () => {
    vi.useFakeTimers();
    const selected = node();
    useHostedHubStore.setState({
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

    expect(useHostedHubStore.getState()).toMatchObject({
      transportStatus: "terminal-failure",
      sessionStatus: "delivery-unknown",
      sessionEstablished: false,
      sessionRecoveredAfterUnknown: false,
      errorMessage: "Ryco state could not be synchronized.",
    });
  });

  it("starts a fresh access check when suspension cancels an in-flight resume", async () => {
    useHostedHubStore.setState({
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
    expect(useHostedHubStore.getState()).toMatchObject({
      browserStatus: "current",
      directoryStatus: "ready",
      errorMessage: null,
    });
  });

  it("replaces an in-flight directory refresh with a post-resume access check", async () => {
    useHostedHubStore.setState({
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
    expect(useHostedHubStore.getState()).toMatchObject({
      browserStatus: "current",
      directoryStatus: "ready",
    });
  });

  it("aborts same-node activation when the browser is suspended again", async () => {
    vi.useFakeTimers();
    const selected = node();
    useHostedHubStore.setState({
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
    expect(useHostedHubStore.getState()).toMatchObject({
      browserStatus: "suspended",
      sessionStatus: "stale",
      generation: 5,
    });
    expect(useHostedHubStore.getState().transportStatus).not.toBe("terminal-failure");

    await hostedHubController.resumeBrowser();
    expect(activateHostedNode).toHaveBeenCalledTimes(2);
    expect(useHostedHubStore.getState()).toMatchObject({
      browserStatus: "synchronizing",
      sessionStatus: "synchronizing",
      generation: 6,
    });
  });

  it("restarts full resume after a stale directory retry recovers", async () => {
    vi.useFakeTimers();
    const selected = node();
    useHostedHubStore.setState({
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
    expect(useHostedHubStore.getState()).toMatchObject({
      browserStatus: "stale",
      directoryStatus: "stale",
      effectiveRole: null,
    });

    await hostedHubController.refreshDirectory();
    await vi.waitFor(() => expect(restoreSession).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(activateHostedNode).toHaveBeenCalledOnce());

    expect(listNodes).toHaveBeenCalledTimes(3);
    expect(useHostedHubStore.getState()).toMatchObject({
      browserStatus: "synchronizing",
      directoryStatus: "ready",
      sessionStatus: "synchronizing",
    });
    hostedHubController.markSessionReady(selected.environmentId);
    expect(useHostedHubStore.getState().browserStatus).toBe("current");
  });

  it("switches nodes through the ordered environment teardown boundary", async () => {
    const first = node();
    const second = node("node_bbbbbbbbbbbbbbbbbbbbbb", "owner");
    useHostedHubStore.setState({
      accountStatus: "authenticated",
      directoryStatus: "ready",
      nodes: [first, second],
      selectedNode: first,
      effectiveRole: first.effectiveRole,
    });
    await hostedHubController.selectNode(second.id);
    expect(activateHostedNode).toHaveBeenCalledWith(second, first.environmentId);
    expect(useHostedHubStore.getState()).toMatchObject({
      selectedNode: second,
      sessionStatus: "synchronizing",
      generation: 1,
    });
    hostedHubController.markSessionReplaying(second.environmentId);
    expect(useHostedHubStore.getState().sessionStatus).toBe("replaying");
    hostedHubController.markSessionReady(second.environmentId);
    expect(useHostedHubStore.getState().sessionStatus).toBe("ready");
  });

  it("rejects node selection while browser access is being revalidated", async () => {
    const selected = node();
    useHostedHubStore.setState({
      accountStatus: "authenticated",
      directoryStatus: "ready",
      browserStatus: "checking-access",
      nodes: [selected],
    });

    await hostedHubController.selectNode(selected.id);

    expect(activateHostedNode).not.toHaveBeenCalled();
    expect(useHostedHubStore.getState().selectedNode).toBeNull();
  });

  it("ends browser synchronization after a terminal relay failure", () => {
    const selected = node();
    useHostedHubStore.setState({
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

    expect(useHostedHubStore.getState()).toMatchObject({
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
    useHostedHubStore.setState({
      accountStatus: "authenticated",
      directoryStatus: "ready",
      nodes: [selected],
    });

    await hostedHubController.selectNode(selected.id);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(useHostedHubStore.getState().transportStatus).not.toBe("terminal-failure");

    await vi.advanceTimersByTimeAsync(1);
    expect(useHostedHubStore.getState()).toMatchObject({
      transportStatus: "terminal-failure",
      sessionStatus: "stale",
      sessionEstablished: false,
      errorMessage: "Ryco state could not be synchronized.",
    });
  });

  it("cancels the synchronization deadline after the matching snapshot is ready", async () => {
    vi.useFakeTimers();
    const selected = node();
    useHostedHubStore.setState({
      accountStatus: "authenticated",
      directoryStatus: "ready",
      nodes: [selected],
    });

    await hostedHubController.selectNode(selected.id);
    hostedHubController.markSessionReady(selected.environmentId);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(useHostedHubStore.getState()).toMatchObject({
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
    useHostedHubStore.setState({
      accountStatus: "authenticated",
      directoryStatus: "ready",
      nodes: [first, second],
    });

    await hostedHubController.selectNode(first.id);
    await vi.advanceTimersByTimeAsync(10_000);
    await hostedHubController.selectNode(second.id);
    await vi.advanceTimersByTimeAsync(20_000);

    expect(useHostedHubStore.getState()).toMatchObject({
      selectedNode: second,
      sessionStatus: "synchronizing",
      errorMessage: null,
    });

    await vi.advanceTimersByTimeAsync(10_000);
    expect(useHostedHubStore.getState()).toMatchObject({
      selectedNode: second,
      transportStatus: "terminal-failure",
      errorMessage: "Ryco state could not be synchronized.",
    });
  });

  it("retries the selected node once with a fresh generation", async () => {
    const selected = node();
    useHostedHubStore.setState({
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
    expect(useHostedHubStore.getState()).toMatchObject({
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
    useHostedHubStore.setState({
      accountStatus: "authenticated",
      selectedNode: selected,
      transportStatus: "online",
      sessionStatus: "synchronizing",
      sessionEstablished: false,
      generation: 3,
    });

    hostedHubController.reportShellSnapshotFailure(selected.environmentId);
    expect(useHostedHubStore.getState()).toMatchObject({
      transportStatus: "terminal-failure",
      errorMessage: "Ryco state could not be synchronized.",
    });

    useHostedHubStore.setState({
      transportStatus: "online",
      sessionStatus: "ready",
      sessionEstablished: true,
      errorMessage: null,
    });
    hostedHubController.reportShellSnapshotFailure(selected.environmentId);
    expect(useHostedHubStore.getState()).toMatchObject({
      transportStatus: "online",
      sessionStatus: "ready",
      errorMessage: null,
    });
    expect(warning).toHaveBeenCalledWith("hosted_snapshot_reconciliation_failed");
  });

  it("keeps delivery uncertainty visible through replay until the user acknowledges it", () => {
    const selected = node();
    useHostedHubStore.setState({
      accountStatus: "authenticated",
      selectedNode: selected,
      transportStatus: "online",
      sessionStatus: "ready",
      generation: 7,
    });
    hostedHubController.markDeliveryUnknown(7);
    hostedHubController.sessionStatus(7, "synchronizing");
    hostedHubController.markSessionReplaying(selected.environmentId);
    expect(useHostedHubStore.getState()).toMatchObject({
      sessionStatus: "delivery-unknown",
      sessionRecoveredAfterUnknown: false,
    });

    hostedHubController.markSessionReady(selected.environmentId);
    expect(useHostedHubStore.getState()).toMatchObject({
      sessionStatus: "delivery-unknown",
      sessionRecoveredAfterUnknown: true,
    });
    hostedHubController.acknowledgeDeliveryUnknown();
    expect(useHostedHubStore.getState()).toMatchObject({
      sessionStatus: "ready",
      sessionRecoveredAfterUnknown: false,
    });
  });
});
