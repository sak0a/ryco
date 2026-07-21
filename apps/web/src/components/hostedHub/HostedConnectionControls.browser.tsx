// Production CSS is part of the behavior under test: header layout and the
// phone tier variants drive the collision and pill assertions.
import "../../index.css";

import { EnvironmentId, type ResolvedKeybindingsConfig } from "@ryco/contracts";
import { page, userEvent } from "vite-plus/test/browser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { render } from "vitest-browser-react";

const navigate = vi.fn(async () => undefined);
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => navigate,
}));

import {
  resetPrimaryEnvironmentDescriptorForTests,
  writePrimaryEnvironmentDescriptor,
} from "../../environments/primary";
import { hostedHubController, useHostedHubStore } from "../../hostedHub/state";
import type { HostedHubNode } from "../../hostedHub/types";
import { syncDocumentPresentationTier } from "../../lib/presentationTier";
import { SidebarProvider } from "../ui/sidebar";
import { ChatHeader } from "../chat/ChatHeader";
import {
  HostedConnectionPill,
  HostedConnectionSheet,
  HostedNodeMenu,
} from "./HostedConnectionControls";
import { HOSTED_RELAY_TRUST_DISCLOSURE } from "./HostedRelayTrustNotice";

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

function node(id: string, label: string, online = true): HostedHubNode {
  return {
    id,
    environmentId: EnvironmentId.make(`env_${id.slice(5).padEnd(22, "a").slice(0, 22)}`),
    label,
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

const selectedNode = node("node_aaaaaaaaaaaaaaaaaaaaaa", "Studio node");
const otherNode = node("node_bbbbbbbbbbbbbbbbbbbbbb", "Second node");

function seedConnectedState() {
  useHostedHubStore.setState({
    accountStatus: "authenticated",
    account,
    session,
    directoryStatus: "ready",
    browserStatus: "current",
    nodes: [selectedNode, otherNode],
    selectedNode,
    selectionStatus: "online",
    effectiveRole: "operator",
    transportStatus: "online",
    sessionStatus: "ready",
    sessionEstablished: true,
  });
}

function rectsIntersect(a: DOMRect, b: DOMRect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

let mounted: Awaited<ReturnType<typeof render>> | null = null;

describe("hosted connection controls", () => {
  beforeAll(() => {
    syncDocumentPresentationTier();
  });

  beforeEach(() => {
    localStorage.clear();
    hostedHubController.resetForTests();
    navigate.mockClear();
  });

  afterEach(async () => {
    await mounted?.unmount();
    mounted = null;
    hostedHubController.resetForTests();
    resetPrimaryEnvironmentDescriptorForTests();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
    await page.viewport(1_280, 720);
  });

  it("renders inside the workspace header without a fixed overlay or control overlap at supported widths", async () => {
    seedConnectedState();
    writePrimaryEnvironmentDescriptor({
      environmentId: selectedNode.environmentId,
      label: selectedNode.label,
      platform: { os: "linux", arch: "x64" },
      serverVersion: "0.9.0",
      capabilities: { repositoryIdentity: false },
    });

    mounted = await render(
      <SidebarProvider>
        <header className="w-full border-b border-border px-5">
          <ChatHeader
            activeThreadEnvironmentId={selectedNode.environmentId}
            activeThreadTitle="Phone shell implementation"
            activeProjectName="Ryco"
            isGitRepo
            openInCwd="/repo/project"
            activeProjectScripts={[
              {
                id: "build",
                name: "Build",
                command: "bun run build",
                icon: "build",
                runOnWorktreeCreate: false,
              },
            ]}
            preferredScriptId={null}
            keybindings={{} as ResolvedKeybindingsConfig}
            availableEditors={["vscode"]}
            worktreeBranch="feat/phone-shell"
            worktreeTitle="Phone shell"
            worktreeOrigin="manual"
            workspacePanelOpen={false}
            onToggleWorkspacePanel={vi.fn()}
            overviewSidebarOpen={false}
            onToggleOverviewSidebar={vi.fn()}
            onRunProjectScript={vi.fn()}
            onAddProjectScript={vi.fn()}
            onUpdateProjectScript={vi.fn()}
            onDeleteProjectScript={vi.fn()}
          />
        </header>
      </SidebarProvider>,
    );

    for (const [width, height] of [
      [1_280, 720],
      [1_024, 720],
      [820, 720],
    ] as const) {
      await page.viewport(width, height);
      const summary = document.querySelector<HTMLElement>("details > summary");
      expect(summary, `connection control missing at ${width}px`).not.toBeNull();

      // The legacy fixed overlay is gone: no positioned ancestor of the
      // connection control is fixed, and it lives inside the header flow.
      let ancestor: HTMLElement | null = summary;
      while (ancestor) {
        expect(getComputedStyle(ancestor).position).not.toBe("fixed");
        ancestor = ancestor.parentElement;
      }
      expect(summary!.closest("header")).not.toBeNull();

      const summaryRect = summary!.getBoundingClientRect();
      expect(summaryRect.width).toBeGreaterThan(0);
      const otherControls = [
        document.querySelector('button[aria-label="Toggle overview panel"]'),
        document.querySelector('button[aria-label="Toggle workspace panel"]'),
        document.querySelector('[aria-label="Project scripts"]'),
        document.querySelector('[aria-label="Subscription actions"]'),
      ];
      for (const control of otherControls) {
        expect(control, `header control missing at ${width}px`).not.toBeNull();
        const controlRect = (control as HTMLElement).getBoundingClientRect();
        expect(controlRect.width).toBeGreaterThan(0);
        expect(
          rectsIntersect(summaryRect, controlRect),
          `connection control overlaps a header control at ${width}px`,
        ).toBe(false);
      }
      // Everything stays inside the viewport (no horizontal overflow).
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
    }
  });

  it("offers the All nodes return action from the desktop menu", async () => {
    seedConnectedState();
    // A status distinct from the node-presence badges keeps the summary
    // locator unambiguous.
    useHostedHubStore.setState({ transportStatus: "reconnecting", sessionStatus: "stale" });
    const returnToDirectory = vi
      .spyOn(hostedHubController, "returnToDirectory")
      .mockResolvedValue();
    mounted = await render(<HostedNodeMenu />);

    await page.getByText("Reconnecting", { exact: true }).click();
    await page.getByRole("button", { name: "All nodes" }).click();
    // No hosted history is installed in this suite, so the control falls back
    // to the router navigation plus the controller primitive.
    await vi.waitFor(() => expect(returnToDirectory).toHaveBeenCalledOnce());
    expect(navigate).toHaveBeenCalledWith({ to: "/", replace: true });
  });

  it("opens the phone connection sheet from the pill with the full bounded control set", async () => {
    await page.viewport(390, 844);
    seedConnectedState();
    const refreshDirectory = vi.spyOn(hostedHubController, "refreshDirectory").mockResolvedValue();
    mounted = await render(<HostedConnectionPill />);

    const pill = page.getByTestId("hosted-connection-pill");
    await expect.element(pill).toBeVisible();
    const pillElement = pill.element() as HTMLElement;
    // Bounded pill: node label plus status as text (with icon), inside the bar.
    expect(pillElement.textContent).toContain("Studio node");
    expect(pillElement.textContent).toContain("Online");
    expect(pillElement.querySelector("svg")).not.toBeNull();

    await pill.click();
    const sheet = document.querySelector<HTMLElement>('[data-slot="sheet-popup"]');
    expect(sheet).not.toBeNull();
    // Node identity, effective role, and status render as bounded text.
    await expect.element(page.getByText(/operator · Online/)).toBeVisible();
    // Polite live region for connection state changes.
    const liveRegion = sheet!.querySelector('[aria-live="polite"]');
    expect(liveRegion?.textContent).toContain("Studio node");
    // Full control set.
    await expect.element(page.getByRole("button", { name: "All nodes" })).toBeVisible();
    await expect.element(page.getByRole("button", { name: /Second node/ })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Refresh nodes" })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Sign out" })).toBeVisible();
    await expect.element(page.getByText(HOSTED_RELAY_TRUST_DISCLOSURE)).toBeVisible();
    // Focus is trapped inside the sheet while it is open.
    expect(sheet!.contains(document.activeElement)).toBe(true);

    await page.getByRole("button", { name: "Refresh nodes" }).click();
    expect(refreshDirectory).toHaveBeenCalled();

    // Escape closes the sheet and focus returns to the pill.
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => {
      expect(document.querySelector('[data-slot="sheet-popup"]')).toBeNull();
    });
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(pillElement);
    });
  });

  it("applies the directory's fail-closed rules inside the sheet while sign-out stays available", async () => {
    await page.viewport(390, 844);
    seedConnectedState();
    useHostedHubStore.setState({ directoryStatus: "stale" });
    mounted = await render(<HostedConnectionSheet open onOpenChange={() => undefined} />);

    const switchButton = page.getByRole("button", { name: /Second node/ });
    await expect.element(switchButton).toBeDisabled();
    await expect.element(page.getByRole("button", { name: "Sign out" })).toBeEnabled();

    // Suspended browser state also disables switching.
    useHostedHubStore.setState({ directoryStatus: "ready", browserStatus: "suspended" });
    await expect.element(switchButton).toBeDisabled();
    await expect.element(page.getByText(/operator · Stale/)).toBeVisible();

    // Recovered: switching re-enables.
    useHostedHubStore.setState({ browserStatus: "current" });
    await expect.element(switchButton).toBeEnabled();
  });

  it("keeps the delivery-unknown acknowledgment gated on session replay in the sheet", async () => {
    await page.viewport(390, 844);
    seedConnectedState();
    useHostedHubStore.setState({
      sessionStatus: "delivery-unknown",
      sessionRecoveredAfterUnknown: false,
    });
    const acknowledge = vi.spyOn(hostedHubController, "acknowledgeDeliveryUnknown");
    mounted = await render(<HostedConnectionSheet open onOpenChange={() => undefined} />);

    await expect.element(page.getByText(/did not resend it automatically/)).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Synchronizing…" })).toBeDisabled();

    useHostedHubStore.setState({ sessionRecoveredAfterUnknown: true });
    const ackButton = page.getByRole("button", { name: "Acknowledge" });
    await expect.element(ackButton).toBeEnabled();
    await ackButton.click();
    expect(acknowledge).toHaveBeenCalled();
  });
});
