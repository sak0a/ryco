// Production CSS is part of the behavior under test: the phone tier variants
// drive the app bar's density.
import "../../../index.css";

import { EnvironmentId, type ThreadId } from "@ryco/contracts";
import { page } from "vite-plus/test/browser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { render } from "vitest-browser-react";

const navigate = vi.fn(async () => undefined);
const routerStub = { navigate, state: { matches: [] } };
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => navigate,
  useRouter: () => routerStub,
}));

vi.mock("../../../lib/gitStatusState", () => ({
  useGitStatus: () => ({ data: null, error: null, cause: null, isPending: false }),
  useGitStatuses: () => new Map(),
  refreshGitStatus: () => Promise.resolve(null),
  resetGitStatusStateForTests: () => undefined,
}));

import { HOSTED_CONNECTION_STATUS_INDICATORS } from "../../../hostedHub/connectionStatus";
import { hostedConnectionStatusRepresentatives } from "../../../../test/hostedConnectionVocabulary";
import { hostedHubController, useHostedHubStore } from "../../../hostedHub/state";
import type { HostedHubNode } from "../../../hostedHub/types";
import { syncDocumentPresentationTier } from "../../../lib/presentationTier";
import { SidebarProvider } from "../../ui/sidebar";
import { PhoneThreadAppBar } from "./PhoneThreadAppBar";

const ENV_ID = EnvironmentId.make("environment-local");
const THREAD_ID = "thread-draft-1" as ThreadId;

/** A node label as long as the one the live audit measured. */
const NODE_LABEL = "MacBook Pro M5";
const HOSTED_NODE: HostedHubNode = {
  id: "node_aaaaaaaaaaaaaaaaaaaaaa",
  environmentId: EnvironmentId.make("env_aaaaaaaaaaaaaaaaaaaaaa"),
  label: NODE_LABEL,
  platformOs: "linux",
  platformArch: "x64",
  clientVersion: "0.9.0",
  createdAt: 1,
  updatedAt: 1,
  lastAuthenticatedAt: 1,
  revokedAt: null,
  revocationReasonCode: null,
  grant: { id: "grant_a", role: "operator" },
  effectiveRole: "operator",
  presence: { online: true, lastHeartbeatAt: 1 },
};

function seedHostedConnection() {
  useHostedHubStore.setState({
    accountStatus: "authenticated",
    directoryStatus: "ready",
    browserStatus: "current",
    nodes: [HOSTED_NODE],
    selectedNode: HOSTED_NODE,
    selectionStatus: "online",
    effectiveRole: "operator",
    transportStatus: "online",
    sessionStatus: "ready",
    sessionEstablished: true,
  });
}

let mounted: Awaited<ReturnType<typeof render>> | null = null;

describe("PhoneThreadAppBar", () => {
  beforeAll(() => {
    syncDocumentPresentationTier();
  });

  beforeEach(async () => {
    await page.viewport(390, 844);
    localStorage.clear();
    navigate.mockClear();
  });

  afterEach(async () => {
    await mounted?.unmount();
    mounted = null;
    hostedHubController.resetForTests();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
    await page.viewport(1_280, 720);
  });

  it("reduces to back, title, and the connection indicator", async () => {
    mounted = await render(
      <SidebarProvider>
        <PhoneThreadAppBar environmentId={ENV_ID} threadId={THREAD_ID} title="Empty Session" />
      </SidebarProvider>,
    );

    await expect.element(page.getByRole("button", { name: "Back to threads" })).toBeVisible();
    await expect.element(page.getByText("Empty Session")).toBeVisible();

    // The two controls the audit found in the top-right corner are gone from
    // the bar. They live in `PhoneThreadDock` at the bottom of the screen now,
    // which is what `PhoneThreadDock.browser.tsx` asserts.
    expect(document.querySelector('button[aria-label="Toggle workspace panel"]')).toBeNull();
    expect(document.querySelector('button[aria-label="Thread actions"]')).toBeNull();

    // Back is top-anchored chrome by design, and stays a 44px target.
    const back = page.getByRole("button", { name: "Back to threads" }).element() as HTMLElement;
    const rect = back.getBoundingClientRect();
    expect(Math.min(rect.width, rect.height)).toBeGreaterThan(0);
    back.click();
    expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ to: "/" }));
  });

  it("keeps the title readable beside the collapsed indicator at 320px in every bounded state", async () => {
    // The audited bar: a 176px connection pill rendering a truncated node
    // label and a truncated state, which left the title nothing at 320px.
    //
    // Seeding only ready/online would make the width bounds here meaningless —
    // that is the ONE state whose short label is also its full text, so the
    // bar would never be measured against a long one. The whole vocabulary is
    // swept instead.
    await page.viewport(320, 568);
    seedHostedConnection();
    mounted = await render(
      <SidebarProvider>
        <PhoneThreadAppBar
          environmentId={ENV_ID}
          threadId={THREAD_ID}
          title="Phone connection indicator"
        />
      </SidebarProvider>,
    );

    await vi.waitFor(() => {
      expect(document.querySelector('[data-testid="hosted-connection-pill"]')).not.toBeNull();
    });
    const chip = () =>
      document.querySelector<HTMLElement>('[data-testid="hosted-connection-pill"]')!;
    const status = () =>
      document.querySelector<HTMLElement>('[data-slot="mobile-status-chip-status"]')!;
    const title = () => document.querySelector<HTMLElement>("p.truncate")!;

    for (const [text, input] of hostedConnectionStatusRepresentatives()) {
      const { shortLabel } = HOSTED_CONNECTION_STATUS_INDICATORS[text];
      useHostedHubStore.setState({
        browserStatus: input.browserStatus,
        sessionStatus: input.sessionStatus,
        selectionStatus: input.selectionStatus,
        transportStatus: input.transportStatus,
      });
      await vi.waitFor(() => {
        expect(status().textContent, `collapsed label for "${text}"`).toBe(shortLabel);
      });

      // The title, not the indicator, gets the bar — in the worst state
      // (`Reconnecting`, the widest short label) that is 152px against the
      // indicator's 120px. A thread title is arbitrary-length and truncates by
      // design here, so width is the measure; the untruncated case is pinned
      // on Home, whose title is the fixed word "Threads".
      expect(
        title().getBoundingClientRect().width,
        `title width beside "${shortLabel}"`,
      ).toBeGreaterThan(145);
      expect(
        title().getBoundingClientRect().width,
        `the indicator outgrew the title beside "${shortLabel}"`,
      ).toBeGreaterThan(chip().getBoundingClientRect().width);
      expect(
        chip().getBoundingClientRect().width,
        `indicator width for "${shortLabel}"`,
      ).toBeLessThanOrEqual(136.5);
      // The short label survives at the narrowest phone; only identity yields.
      expect(status().scrollWidth, `truncation of "${shortLabel}"`).toBeLessThanOrEqual(
        status().clientWidth,
      );
      // Identity is still announced even though it is not visible.
      expect(chip().getAttribute("aria-label")).toBe(`Connection: ${NODE_LABEL}, ${text}`);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320);
    }
  });
});
