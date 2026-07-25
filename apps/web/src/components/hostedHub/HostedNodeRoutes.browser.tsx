import "../../index.css";

import { EnvironmentId } from "@ryco/contracts";
import { page } from "vite-plus/test/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { render } from "vitest-browser-react";

const navigate = vi.fn(async () => undefined);
// These suites render the hosted root outside a `RouterProvider`. The toast
// host the entry surfaces now mount reads route params to scope thread-scoped
// toasts, which is neither what these suites exercise nor reachable here, so
// the read is stubbed alongside the navigation that was already stubbed.
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => navigate,
  useParams: () => undefined,
}));

import { hostedHubController, useHostedHubStore } from "../../hostedHub/state";
import {
  installHostedNodeHistory,
  resetHostedNodeRoutesForTests,
} from "../../hostedHub/nodeRoutes";
import { resetHostedNodeRouteOrchestratorForTests } from "../../hostedHub/nodeRouteOrchestrator";
import type { HostedHubNode } from "../../hostedHub/types";
import { createFakeHistoryWindow, type FakeHistoryWindow } from "../../../test/fakeHistoryWindow";
import { HostedHubRoot } from "./HostedHubRoot";

const account = {
  id: "acct_sensitive-route-browser-canary",
  displayName: "Ada",
  role: "owner" as const,
  createdAt: 1,
  disabledAt: null,
};
const session = {
  id: "sess_sensitive-route-browser-canary",
  accountId: account.id,
  createdAt: 1,
  expiresAt: 2,
  lastSeenAt: 1,
  revokedAt: null,
  revocationReasonCode: null,
};

function node(id: string, online = true): HostedHubNode {
  return {
    id,
    environmentId: EnvironmentId.make(`env_${id.slice(5).padEnd(22, "a").slice(0, 22)}`),
    label: "Studio online",
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
    presence: { online, lastHeartbeatAt: online ? 1 : null },
  };
}

let mounted: Awaited<ReturnType<typeof render>> | null = null;
let fakeWindow: FakeHistoryWindow | null = null;

function installRoute(initialUrl: string): FakeHistoryWindow {
  fakeWindow = createFakeHistoryWindow(initialUrl);
  installHostedNodeHistory(fakeWindow as unknown as Window & typeof globalThis);
  return fakeWindow;
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  hostedHubController.resetForTests();
  resetHostedNodeRouteOrchestratorForTests();
  resetHostedNodeRoutesForTests();
  navigate.mockClear();
});

afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  hostedHubController.resetForTests();
  resetHostedNodeRouteOrchestratorForTests();
  resetHostedNodeRoutesForTests();
  fakeWindow = null;
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("hosted node route surfaces", () => {
  it("keeps a routed node on the blocked restoring surface instead of the directory", async () => {
    const target = node("node_aaaaaaaaaaaaaaaaaaaaaa");
    installRoute(`/node/${target.id}/${target.environmentId}/t_1?workspaceTab=diff`);
    const selectNode = vi
      .spyOn(hostedHubController, "selectNode")
      .mockImplementation(async (nodeId: string) => {
        const found = useHostedHubStore.getState().nodes.find((entry) => entry.id === nodeId);
        useHostedHubStore.setState({
          selectedNode: found ?? null,
          selectionStatus: "online",
          sessionStatus: "synchronizing",
          sessionEstablished: false,
        });
      });
    useHostedHubStore.setState({
      accountStatus: "authenticated",
      account,
      session,
      directoryStatus: "loading",
      nodes: [],
    });
    mounted = await render(<HostedHubRoot />);

    await expect.element(page.getByRole("heading", { name: "Restoring your node" })).toBeVisible();
    await expect.element(page.getByRole("status")).toHaveTextContent(/Checking your access/);
    expect(document.body.textContent).not.toContain("Your nodes");
    expect(selectNode).not.toHaveBeenCalled();

    useHostedHubStore.setState({ directoryStatus: "ready", nodes: [target] });
    await expect
      .element(page.getByRole("heading", { name: `Connecting to ${target.label}` }))
      .toBeVisible();
    expect(selectNode).toHaveBeenCalledWith(target.id);
    // The deep-linked thread and panel URL is untouched by the restore.
    expect(fakeWindow!.location.pathname).toBe(`/node/${target.id}/${target.environmentId}/t_1`);
    expect(fakeWindow!.location.search).toBe("?workspaceTab=diff");
  });

  it("fails an unknown routed node closed to the directory with a bounded explanation", async () => {
    const other = node("node_bbbbbbbbbbbbbbbbbbbbbb");
    installRoute("/node/node_gone");
    const selectNode = vi.spyOn(hostedHubController, "selectNode").mockResolvedValue();
    useHostedHubStore.setState({
      accountStatus: "authenticated",
      account,
      session,
      directoryStatus: "ready",
      nodes: [other],
    });
    mounted = await render(<HostedHubRoot />);

    await expect.element(page.getByRole("heading", { name: /^Your nodes?$/ })).toBeVisible();
    await expect
      .element(page.getByRole("alert"))
      .toHaveTextContent(/not in your authorized node directory/);
    expect(selectNode).not.toHaveBeenCalled();
    expect(fakeWindow!.location.pathname).toBe("/");
  });

  it("normalizes a malformed node route to the directory with a bounded explanation", async () => {
    installRoute("/node/a%20b/env_a/t_1");
    useHostedHubStore.setState({
      accountStatus: "authenticated",
      account,
      session,
      directoryStatus: "ready",
      nodes: [node("node_aaaaaaaaaaaaaaaaaaaaaa")],
    });
    mounted = await render(<HostedHubRoot />);

    await expect.element(page.getByRole("heading", { name: /^Your nodes?$/ })).toBeVisible();
    await expect.element(page.getByRole("alert")).toHaveTextContent(/link is not valid/);
    expect(fakeWindow!.location.pathname).toBe("/");
  });

  it("selects a node by navigating into its node-scoped route", async () => {
    const target = node("node_aaaaaaaaaaaaaaaaaaaaaa");
    installRoute("/");
    const selectNode = vi
      .spyOn(hostedHubController, "selectNode")
      .mockImplementation(async (nodeId: string) => {
        const found = useHostedHubStore.getState().nodes.find((entry) => entry.id === nodeId);
        useHostedHubStore.setState({
          selectedNode: found ?? null,
          selectionStatus: "online",
          sessionStatus: "synchronizing",
          sessionEstablished: false,
        });
      });
    useHostedHubStore.setState({
      accountStatus: "authenticated",
      account,
      session,
      directoryStatus: "ready",
      nodes: [target],
    });
    mounted = await render(<HostedHubRoot />);

    await page.getByRole("button", { name: /Studio online/ }).click();
    expect(selectNode).toHaveBeenCalledWith(target.id);
    await expect
      .element(page.getByRole("heading", { name: `Connecting to ${target.label}` }))
      .toBeVisible();
    expect(fakeWindow!.location.pathname).toBe(`/node/${target.id}`);
    expect(fakeWindow!.entries()).toHaveLength(2);
    // Selection is never persisted outside the URL.
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("returns to the directory when history navigates back from a node route", async () => {
    const target = node("node_aaaaaaaaaaaaaaaaaaaaaa");
    installRoute("/");
    vi.spyOn(hostedHubController, "selectNode").mockImplementation(async (nodeId: string) => {
      const found = useHostedHubStore.getState().nodes.find((entry) => entry.id === nodeId);
      useHostedHubStore.setState({
        selectedNode: found ?? null,
        selectionStatus: "online",
        sessionStatus: "synchronizing",
        sessionEstablished: false,
      });
    });
    useHostedHubStore.setState({
      accountStatus: "authenticated",
      account,
      session,
      directoryStatus: "ready",
      nodes: [target],
    });
    mounted = await render(<HostedHubRoot />);
    await page.getByRole("button", { name: /Studio online/ }).click();
    await expect
      .element(page.getByRole("heading", { name: `Connecting to ${target.label}` }))
      .toBeVisible();

    fakeWindow!.history.back();
    await expect.element(page.getByRole("heading", { name: /^Your nodes?$/ })).toBeVisible();
    await vi.waitFor(() => expect(useHostedHubStore.getState().selectedNode).toBeNull());
    expect(useHostedHubStore.getState().selectionStatus).toBe("none");
    expect(fakeWindow!.location.pathname).toBe("/");
  });

  it("keeps session and account material out of the URL, history, and browser storage", async () => {
    const target = node("node_aaaaaaaaaaaaaaaaaaaaaa");
    installRoute("/");
    vi.spyOn(hostedHubController, "selectNode").mockImplementation(async (nodeId: string) => {
      const found = useHostedHubStore.getState().nodes.find((entry) => entry.id === nodeId);
      useHostedHubStore.setState({
        selectedNode: found ?? null,
        selectionStatus: "online",
        sessionStatus: "synchronizing",
        sessionEstablished: false,
      });
    });
    useHostedHubStore.setState({
      accountStatus: "authenticated",
      account,
      session,
      directoryStatus: "ready",
      nodes: [target],
    });
    mounted = await render(<HostedHubRoot />);
    await page.getByRole("button", { name: /Studio online/ }).click();
    await expect
      .element(page.getByRole("heading", { name: `Connecting to ${target.label}` }))
      .toBeVisible();

    const serializedEntries = JSON.stringify(fakeWindow!.entries());
    for (const sensitive of ["sensitive-route-browser-canary", account.id, session.id]) {
      expect(fakeWindow!.location.href).not.toContain(sensitive);
      expect(serializedEntries).not.toContain(sensitive);
      expect(location.href).not.toContain(sensitive);
      expect(JSON.stringify(localStorage)).not.toContain(sensitive);
      expect(JSON.stringify(sessionStorage)).not.toContain(sensitive);
    }
  });
});
