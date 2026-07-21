import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId } from "@ryco/contracts";

import type { HostedHubNode, HostedHubSessionResponse } from "./types";
import { createFakeHistoryWindow, type FakeHistoryWindow } from "../../test/fakeHistoryWindow";

const {
  activateHostedNode,
  deactivateHostedNode,
  suspendHostedNode,
  hasHostedRelayPendingRequests,
  resetHostedRelayAttemptFactory,
} = vi.hoisted(() => ({
  activateHostedNode: vi.fn(
    async (
      _node?: HostedHubNode,
      _previousEnvironmentId?: EnvironmentId | null,
      _signal?: AbortSignal,
    ): Promise<void> => undefined,
  ),
  deactivateHostedNode: vi.fn(async () => undefined),
  suspendHostedNode: vi.fn(async () => undefined),
  hasHostedRelayPendingRequests: vi.fn(() => false),
  resetHostedRelayAttemptFactory: vi.fn(),
}));
vi.mock("./environment", () => ({ activateHostedNode, deactivateHostedNode, suspendHostedNode }));
vi.mock("./transport", () => ({ hasHostedRelayPendingRequests, resetHostedRelayAttemptFactory }));

import { hostedHubApi, HostedHubApiError } from "./api";
import {
  HOSTED_SESSION_SYNC_FAILURE_MESSAGE,
  hostedHubController,
  useHostedHubStore,
} from "./state";
import {
  getRoutedHostedNode,
  installHostedNodeHistory,
  resetHostedNodeRoutesForTests,
} from "./nodeRoutes";
import {
  getHostedNodeRouteNotice,
  resetHostedNodeRouteOrchestratorForTests,
  selectHostedNodeRoute,
  startHostedNodeRouteOrchestrator,
} from "./nodeRouteOrchestrator";

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
  csrfToken: "csrf-sensitive-route-canary",
};

function node(
  id = "node_aaaaaaaaaaaaaaaaaaaaaa",
  overrides: Partial<HostedHubNode> = {},
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
    grant: { id: `grant_${id.slice(5)}`, role: "operator" },
    effectiveRole: "operator",
    presence: { online: true, lastHeartbeatAt: 1 },
    ...overrides,
  };
}

let stopOrchestrator: (() => void) | null = null;

function setup(initialUrl: string): { win: FakeHistoryWindow; flush: () => void } {
  const win = createFakeHistoryWindow(initialUrl);
  const history = installHostedNodeHistory(win as unknown as Window & typeof globalThis);
  stopOrchestrator = startHostedNodeRouteOrchestrator();
  return { win, flush: () => history.flush() };
}

afterEach(() => {
  stopOrchestrator?.();
  stopOrchestrator = null;
  resetHostedNodeRouteOrchestratorForTests();
  resetHostedNodeRoutesForTests();
  hostedHubController.resetForTests();
  vi.useRealTimers();
  vi.restoreAllMocks();
  activateHostedNode.mockClear();
  deactivateHostedNode.mockClear();
  suspendHostedNode.mockClear();
  hasHostedRelayPendingRequests.mockClear();
  resetHostedRelayAttemptFactory.mockClear();
});

