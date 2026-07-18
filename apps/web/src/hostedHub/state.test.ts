import type { HostedHubNode, HostedHubSessionResponse } from "./types";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId } from "@ryco/contracts";

const originalDocument = globalThis.document;

const { activateHostedNode, deactivateHostedNode } = vi.hoisted(() => ({
  activateHostedNode: vi.fn(async () => undefined),
  deactivateHostedNode: vi.fn(async () => undefined),
}));
vi.mock("./environment", () => ({ activateHostedNode, deactivateHostedNode }));

import { hostedHubApi, HostedHubApiError } from "./api";
import { hostedHubController, useHostedHubStore } from "./state";

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
