// Consolidated phone/tablet acceptance matrix (focused mobile workspace
// design, delivery step 10).
//
// The spec's Verification matrix — viewports 320×568, 390×844, 844×390
// (coarse landscape), a rotating 600–800px viewport (tier-flip state
// preservation), 768×1024, and the desktop baseline, across the hosted entry
// surfaces, Home, thread/composer, approvals, diff, files, terminal,
// settings, and the connection controls — is proven by the per-step suites
// plus the gap-fill sweeps in this file. This doc block is the canonical
// cell → proving-test mapping; the tests below cover only cells no per-step
// suite already proves (no duplicate re-testing).
//
// File aliases used in the mapping:
//   AM = this file
//   CV = ChatView.browser.tsx
//   HR = hostedHub/HostedHubRoot.browser.tsx
//   HN = hostedHub/HostedNodeRoutes.browser.tsx
//   HC = hostedHub/HostedConnectionControls.browser.tsx
//   HP = hostedHub/HostedPwaControls.browser.tsx
//   PT = PresentationTier.browser.tsx
//   PH = shell/phone/PhoneHome.browser.tsx
//   PA = shell/phone/PhoneThreadAppBar.browser.tsx
//   PS = shell/phone/PhoneSettingsSurface.browser.tsx
//   CS = shell/phone/ContextMenuActionSheetHost.browser.tsx
//   AC = chat/ApprovalCard.browser.tsx
//   MT = chat/MessageTouchActions.browser.tsx
//   CB = chat/ComposerBannerStack.browser.tsx
//   SH = ui/sheet.browser.tsx
//   DL = ui/dialog.browser.tsx
//   WP = ThreadWorkspacePanel.browser.tsx
//   DP = DiffPanel.browser.tsx
//
// ── Surface × viewport mapping ───────────────────────────────────────────
//
// Hosted sign-in
//   320×568      HR "contains hosted admission and node selection at 320 CSS pixels"
//   390×844      HR "keeps sign-in and node-selection screen-reader traversal named…"
//                AM "survives 200% text scaling on the sign-in and node directory surfaces"
//   844×390+co   AM "contains every hosted entry surface on a coarse landscape phone"
//   600–800 rot  AM "preserves invitation form input across a mid-size rotation tier flip"
//   768×1024     AM "keeps the hosted entry surfaces on the desktop tier at 768×1024"
//   desktop      HR "provides keyboard-labelled authentication and registration controls…"
// Invitation (redeem + first-owner bootstrap)
//   320×568      AM "contains the invitation, recovery, connecting, and failure surfaces at 320…"
//   844×390+co   AM "contains every hosted entry surface on a coarse landscape phone"
//   600–800 rot  AM "preserves invitation form input across a mid-size rotation tier flip"
//   desktop      HR "provides keyboard-labelled authentication and registration controls…",
//                HR "submits first-owner bootstrap without retaining its credential in the form"
// Recovery codes
//   320×568      AM "contains the invitation, recovery, connecting, and failure surfaces at 320…"
//   844×390+co   AM "contains every hosted entry surface on a coarse landscape phone"
//   desktop      HR "keeps one-time recovery material out of browser storage"
// Node directory (incl. connecting/failure/restoring companions)
//   320×568      HR "contains hosted admission and node selection at 320 CSS pixels";
//                connecting/failure at 320: AM "contains the invitation, recovery, connecting…"
//   390×844      HR "keeps sign-in and node-selection screen-reader traversal named…"
//                AM "survives 200% text scaling on the sign-in and node directory surfaces"
//   844×390+co   AM "contains every hosted entry surface on a coarse landscape phone"
//   768×1024     AM "keeps the hosted entry surfaces on the desktop tier at 768×1024"
//   desktop      HR nodes/enrollment/failure/restoring tests; route restore + fail-closed:
//                HN (all six tests) + hostedHub/nodeRouteRestore.integration.test.ts
// Home
//   320×568      PH "contains the Home surface at 320px and on a coarse landscape phone"
//   390×844      PH (all tests); CV "navigates the phone stack from the thread app bar to Home…"
//   844×390+co   PH "contains the Home surface at 320px and on a coarse landscape phone"
//   600–800 rot  CV "promotes the workspace panel to a full-screen phone surface…" (history
//                unwind to Home) + CV rotation tests below (Home participates via route "/")
//   desktop      CV desktop-baseline guards (sidebar shell; Home renders phone-only)
// Thread + composer (collapsed/expanded, stubbed keyboard)
//   320×568      CV "contains the active chat and composer at 320 CSS pixels",
//                CV "keeps the composer and send action above a stubbed software keyboard…"
//   390×844      CV keyboard/approval/expanded-composer tests (7281/7350/7414/7456)
//   844×390+co   CV "serves the phone structural presentation to a wide coarse-pointer…",
//                CV "shows exactly one set of pending-answer actions on a coarse landscape…",
//                CV "tracks keyboard insets across orientation changes…"
//   600–800 rot  CV "preserves route, draft, and panel search state across a mid-size rotation…",
//                CV "collapses the composer across the whole phone tier, including 640-767px…"
//   768×1024     CV "keeps tablet-width sidebar density unchanged on coarse pointers"
//   desktop      CV "publishes no keyboard variables and changes no composer geometry…",
//                CV footer compaction tests (6292/6325)
// Approvals (card + sheet)
//   320×568      CV "renders the full approval detail scrollable with all actions visible…",
//                AC "stays readable and actionable at 320px with stubbed software keyboard"
//   390×844      CV "keeps approval actions visible when an approval arrives…",
//                CV "keeps approval detail and actions visible above a stubbed software keyboard",
//                AC 390px twin + "expands long detail into bottom sheet…"
//   844×390+co   CV "shows exactly one set of pending-answer actions on a coarse landscape phone"
//   desktop      AC "keeps expand affordance off desktop tier + single inline action set"
// Diff / review
//   320×568      CV "renders desktop-shaped workspace links full-screen at 320px…"
//   390×844      CV "promotes the workspace panel to a full-screen phone surface…"
//   844×390+co   CV "contains the review and files surfaces on a coarse landscape phone"
//   600–800 rot  CV "preserves the open review surface across a mid-size rotation tier flip"
//   desktop      CV "keeps the desktop inline panel and the sub-980 sheet presentation…";
//                DP "keeps settings-driven wrap default on desktop presentations"
// Files
//   320×568      CV "renders desktop-shaped workspace links full-screen at 320px…" (files push)
//   844×390+co   CV "contains the review and files surfaces on a coarse landscape phone"
//   600–800 rot  CV "preserves the open review surface across a mid-size rotation tier flip"
//                (same surface container and URL params present the files tab)
//   desktop      CV "keeps the desktop inline panel and the sub-980 sheet presentation…";
//                WP desktop-width geometry test
// Terminal
//   320×568      CV "contains the terminal surface at 320px and on a coarse landscape phone"
//   390×844      CV "renders the terminal surface full-screen with a 44px toolbar…"
//   844×390+co   CV "contains the terminal surface at 320px and on a coarse landscape phone"
//   desktop      ThreadTerminalDrawer.browser.tsx (desktop drawer behavior)
// Settings
//   320×568      PS "lists every section as a labeled 44px row at 320px…",
//                PS "survives 200% text scaling at 320px without hiding controls or overflow"
//   390×844      PS focus/Escape/deep-link/safe-area tests; CV "presents phone settings
//                full-screen from Home with the labeled section list"
//   844×390+co   PS "keeps the settings surface full-screen on a coarse landscape phone"
//   600–800 rot  CV "preserves open settings across a mid-size rotation tier flip"
//   desktop      CV "keeps the desktop settings dialog presentation on desktop viewports";
//                SettingsPanels.browser.tsx (desktop panel behavior)
// Connection pill + sheet
//   320×568      AM "contains the connection sheet at 320px and on a coarse landscape phone"
//   390×844      HC sheet/pill tests (focus trap + restore, live regions, fail-closed)
//   844×390+co   AM "contains the connection sheet at 320px and on a coarse landscape phone"
//   desktop      HC "renders inside the workspace header without a fixed overlay…" (1280/1024/820),
//                HC "offers the All nodes return action from the desktop menu"
//
// ── Cross-cutting assertion mapping ──────────────────────────────────────
// Tier classification + coarse landscape + QA override:
//   PT "classifies viewports and pointers into the phone/desktop matrix",
//   PT "forces the tier via the dev-only diagnostics override…"
// Hidden shortcut hints on coarse pointers:
//   CV "hides keyboard-shortcut hints in the command palette on coarse pointers"
// Focus retention across drawer/sheet open-close:
//   HC pill/sheet focus trap + Escape restore; PH kebab-sheet keyboard flow;
//   PS "moves focus to section on push and back to originating row on pop";
//   CS "traps focus while open and resolves null on Escape";
//   CV "defers the plan auto-open while the phone composer is focused"
// Long-press / kebab action parity:
//   CS descriptor inventory; MT long-press suite; PH long-press tests
// Reduced motion:
//   CB "dismisses immediately without exit-transition styles under reduced motion"
//   (behavioral, emulated media); AM connection-sheet emulated-media check;
//   PS/HC/CV motion-reduce class guards
// 200% text scaling:
//   CV "keeps phone app-bar controls visible at 200% text scale at 320px and 390px";
//   PS 200% test; AM entry-surface 200% test
// Safe areas:
//   CV "pads phone surfaces from the safe-area insets directly…"; PS safe-area classes
// Route restore, fail-closed node routes, no-token-in-URL/persistence:
//   HN all tests; HR bootstrap/recovery persistence tests;
//   hostedHub/nodeRouteRestore.integration.test.ts,
//   hostedHub/returnToDirectory.integration.test.ts (relay-session close proof)
// Desktop-tier regression guards on the desktop baseline:
//   CV sidebar-density/settings-dialog/inline-panel/keyboard-noop guards;
//   HC header-collision computed-style guard; AC/MT/CS desktop guards
// PWA / lifecycle / reconnect / cache-policy / hosted-state suites (must stay
// green and behaviorally unmodified):
//   HP; pwa/lifecycle.test.ts; pwa/serviceWorkerPolicy.test.ts;
//   pwa/buildArtifacts.test.ts; hostedHub/lifecycle.integration.test.ts;
//   hostedHub/reconnectPolicy.test.ts; hostedHub/state.test.ts and siblings.
//
// Production CSS is part of the behavior under test for every sweep below.
import "../index.css";