describe("hosted node route restore pipeline", () => {
  it("restores a routed node strictly through session, directory, and activation", async () => {
    const target = node();
    const restoreSession = vi
      .spyOn(hostedHubApi, "restoreSession")
      .mockResolvedValue(sessionResponse);
    const listNodes = vi.spyOn(hostedHubApi, "listNodes").mockResolvedValue([target]);
    const { win, flush } = setup(
      `/node/${target.id}/${target.environmentId}/t_1?workspaceTab=diff`,
    );

    await hostedHubController.bootstrap();
    await vi.waitFor(() => expect(activateHostedNode).toHaveBeenCalledOnce());
    flush();

    expect(restoreSession.mock.invocationCallOrder[0]!).toBeLessThan(
      listNodes.mock.invocationCallOrder[0]!,
    );
    expect(listNodes.mock.invocationCallOrder[0]!).toBeLessThan(
      activateHostedNode.mock.invocationCallOrder[0]!,
    );
    const state = useHostedHubStore.getState();
    expect(state.selectedNode?.id).toBe(target.id);
    expect(state.sessionStatus).toBe("synchronizing");
    // Mutation readiness stays gated behind the existing sync pipeline.
    expect(state.sessionEstablished).toBe(false);
    // Deep-linked thread and panel state survive the restore untouched.
    expect(win.location.pathname).toBe(`/node/${target.id}/${target.environmentId}/t_1`);
    expect(win.location.search).toBe("?workspaceTab=diff");
    expect(getHostedNodeRouteNotice()).toBeNull();
  });

  it("fails closed to the directory when the routed node is absent", async () => {
    vi.spyOn(hostedHubApi, "restoreSession").mockResolvedValue(sessionResponse);
    vi.spyOn(hostedHubApi, "listNodes").mockResolvedValue([]);
    const { win, flush } = setup("/node/node_gone");

    await hostedHubController.bootstrap();
    flush();

    expect(activateHostedNode).not.toHaveBeenCalled();
    expect(useHostedHubStore.getState().selectedNode).toBeNull();
    expect(getRoutedHostedNode().nodeId).toBeNull();
    expect(win.location.pathname).toBe("/");
    expect(getHostedNodeRouteNotice()).toMatch(/not in your authorized node directory/);
  });

  it("fails closed when the routed node grant is revoked", async () => {
    const revoked = node("node_aaaaaaaaaaaaaaaaaaaaaa", { revokedAt: 2 });
    vi.spyOn(hostedHubApi, "restoreSession").mockResolvedValue(sessionResponse);
    vi.spyOn(hostedHubApi, "listNodes").mockResolvedValue([revoked]);
    const { win, flush } = setup(`/node/${revoked.id}`);

    await hostedHubController.bootstrap();
    flush();

    expect(activateHostedNode).not.toHaveBeenCalled();
    expect(win.location.pathname).toBe("/");
    expect(getHostedNodeRouteNotice()).toMatch(/was revoked/);
  });

  it("fails a routed offline node closed while interactive selection still connects", async () => {
    const offline = node("node_aaaaaaaaaaaaaaaaaaaaaa", {
      presence: { online: false, lastHeartbeatAt: null },
    });
    vi.spyOn(hostedHubApi, "restoreSession").mockResolvedValue(sessionResponse);
    vi.spyOn(hostedHubApi, "listNodes").mockResolvedValue([offline]);
    const { win, flush } = setup(`/node/${offline.id}`);

    await hostedHubController.bootstrap();
    flush();
    expect(activateHostedNode).not.toHaveBeenCalled();
    expect(win.location.pathname).toBe("/");
    expect(getHostedNodeRouteNotice()).toMatch(/is offline/);

    // The directory keeps its existing behavior: an explicit tap on an
    // offline node still attempts the connection with bounded retries.
    expect(selectHostedNodeRoute(offline.id)).toBe(true);
    await vi.waitFor(() => expect(activateHostedNode).toHaveBeenCalledOnce());
    flush();
    expect(useHostedHubStore.getState().selectedNode?.id).toBe(offline.id);
    expect(win.location.pathname).toBe(`/node/${offline.id}`);
    expect(getHostedNodeRouteNotice()).toBeNull();
  });

  it("normalizes malformed node routes fail-closed before authentication", async () => {
    vi.spyOn(hostedHubApi, "restoreSession").mockRejectedValue(
      new HostedHubApiError("session_invalid", 401),
    );
    vi.spyOn(hostedHubApi, "getBootstrapAvailability").mockResolvedValue(false);
    const { win, flush } = setup("/node/a%20b/env_a/t_1");

    await hostedHubController.bootstrap();
    flush();

    expect(useHostedHubStore.getState().accountStatus).toBe("signed-out");
    expect(win.location.pathname).toBe("/");
    expect(getRoutedHostedNode()).toEqual({ nodeId: null, malformed: false });
    expect(getHostedNodeRouteNotice()).toMatch(/link is not valid/);
    expect(activateHostedNode).not.toHaveBeenCalled();
  });

  it("fails closed to the directory when the directory is stale", async () => {
    vi.spyOn(hostedHubApi, "restoreSession").mockResolvedValue(sessionResponse);
    vi.spyOn(hostedHubApi, "listNodes").mockRejectedValue(
      new HostedHubApiError("unavailable", 503),
    );
    const { win, flush } = setup("/node/node_aaaaaaaaaaaaaaaaaaaaaa");

    await hostedHubController.bootstrap();
    flush();

    expect(useHostedHubStore.getState().directoryStatus).toBe("stale");
    expect(activateHostedNode).not.toHaveBeenCalled();
    expect(win.location.pathname).toBe("/");
    expect(getHostedNodeRouteNotice()).toMatch(/not in your authorized node directory/);
  });

  it("redirects legacy thread URLs to the node-scoped shape in place", async () => {
    const target = node();
    vi.spyOn(hostedHubApi, "restoreSession").mockResolvedValue(sessionResponse);
    vi.spyOn(hostedHubApi, "listNodes").mockResolvedValue([target]);
    const { win, flush } = setup(`/${target.environmentId}/t_1?workspaceTab=diff`);

    await hostedHubController.bootstrap();
    await vi.waitFor(() => expect(activateHostedNode).toHaveBeenCalledOnce());
    flush();

    expect(win.entries()).toHaveLength(1);
    expect(win.location.pathname).toBe(`/node/${target.id}/${target.environmentId}/t_1`);
    expect(win.location.search).toBe("?workspaceTab=diff");
    expect(useHostedHubStore.getState().selectedNode?.id).toBe(target.id);
  });

  it("redirects unrestorable legacy URLs to the directory", async () => {
    const target = node();
    vi.spyOn(hostedHubApi, "restoreSession").mockResolvedValue(sessionResponse);
    vi.spyOn(hostedHubApi, "listNodes").mockResolvedValue([target]);
    const { win, flush } = setup("/env_zzzzzzzzzzzzzzzzzzzzzz/t_1");

    await hostedHubController.bootstrap();
    flush();

    expect(activateHostedNode).not.toHaveBeenCalled();
    expect(win.location.pathname).toBe("/");
    expect(getHostedNodeRouteNotice()).toMatch(/not in your authorized node directory/);
  });

  it("redirects legacy draft URLs to the directory without a notice", async () => {
    vi.spyOn(hostedHubApi, "restoreSession").mockResolvedValue(sessionResponse);
    vi.spyOn(hostedHubApi, "listNodes").mockResolvedValue([node()]);
    const { win, flush } = setup("/draft/draft-1");

    await hostedHubController.bootstrap();
    flush();

    expect(win.location.pathname).toBe("/");
    expect(getHostedNodeRouteNotice()).toBeNull();
    expect(activateHostedNode).not.toHaveBeenCalled();
  });

  it("keeps the routed segment through session expiry and resumes after re-authentication", async () => {
    const target = node();
    vi.spyOn(hostedHubApi, "restoreSession").mockRejectedValue(
      new HostedHubApiError("session_invalid", 401),
    );
    vi.spyOn(hostedHubApi, "getBootstrapAvailability").mockResolvedValue(false);
    const listNodes = vi.spyOn(hostedHubApi, "listNodes").mockResolvedValue([target]);
    const { win, flush } = setup(`/node/${target.id}/${target.environmentId}/t_1`);

    await hostedHubController.bootstrap();
    flush();
    expect(useHostedHubStore.getState().accountStatus).toBe("signed-out");
    expect(activateHostedNode).not.toHaveBeenCalled();
    // The routed node survives the authentication surface in the URL only.
    expect(win.location.pathname).toBe(`/node/${target.id}/${target.environmentId}/t_1`);

    const signIn = vi.spyOn(hostedHubApi, "signIn").mockResolvedValue(sessionResponse);
    await hostedHubController.signIn();
    await vi.waitFor(() => expect(activateHostedNode).toHaveBeenCalledOnce());
    flush();

    expect(signIn.mock.invocationCallOrder[0]!).toBeLessThan(
      listNodes.mock.invocationCallOrder.at(-1)!,
    );
    expect(useHostedHubStore.getState().selectedNode?.id).toBe(target.id);
    expect(win.location.pathname).toBe(`/node/${target.id}/${target.environmentId}/t_1`);
  });

  it("tears the selection down on Back and re-runs the pipeline on Forward", async () => {
    const target = node();
    vi.spyOn(hostedHubApi, "restoreSession").mockResolvedValue(sessionResponse);
    vi.spyOn(hostedHubApi, "listNodes").mockResolvedValue([target]);
    const { win, flush } = setup("/");

    await hostedHubController.bootstrap();
    expect(selectHostedNodeRoute(target.id)).toBe(true);
    await vi.waitFor(() => expect(activateHostedNode).toHaveBeenCalledOnce());
    flush();
    expect(win.location.pathname).toBe(`/node/${target.id}`);
    useHostedHubStore.setState({
      transportStatus: "online",
      sessionStatus: "ready",
      sessionEstablished: true,
    });
    const generationBefore = useHostedHubStore.getState().generation;

    win.history.back();
    await vi.waitFor(() => expect(deactivateHostedNode).toHaveBeenCalledWith(target.environmentId));
    flush();
    const afterBack = useHostedHubStore.getState();
    expect(afterBack.selectedNode).toBeNull();
    expect(afterBack.selectionStatus).toBe("none");
    expect(afterBack.transportStatus).toBe("idle");
    expect(afterBack.sessionStatus).toBe("closed");
    expect(afterBack.generation).toBeGreaterThan(generationBefore);
    expect(win.location.pathname).toBe("/");

    win.history.forward();
    await vi.waitFor(() => expect(activateHostedNode).toHaveBeenCalledTimes(2));
    flush();
    expect(useHostedHubStore.getState().selectedNode?.id).toBe(target.id);
    expect(useHostedHubStore.getState().sessionEstablished).toBe(false);
    expect(win.location.pathname).toBe(`/node/${target.id}`);
  });

  it("returns a URL-restored terminal authorization failure to the directory", async () => {
    const target = node();
    vi.spyOn(hostedHubApi, "restoreSession").mockResolvedValue(sessionResponse);
    vi.spyOn(hostedHubApi, "listNodes").mockResolvedValue([target]);
    const { win, flush } = setup(`/node/${target.id}`);

    await hostedHubController.bootstrap();
    await vi.waitFor(() => expect(activateHostedNode).toHaveBeenCalledOnce());

    hostedHubController.failure(useHostedHubStore.getState().generation, {
      kind: "incompatible",
      retryable: false,
    });
    await vi.waitFor(() => expect(deactivateHostedNode).toHaveBeenCalledWith(target.environmentId));
    flush();

    const state = useHostedHubStore.getState();
    expect(state.selectedNode).toBeNull();
    // The directory renders its existing bounded incompatibility alert.
    expect(state.selectionStatus).toBe("incompatible");
    expect(getHostedNodeRouteNotice()).toBeNull();
    expect(win.location.pathname).toBe("/");
  });

  it("keeps interactive terminal failures on the existing failure surface", async () => {
    const target = node();
    vi.spyOn(hostedHubApi, "restoreSession").mockResolvedValue(sessionResponse);
    vi.spyOn(hostedHubApi, "listNodes").mockResolvedValue([target]);
    const { win, flush } = setup("/");

    await hostedHubController.bootstrap();
    expect(selectHostedNodeRoute(target.id)).toBe(true);
    await vi.waitFor(() => expect(activateHostedNode).toHaveBeenCalledOnce());

    hostedHubController.failure(useHostedHubStore.getState().generation, {
      kind: "incompatible",
      retryable: false,
    });
    flush();

    const state = useHostedHubStore.getState();
    expect(state.selectedNode?.id).toBe(target.id);
    expect(state.transportStatus).toBe("terminal-failure");
    expect(state.selectionStatus).toBe("incompatible");
    expect(win.location.pathname).toBe(`/node/${target.id}`);
  });

  it("keeps the bounded synchronization-timeout surface for a restored node", async () => {
    vi.useFakeTimers();
    const target = node();
    vi.spyOn(hostedHubApi, "restoreSession").mockResolvedValue(sessionResponse);
    vi.spyOn(hostedHubApi, "listNodes").mockResolvedValue([target]);
    const { win, flush } = setup(`/node/${target.id}`);

    await hostedHubController.bootstrap();
    await vi.waitFor(() => expect(activateHostedNode).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(30_000);
    flush();

    const state = useHostedHubStore.getState();
    expect(state.selectedNode?.id).toBe(target.id);
    expect(state.transportStatus).toBe("terminal-failure");
    expect(state.errorMessage).toBe(HOSTED_SESSION_SYNC_FAILURE_MESSAGE);
    // Sync timeouts keep the retryable failure surface; no directory fallback.
    expect(win.location.pathname).toBe(`/node/${target.id}`);
  });

  it("clears the routed segment when a connected node loses authorization", async () => {
    const target = node();
    vi.spyOn(hostedHubApi, "restoreSession").mockResolvedValue(sessionResponse);
    const listNodes = vi.spyOn(hostedHubApi, "listNodes").mockResolvedValue([target]);
    const { win, flush } = setup(`/node/${target.id}`);

    await hostedHubController.bootstrap();
    await vi.waitFor(() => expect(activateHostedNode).toHaveBeenCalledOnce());
    useHostedHubStore.setState({
      transportStatus: "online",
      sessionStatus: "ready",
      sessionEstablished: true,
    });

    listNodes.mockResolvedValue([node(target.id, { revokedAt: 5 })]);
    await hostedHubController.refreshDirectory();
    await vi.waitFor(() => expect(useHostedHubStore.getState().selectedNode).toBeNull());
    flush();

    expect(useHostedHubStore.getState().selectionStatus).toBe("revoked");
    // The existing revocation alert explains the fallback; no duplicate notice.
    expect(getHostedNodeRouteNotice()).toBeNull();
    expect(win.location.pathname).toBe("/");
  });

  it("keeps session, ticket, and credential material out of URLs and history entries", async () => {
    const target = node();
    vi.spyOn(hostedHubApi, "restoreSession").mockResolvedValue(sessionResponse);
    vi.spyOn(hostedHubApi, "listNodes").mockResolvedValue([target]);
    const { win, flush } = setup("/");

    await hostedHubController.bootstrap();
    expect(selectHostedNodeRoute(target.id)).toBe(true);
    await vi.waitFor(() => expect(activateHostedNode).toHaveBeenCalledOnce());
    flush();
    win.history.back();
    await vi.waitFor(() => expect(deactivateHostedNode).toHaveBeenCalledWith(target.environmentId));
    win.history.forward();
    await vi.waitFor(() => expect(activateHostedNode).toHaveBeenCalledTimes(2));
    flush();

    const serializedEntries = JSON.stringify(win.entries());
    for (const sensitive of [
      sessionResponse.csrfToken,
      sessionResponse.session.id,
      sessionResponse.account.id,
    ]) {
      expect(serializedEntries).not.toContain(sensitive);
      expect(win.location.href).not.toContain(sensitive);
    }
    for (const entry of win.entries()) {
      const keys = Object.keys((entry.state ?? {}) as Record<string, unknown>);
      expect(
        keys.every((key) => key === "__TSR_index" || key === "__TSR_key" || key === "key"),
      ).toBe(true);
    }
  });
});
