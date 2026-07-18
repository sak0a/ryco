import "../../index.css";

import { EnvironmentId } from "@ryco/contracts";
import { page } from "vite-plus/test/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { render } from "vitest-browser-react";

const navigate = vi.fn(async () => undefined);
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => navigate,
}));

import { hostedHubController, useHostedHubStore } from "../../hostedHub/state";
import { hostedHubApi, HostedHubApiError } from "../../hostedHub/api";
import type { HostedHubNode } from "../../hostedHub/types";
import { HostedHubRoot, HostedNodeMenu } from "./HostedHubRoot";

const account = {
  id: "acct_aaaaaaaaaaaaaaaaaaaaaa",
  displayName: "Ada",
  role: "owner" as const,
  createdAt: 1,
  disabledAt: null,
};
const session = {
  id: "sess_aaaaaaaaaaaaaaaaaaaaaa",
  accountId: account.id,
  createdAt: 1,
  expiresAt: 2,
  lastSeenAt: 1,
  revokedAt: null,
  revocationReasonCode: null,
};

function node(id: string, online: boolean, role: "viewer" | "operator" | "owner"): HostedHubNode {
  return {
    id,
    environmentId: EnvironmentId.make(`env_${id.slice(5).padEnd(22, "a").slice(0, 22)}`),
    label: online ? "Studio online" : "Travel offline",
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
    presence: { online, lastHeartbeatAt: online ? 1 : null },
  };
}

let mounted: Awaited<ReturnType<typeof render>> | null = null;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  hostedHubController.resetForTests();
  navigate.mockClear();
});

afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  hostedHubController.resetForTests();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("HostedHubRoot accessibility and responsive flows", () => {
  it("provides keyboard-labelled authentication and registration controls with focus management", async () => {
    useHostedHubStore.setState({ bootstrapAvailable: true });
    mounted = await render(<HostedHubRoot />);
    await expect
      .element(page.getByRole("heading", { name: "Connect to your Ryco nodes" }))
      .toBeVisible();
    await expect.element(page.getByRole("button", { name: "Sign in with passkey" })).toBeVisible();

    await page.getByRole("button", { name: "Redeem invitation" }).click();
    await expect.element(page.getByLabelText("Invitation code")).toBeVisible();
    await expect
      .element(page.getByLabelText("Invitation code"))
      .toHaveAttribute("type", "password");
    await expect.element(page.getByLabelText("Display name")).toBeVisible();
    await expect.element(page.getByLabelText(/Passkey label/)).toBeVisible();
    await expect.element(page.getByLabelText("Invitation code")).toHaveFocus();

    await page.getByRole("button", { name: "Back" }).click();
    await page.getByRole("button", { name: "Set up first owner" }).click();
    await expect.element(page.getByLabelText("Bootstrap credential")).toBeVisible();
    await expect
      .element(page.getByLabelText("Bootstrap credential"))
      .toHaveAttribute("type", "password");
    await expect.element(page.getByLabelText("Bootstrap credential")).toHaveFocus();
  });

  it("submits first-owner bootstrap without retaining its credential in the form", async () => {
    const bootstrapOwner = vi.spyOn(hostedHubController, "bootstrapOwner").mockResolvedValue();
    useHostedHubStore.setState({ bootstrapAvailable: true });
    mounted = await render(<HostedHubRoot />);

    await page.getByRole("button", { name: "Set up first owner" }).click();
    await page.getByLabelText("Bootstrap credential").fill("bootstrap-sensitive-browser-canary");
    await page.getByLabelText("Display name").fill("Ada");
    await page.getByLabelText(/Passkey label/).fill("Primary");
    await page.getByRole("button", { name: "Create owner and passkey" }).click();

    expect(bootstrapOwner).toHaveBeenCalledWith({
      credential: "bootstrap-sensitive-browser-canary",
      displayName: "Ada",
      passkeyLabel: "Primary",
    });
    await expect.element(page.getByLabelText("Bootstrap credential")).toHaveValue("");
    expect(JSON.stringify(localStorage)).not.toContain("bootstrap-sensitive-browser-canary");
    expect(JSON.stringify(sessionStorage)).not.toContain("bootstrap-sensitive-browser-canary");
    expect(location.href).not.toContain("bootstrap-sensitive-browser-canary");
  });

  it("hides unavailable bootstrap without hiding invitation redemption", async () => {
    mounted = await render(<HostedHubRoot />);
    await expect.element(page.getByRole("button", { name: "Redeem invitation" })).toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Set up first owner" }))
      .not.toBeInTheDocument();
  });

  it("announces session expiry without exposing prior account or session state", async () => {
    useHostedHubStore.setState({ accountStatus: "session-expired" });
    mounted = await render(<HostedHubRoot />);
    await expect.element(page.getByRole("heading", { name: "Your session expired" })).toBeVisible();
    expect(document.body.textContent).not.toContain(account.id);
    expect(document.body.textContent).not.toContain(session.id);
  });

  it("distinguishes online and offline authorized nodes and disables stale selection", async () => {
    const nodes = [
      node("node_aaaaaaaaaaaaaaaaaaaaaa", true, "operator"),
      node("node_bbbbbbbbbbbbbbbbbbbbbb", false, "viewer"),
    ];
    useHostedHubStore.setState({
      accountStatus: "authenticated",
      account,
      session,
      directoryStatus: "stale",
      nodes,
      errorMessage: "Directory refresh failed.",
    });
    mounted = await render(<HostedHubRoot />);
    await expect.element(page.getByRole("status")).toHaveTextContent(/Directory data is stale/);
    await expect.element(page.getByRole("button", { name: /Studio online/ })).toBeDisabled();
    await expect.element(page.getByRole("button", { name: /Travel offline/ })).toBeDisabled();
    await expect.element(page.getByText("Online", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Offline", { exact: true })).toBeVisible();
  });

  it("keeps one-time recovery material out of browser storage", async () => {
    useHostedHubStore.setState({
      accountStatus: "authenticated",
      account,
      session,
      recoveryCodes: ["recovery-sensitive-browser-canary"],
    });
    mounted = await render(<HostedHubRoot />);
    await expect
      .element(page.getByRole("heading", { name: "Save your recovery codes" }))
      .toBeVisible();
    expect(JSON.stringify(localStorage)).not.toContain("recovery-sensitive-browser-canary");
    expect(JSON.stringify(sessionStorage)).not.toContain("recovery-sensitive-browser-canary");
    expect(location.href).not.toContain("recovery-sensitive-browser-canary");
  });

  it("keeps the node session UI unmounted until the initial snapshot is ready", async () => {
    const selectedNode = node("node_aaaaaaaaaaaaaaaaaaaaaa", true, "operator");
    useHostedHubStore.setState({
      accountStatus: "authenticated",
      account,
      session,
      directoryStatus: "ready",
      nodes: [selectedNode],
      selectedNode,
      transportStatus: "online",
      sessionEstablished: false,
    });
    mounted = await render(<HostedHubRoot />);
    await expect
      .element(page.getByRole("heading", { name: `Connecting to ${selectedNode.label}` }))
      .toBeVisible();
    await expect.element(page.getByRole("status")).toHaveTextContent(/synchronizing Ryco state/);
  });

  it("shows a labelled relay failure without mounting the node session UI", async () => {
    const selectedNode = node("node_aaaaaaaaaaaaaaaaaaaaaa", true, "operator");
    useHostedHubStore.setState({
      accountStatus: "authenticated",
      account,
      session,
      directoryStatus: "ready",
      nodes: [selectedNode],
      selectedNode,
      transportStatus: "terminal-failure",
      errorMessage: "The relay authentication attempt expired or was rejected.",
    });
    mounted = await render(<HostedHubRoot />);
    await expect
      .element(page.getByRole("heading", { name: `Unable to connect to ${selectedNode.label}` }))
      .toBeVisible();
    await expect
      .element(page.getByRole("alert"))
      .toHaveTextContent(/authentication attempt expired/);
  });

  it("starts sign-in and node selection from keyboard-operable controls", async () => {
    const signIn = vi.spyOn(hostedHubController, "signIn").mockResolvedValue();
    mounted = await render(<HostedHubRoot />);
    await page.getByRole("button", { name: "Sign in with passkey" }).click();
    expect(signIn).toHaveBeenCalledOnce();

    await mounted.unmount();
    mounted = null;
    const selectable = node("node_aaaaaaaaaaaaaaaaaaaaaa", true, "operator");
    useHostedHubStore.setState({
      accountStatus: "authenticated",
      account,
      session,
      directoryStatus: "ready",
      nodes: [selectable],
    });
    const selectNode = vi.spyOn(hostedHubController, "selectNode").mockResolvedValue();
    mounted = await render(<HostedHubRoot />);
    await page.getByRole("button", { name: /Studio online/ }).click();
    expect(selectNode).toHaveBeenCalledWith(selectable.id);
  });

  it("lets an owner review and approve bounded node enrollment metadata", async () => {
    useHostedHubStore.setState({
      accountStatus: "authenticated",
      account,
      session,
      directoryStatus: "ready",
      nodes: [],
    });
    const lookup = vi.spyOn(hostedHubApi, "lookupNodeEnrollment").mockResolvedValue({
      id: "enr_aaaaaaaaaaaaaaaaaaaaaa",
      label: "Trusted studio",
      platformOs: "darwin",
      platformArch: "arm64",
      clientVersion: "0.1.8",
      algorithm: "ed25519",
      fingerprint: `SHA256:${"a".repeat(43)}`,
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    });
    const approve = vi.spyOn(hostedHubApi, "approveNodeEnrollment").mockResolvedValue();
    vi.spyOn(hostedHubController, "refreshDirectory").mockResolvedValue();
    mounted = await render(<HostedHubRoot />);

    await page.getByRole("button", { name: "Enroll node" }).click();
    await expect.element(page.getByLabelText("Device code")).toHaveFocus();
    await page.getByLabelText("Device code").fill("SECR-ETCANARY123");
    await page.getByRole("button", { name: "Review node" }).click();

    expect(lookup).toHaveBeenCalledWith("SECR-ETCANARY123", expect.any(AbortSignal));
    await expect
      .element(page.getByRole("heading", { name: "Review node enrollment" }))
      .toBeVisible();
    await expect.element(page.getByText("Trusted studio")).toBeVisible();
    await expect.element(page.getByText(`SHA256:${"a".repeat(43)}`)).toBeVisible();
    expect(JSON.stringify(useHostedHubStore.getState())).not.toContain("ETCANARY123");
    expect(JSON.stringify(localStorage)).not.toContain("ETCANARY123");
    expect(JSON.stringify(sessionStorage)).not.toContain("ETCANARY123");
    expect(location.href).not.toContain("ETCANARY123");

    await page.getByRole("button", { name: "Approve node" }).click();
    expect(approve).toHaveBeenCalledWith("SECR-ETCANARY123", expect.any(AbortSignal));
    await expect.element(page.getByRole("heading", { name: "Node approved" })).toBeVisible();
  });

  it("requires confirmation before denying and hides enrollment from non-owners", async () => {
    useHostedHubStore.setState({
      accountStatus: "authenticated",
      account,
      session,
      directoryStatus: "ready",
      nodes: [],
    });
    vi.spyOn(hostedHubApi, "lookupNodeEnrollment").mockResolvedValue({
      id: "enr_aaaaaaaaaaaaaaaaaaaaaa",
      label: "Unknown studio",
      platformOs: "linux",
      platformArch: "x64",
      clientVersion: "0.1.8",
      algorithm: "ed25519",
      fingerprint: `SHA256:${"b".repeat(43)}`,
      createdAt: 1,
      expiresAt: Date.now() + 60_000,
    });
    const deny = vi.spyOn(hostedHubApi, "denyNodeEnrollment").mockResolvedValue();
    mounted = await render(<HostedHubRoot />);
    await page.getByRole("button", { name: "Enroll node" }).click();
    await page.getByLabelText("Device code").fill("WXYZ-1234");
    await page.getByRole("button", { name: "Review node" }).click();
    await page.getByRole("button", { name: "Deny", exact: true }).click();
    expect(deny).not.toHaveBeenCalled();
    await expect.element(page.getByText(/Denial is permanent/)).toBeVisible();
    await page.getByRole("button", { name: "Confirm denial" }).click();
    expect(deny).toHaveBeenCalledWith("WXYZ-1234", expect.any(AbortSignal));

    await mounted.unmount();
    mounted = null;
    useHostedHubStore.setState({
      accountStatus: "authenticated",
      account: { ...account, role: "operator" },
      session,
      directoryStatus: "ready",
      nodes: [],
    });
    mounted = await render(<HostedHubRoot />);
    await expect.element(page.getByRole("button", { name: "Enroll node" })).not.toBeInTheDocument();
  });

  it("expires the hosted session when enrollment authorization is lost", async () => {
    useHostedHubStore.setState({
      accountStatus: "authenticated",
      account,
      session,
      directoryStatus: "ready",
      nodes: [],
    });
    vi.spyOn(hostedHubApi, "lookupNodeEnrollment").mockRejectedValue(
      new HostedHubApiError("session_invalid", 401),
    );
    mounted = await render(<HostedHubRoot />);
    await page.getByRole("button", { name: "Enroll node" }).click();
    await page.getByLabelText("Device code").fill("ABCD-EFGH");
    await page.getByRole("button", { name: "Review node" }).click();
    await expect.element(page.getByRole("heading", { name: "Your session expired" })).toBeVisible();
  });

  it("disables revoked nodes and announces authorization removal", async () => {
    const revoked = {
      ...node("node_aaaaaaaaaaaaaaaaaaaaaa", true, "viewer"),
      revokedAt: 2,
      revocationReasonCode: "administrative",
    };
    useHostedHubStore.setState({
      accountStatus: "authenticated",
      account,
      session,
      directoryStatus: "ready",
      nodes: [revoked],
      selectionStatus: "authorization-removed",
    });
    mounted = await render(<HostedHubRoot />);
    await expect.element(page.getByRole("alert")).toHaveTextContent(/Authorization.*removed/);
    await expect.element(page.getByRole("button", { name: /Studio online/ })).toBeDisabled();
    await expect.element(page.getByText("Revoked", { exact: true })).toBeVisible();
  });

  it("announces reconnect, switches nodes, and preserves delivery uncertainty", async () => {
    const current = node("node_aaaaaaaaaaaaaaaaaaaaaa", true, "operator");
    const replacement = {
      ...node("node_bbbbbbbbbbbbbbbbbbbbbb", true, "owner"),
      label: "Second node",
    };
    useHostedHubStore.setState({
      accountStatus: "authenticated",
      account,
      session,
      directoryStatus: "ready",
      nodes: [current, replacement],
      selectedNode: current,
      selectionStatus: "online",
      transportStatus: "reconnecting",
      sessionStatus: "stale",
    });
    const selectNode = vi.spyOn(hostedHubController, "selectNode").mockResolvedValue();
    mounted = await render(<HostedNodeMenu />);
    await expect.element(page.getByText("Reconnecting", { exact: true })).toBeVisible();
    await page.getByText("Reconnecting", { exact: true }).click();
    await page.getByRole("button", { name: new RegExp(replacement.label) }).click();
    expect(selectNode).toHaveBeenCalledWith(replacement.id);

    useHostedHubStore.setState({
      transportStatus: "online",
      sessionStatus: "delivery-unknown",
      sessionRecoveredAfterUnknown: true,
    });
    await expect.element(page.getByText("Delivery unknown", { exact: true })).toBeVisible();
    await expect.element(page.getByText(/did not resend it automatically/)).toBeVisible();
  });
});