import { EnvironmentId } from "@ryco/contracts";
import { page, userEvent } from "vite-plus/test/browser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { render } from "vitest-browser-react";

const navigate = vi.fn(async () => undefined);
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => navigate,
}));

import { hostedHubController, useHostedHubStore } from "../hostedHub/state";
import type { HostedHubNode } from "../hostedHub/types";
import { syncDocumentPresentationTier } from "../lib/presentationTier";
import {
  cdpSession,
  resetPointerEmulation,
  setCoarsePointerEmulation,
} from "../../test/browserPointer";
import { HostedConnectionPill } from "./hostedHub/HostedConnectionControls";
import { HostedHubRoot } from "./hostedHub/HostedHubRoot";

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

/**
 * Every pre-session hosted surface as a store recipe plus a visibility
 * marker, so the sweeps below can iterate the whole entry funnel at any
 * viewport. Recipes mirror the per-step HostedHubRoot suite exactly.
 */
interface EntrySurface {
  readonly name: string;
  readonly seed: () => void;
  /** Marker asserted visible before the geometry checks run. */
  readonly marker: () => Promise<HTMLElement>;
  /** Primary action asserted against the 44px phone touch-target floor. */
  readonly primaryAction?: () => HTMLElement | null;
  /** Extra in-surface navigation after mount (e.g. opening the form). */
  readonly prepare?: () => Promise<void>;
}

