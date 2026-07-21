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
    // The full-width bottom sheet pads the landscape side insets itself and
    // honors reduced motion on its transition.
    expect(sheet!.className).toContain("pl-safe");
    expect(sheet!.className).toContain("pr-safe");
    expect(sheet!.className).toContain("motion-reduce:transition-none");
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

  it("announces every bounded status change politely from the pill while the sheet is closed", async () => {
    await page.viewport(390, 844);
    seedConnectedState();
    mounted = await render(<HostedConnectionPill />);

    const announcer = () =>
      document.querySelector<HTMLElement>('[data-testid="hosted-connection-status-announcer"]');
    // The region exists while the sheet is closed and is polite, so status
    // changes never interrupt the user mid-task.
    const region = announcer();
    expect(region).not.toBeNull();
    expect(region!.getAttribute("aria-live")).toBe("polite");
    expect(region!.closest('[data-slot="sheet-popup"]')).toBeNull();
    expect(region!.textContent).toContain("Studio node");
    expect(region!.textContent).toContain("Online");

    // Every derived status change re-renders the region content, which is
    // what triggers a live-region announcement.
    useHostedHubStore.setState({ transportStatus: "reconnecting" });
    await vi.waitFor(() => {
      expect(announcer()!.textContent).toContain("Reconnecting");
    });
    useHostedHubStore.setState({ browserStatus: "synchronizing" });
    await vi.waitFor(() => {
      expect(announcer()!.textContent).toContain("Synchronizing");
    });
    useHostedHubStore.setState({ browserStatus: "offline" });
    await vi.waitFor(() => {
      expect(announcer()!.textContent).toContain("Offline");
    });
    useHostedHubStore.setState({ browserStatus: "current", transportStatus: "online" });
    await vi.waitFor(() => {
      expect(announcer()!.textContent).toContain("Online");
    });

    // While the sheet is open its own polite region covers the status, so
    // the pill's announcer unmounts — no double announcement.
    await page.getByTestId("hosted-connection-pill").click();
    await vi.waitFor(() => {
      expect(document.querySelector('[data-slot="sheet-popup"]')).not.toBeNull();
      expect(announcer()).toBeNull();
    });
    const politeStatusRegions = [
      ...document.querySelectorAll<HTMLElement>('[aria-live="polite"]'),
    ].filter((region) => region.textContent?.includes("Studio node"));
    expect(politeStatusRegions).toHaveLength(1);

    // Closing the sheet restores the pill's announcer.
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => {
      expect(document.querySelector('[data-slot="sheet-popup"]')).toBeNull();
      expect(announcer()).not.toBeNull();
    });
  });

  it("announces delivery-unknown assertively while the connection sheet is closed", async () => {
    await page.viewport(390, 844);
    seedConnectedState();
    mounted = await render(<HostedConnectionPill />);

    expect(document.querySelector('[role="alert"]')).toBeNull();
    useHostedHubStore.setState({ sessionStatus: "delivery-unknown" });
    // Mounting a role=alert element announces assertively on arrival; the
    // explicit acknowledgment flow stays in the connection sheet.
    const alert = await vi.waitFor(() => {
      const element = document.querySelector<HTMLElement>('[role="alert"]');
      expect(element).not.toBeNull();
      return element!;
    });
    expect(alert.textContent).toContain("Delivery unknown");
    expect(alert.closest('[data-slot="sheet-popup"]')).toBeNull();

    // While the sheet is open its acknowledgment block is the single alert;
    // the pill's copy unmounts so the arrival never announces twice.
    await page.getByTestId("hosted-connection-pill").click();
    await vi.waitFor(() => {
      expect(document.querySelector('[data-slot="sheet-popup"]')).not.toBeNull();
    });
    await vi.waitFor(() => {
      const alerts = [...document.querySelectorAll<HTMLElement>('[role="alert"]')];
      expect(alerts).toHaveLength(1);
      expect(alerts[0]!.closest('[data-slot="sheet-popup"]')).not.toBeNull();
    });

    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => {
      expect(document.querySelector('[data-slot="sheet-popup"]')).toBeNull();
    });
    useHostedHubStore.setState({ sessionStatus: "ready" });
    await vi.waitFor(() => {
      expect(document.querySelector('[role="alert"]')).toBeNull();
    });
  });
});