async function waitForVisibleByText(pattern: RegExp | string): Promise<HTMLElement> {
  return vi.waitFor(() => {
    const match = [...document.querySelectorAll<HTMLElement>("h1, h2, p")].find((element) =>
      typeof pattern === "string"
        ? element.textContent?.includes(pattern)
        : pattern.test(element.textContent ?? ""),
    );
    expect(match, `Surface marker ${String(pattern)} not found.`).not.toBeUndefined();
    return match!;
  });
}

function findButtonByText(label: string): HTMLElement | null {
  return (
    [...document.querySelectorAll<HTMLElement>("button")].find(
      (button) => button.textContent?.trim() === label,
    ) ?? null
  );
}

const ENTRY_SURFACES: readonly EntrySurface[] = [
  {
    name: "sign-in",
    seed: () => {
      useHostedHubStore.setState({ bootstrapAvailable: true });
    },
    marker: () => waitForVisibleByText("Connect to your Ryco nodes"),
    primaryAction: () => findButtonByText("Sign in with passkey"),
  },
  {
    name: "invitation",
    seed: () => {
      useHostedHubStore.setState({ bootstrapAvailable: true });
    },
    prepare: async () => {
      await page.getByRole("button", { name: "Redeem invitation" }).click();
      await expect.element(page.getByLabelText("Invitation code")).toBeVisible();
    },
    marker: () => waitForVisibleByText("Connect to your Ryco nodes"),
    primaryAction: () => findButtonByText("Create account and passkey"),
  },
  {
    name: "recovery-codes",
    seed: () => {
      useHostedHubStore.setState({
        accountStatus: "authenticated",
        account,
        session,
        recoveryCodes: ["recovery-matrix-browser-canary"],
      });
    },
    marker: () => waitForVisibleByText("Save your recovery codes"),
    primaryAction: () => findButtonByText("I saved the codes"),
  },
  {
    name: "node-directory",
    seed: () => {
      useHostedHubStore.setState({
        accountStatus: "authenticated",
        account,
        session,
        directoryStatus: "ready",
        browserStatus: "current",
        nodes: [selectedNode, otherNode],
      });
    },
    marker: () => waitForVisibleByText("Choose a Ryco node"),
    primaryAction: () =>
      [...document.querySelectorAll<HTMLElement>("button")].find((button) =>
        button.textContent?.includes("Studio node"),
      ) ?? null,
  },
  {
    name: "connecting",
    seed: () => {
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
    },
    marker: () => waitForVisibleByText(/Connecting to Studio node/),
  },
  {
    name: "failure",
    seed: () => {
      useHostedHubStore.setState({
        accountStatus: "authenticated",
        account,
        session,
        directoryStatus: "ready",
        nodes: [selectedNode],
        selectedNode,
        transportStatus: "terminal-failure",
        errorMessage: "The hosted authentication attempt expired or was rejected.",
      });
    },
    marker: () => waitForVisibleByText(/Unable to connect to Studio node/),
  },
];

function expectNoDocumentHorizontalOverflow(width: number): void {
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
  expect(document.body.scrollWidth).toBeLessThanOrEqual(width);
}

async function waitForTierAttribute(tier: "phone" | "desktop"): Promise<void> {
  await vi.waitFor(() => {
    expect(document.documentElement.getAttribute("data-tier")).toBe(tier);
  });
}

let mounted: Awaited<ReturnType<typeof render>> | null = null;

async function sweepEntrySurfaces(options: {
  width: number;
  tier: "phone" | "desktop";
  surfaces?: readonly string[];
}): Promise<void> {
  const surfaces = ENTRY_SURFACES.filter(
    (surface) => !options.surfaces || options.surfaces.includes(surface.name),
  );
  expect(surfaces.length).toBeGreaterThan(0);
  for (const surface of surfaces) {
    hostedHubController.resetForTests();
    surface.seed();
    mounted = await render(<HostedHubRoot />);
    await surface.prepare?.();
    await surface.marker();
    await waitForTierAttribute(options.tier);
    expectNoDocumentHorizontalOverflow(options.width);
    if (surface.primaryAction) {
      const action = await vi.waitFor(() => {
        const element = surface.primaryAction!();
        expect(element, `Primary action missing on ${surface.name}.`).not.toBeNull();
        return element!;
      });
      const box = action.getBoundingClientRect();
      expect(box.left, `${surface.name} action off-screen left`).toBeGreaterThanOrEqual(0);
      expect(box.right, `${surface.name} action off-screen right`).toBeLessThanOrEqual(
        options.width,
      );
      if (options.tier === "phone") {
        // The 44px floor is met either by the tier-variant box itself or by
        // the shared coarse-pointer ::after hit-area expansion (both sweeps
        // that reach here emulate a coarse pointer).
        if (box.height < 44) {
          const hitArea = getComputedStyle(action, "::after");
          expect(hitArea.position, `${surface.name} action lacks a coarse hit area`).toBe(
            "absolute",
          );
          expect(
            Number.parseFloat(hitArea.height),
            `${surface.name} action hit area below the 44px floor`,
          ).toBeGreaterThanOrEqual(44);
          expect(
            Number.parseFloat(hitArea.width),
            `${surface.name} action hit area below the 44px floor`,
          ).toBeGreaterThanOrEqual(44);
        }
      }
    }
    await mounted.unmount();
    mounted = null;
  }
}

describe("acceptance matrix — hosted entry surfaces and connection controls", () => {
  beforeAll(() => {
    // Mirrors main.tsx: the single document-level tier sync drives the
    // `phone:` CSS variants the sweeps assert against.
    syncDocumentPresentationTier();
  });

  beforeEach(async () => {
    await resetPointerEmulation();
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
    await resetPointerEmulation();
    await page.viewport(1_280, 720);
  });

  it("contains every hosted entry surface on a coarse landscape phone", async () => {
    // 844×390 needs the coarse-pointer clause to classify as a phone; the
    // entry funnel must stay overflow-free with 44px primary actions there.
    await page.viewport(844, 390);
    await setCoarsePointerEmulation(true);
    try {
      await sweepEntrySurfaces({ width: 844, tier: "phone" });
    } finally {
      await setCoarsePointerEmulation(false);
    }
  });

  it("contains the invitation, recovery, connecting, and failure surfaces at 320 CSS pixels", async () => {
    // Sign-in and the directory are proven at 320 by the HostedHubRoot
    // suite; this sweep completes the funnel's remaining surfaces. The
    // coarse pointer matches a real narrow phone and activates the shared
    // hit-area expansion the touch-target floor may rely on.
    await page.viewport(320, 568);
    await setCoarsePointerEmulation(true);
    try {
      await sweepEntrySurfaces({
        width: 320,
        tier: "phone",
        surfaces: ["invitation", "recovery-codes", "connecting", "failure"],
      });
    } finally {
      await setCoarsePointerEmulation(false);
      await page.viewport(1_280, 720);
    }
  });

  it("keeps the hosted entry surfaces on the desktop tier at 768×1024", async () => {
    // 768px is the first desktop-tier width: entry surfaces keep desktop
    // density (no 44px phone floor) and remain overflow-free.
    await page.viewport(768, 1_024);
    try {
      await sweepEntrySurfaces({
        width: 768,
        tier: "desktop",
        surfaces: ["sign-in", "node-directory"],
      });
      // Desktop-density guard: the phone-only 44px floor must not leak into
      // the desktop tier (size="lg" resolves below 44px there).
      hostedHubController.resetForTests();
      useHostedHubStore.setState({ bootstrapAvailable: true });
      mounted = await render(<HostedHubRoot />);
      const signIn = await vi.waitFor(() => {
        const button = findButtonByText("Sign in with passkey");
        expect(button).not.toBeNull();
        return button!;
      });
      expect(signIn.getBoundingClientRect().height).toBeLessThan(44);
    } finally {
      await page.viewport(1_280, 720);
    }
  });

  it("preserves invitation form input across a mid-size rotation tier flip", async () => {
    // Rotating a mid-size device across the 768px boundary flips the tier;
    // the entry surfaces restyle via CSS variants only, so typed form state
    // must survive both flips untouched.
    await page.viewport(700, 900);
    try {
      useHostedHubStore.setState({ bootstrapAvailable: true });
      mounted = await render(<HostedHubRoot />);
      await waitForTierAttribute("phone");
      await page.getByRole("button", { name: "Redeem invitation" }).click();
      await page.getByLabelText("Invitation code").fill("rotation-invitation-probe");
      await page.getByLabelText("Display name").fill("Rotation Ada");

      await page.viewport(780, 700);
      await waitForTierAttribute("desktop");
      await expect
        .element(page.getByLabelText("Invitation code"))
        .toHaveValue("rotation-invitation-probe");
      await expect.element(page.getByLabelText("Display name")).toHaveValue("Rotation Ada");
      expectNoDocumentHorizontalOverflow(780);

      await page.viewport(700, 900);
      await waitForTierAttribute("phone");
      await expect
        .element(page.getByLabelText("Invitation code"))
        .toHaveValue("rotation-invitation-probe");
      await expect.element(page.getByLabelText("Display name")).toHaveValue("Rotation Ada");
      expectNoDocumentHorizontalOverflow(700);
    } finally {
      await page.viewport(1_280, 720);
    }
  });

  it("survives 200% text scaling on the sign-in and node directory surfaces", async () => {
    // The entry layout is rem-based; doubling the root font size emulates
    // 200% browser text scaling. Controls must stay visible and the page
    // free of document-level horizontal overflow.
    await page.viewport(390, 844);
    const previousFontSize = document.documentElement.style.fontSize;
    document.documentElement.style.fontSize = "32px";
    try {
      useHostedHubStore.setState({ bootstrapAvailable: true });
      mounted = await render(<HostedHubRoot />);
      const signIn = await vi.waitFor(() => {
        const button = findButtonByText("Sign in with passkey");
        expect(button).not.toBeNull();
        return button!;
      });
      const signInBox = signIn.getBoundingClientRect();
      expect(signInBox.left).toBeGreaterThanOrEqual(0);
      expect(signInBox.right).toBeLessThanOrEqual(390);
      expectNoDocumentHorizontalOverflow(390);
      await mounted.unmount();
      mounted = null;
      hostedHubController.resetForTests();

      useHostedHubStore.setState({
        accountStatus: "authenticated",
        account,
        session,
        directoryStatus: "ready",
        browserStatus: "current",
        nodes: [selectedNode],
      });
      mounted = await render(<HostedHubRoot />);
      const row = await vi.waitFor(() => {
        const element =
          [...document.querySelectorAll<HTMLElement>("button")].find((button) =>
            button.textContent?.includes("Studio node"),
          ) ?? null;
        expect(element).not.toBeNull();
        return element!;
      });
      const rowBox = row.getBoundingClientRect();
      expect(rowBox.left).toBeGreaterThanOrEqual(0);
      expect(rowBox.right).toBeLessThanOrEqual(390);
      expectNoDocumentHorizontalOverflow(390);
    } finally {
      document.documentElement.style.fontSize = previousFontSize;
      await page.viewport(1_280, 720);
    }
  });

  it("contains the connection sheet at 320px and on a coarse landscape phone with reduced motion honored", async () => {
    const seedConnectedState = () => {
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
    };
    const sheetPopup = () => document.querySelector<HTMLElement>('[data-slot="sheet-popup"]');
    const assertSheetContained = async (width: number) => {
      const sheet = await vi.waitFor(() => {
        const element = sheetPopup();
        expect(element).not.toBeNull();
        return element!;
      });
      await vi.waitFor(() => {
        const rect = sheet.getBoundingClientRect();
        expect(rect.left).toBeGreaterThanOrEqual(-0.5);
        expect(rect.right).toBeLessThanOrEqual(width + 0.5);
      });
      expectNoDocumentHorizontalOverflow(width);
      // The bounded control set stays reachable with 44px rows.
      for (const label of ["All nodes", "Refresh nodes", "Sign out"] as const) {
        const control = await vi.waitFor(() => {
          const element = findButtonByText(label);
          expect(element, `Missing sheet control ${label}.`).not.toBeNull();
          return element!;
        });
        expect(control.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
        expect(control.getBoundingClientRect().right).toBeLessThanOrEqual(width + 0.5);
      }
      return sheet;
    };

    // 320×568 portrait: the sheet and its controls fit the narrowest phone.
    await page.viewport(320, 568);
    seedConnectedState();
    mounted = await render(<HostedConnectionPill />);
    const pill = page.getByTestId("hosted-connection-pill");
    await expect.element(pill).toBeVisible();
    expect((pill.element() as HTMLElement).getBoundingClientRect().right).toBeLessThanOrEqual(320);
    await pill.click();
    await assertSheetContained(320);
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => {
      expect(sheetPopup()).toBeNull();
    });
    await mounted.unmount();
    mounted = null;
    hostedHubController.resetForTests();

    // 844×390 coarse landscape: the pill grows to the coarse 44px floor and
    // the sheet stays contained; with reduced motion emulated, the popup's
    // transition is disabled (motion-reduce holds behaviorally).
    await page.viewport(844, 390);
    await setCoarsePointerEmulation(true);
    try {
      await cdpSession().send("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-reduced-motion", value: "reduce" }],
      });
      await vi.waitFor(() => {
        expect(window.matchMedia("(prefers-reduced-motion: reduce)").matches).toBe(true);
      });
      seedConnectedState();
      mounted = await render(<HostedConnectionPill />);
      const landscapePill = page.getByTestId("hosted-connection-pill");
      await expect.element(landscapePill).toBeVisible();
      await vi.waitFor(() => {
        expect(
          (landscapePill.element() as HTMLElement).getBoundingClientRect().height,
        ).toBeGreaterThanOrEqual(44);
      });
      await landscapePill.click();
      const sheet = await assertSheetContained(844);
      expect(sheet.className).toContain("motion-reduce:transition-none");
      expect(getComputedStyle(sheet).transitionProperty).toBe("none");
      await userEvent.keyboard("{Escape}");
      await vi.waitFor(() => {
        expect(sheetPopup()).toBeNull();
      });
    } finally {
      await cdpSession().send("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-reduced-motion", value: "" }],
      });
      await setCoarsePointerEmulation(false);
    }
  });
});
