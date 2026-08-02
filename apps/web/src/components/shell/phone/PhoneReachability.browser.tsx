// The reachability family. This is the assertion the whole dock step exists to
// satisfy, so it measures geometry — never a class name, a data attribute, or
// the presence of a component.
//
// The measured baseline it replaces, at 390×844 under true coarse-pointer
// emulation: Home placed 16 of 16 interactive controls in the top third and
// zero in the middle or lower third; on Thread the workspace toggle (32×32) and
// the thread-actions kebab (36×36) sat in the top-right corner specifically.
// The base control's `::before` resolves to `inset: 0`, so effective touch size
// equals visual size and hit-slop rescues nothing.
import "../../../index.css";

import { EnvironmentId, ProviderInstanceId, type ProjectId, type ThreadId } from "@ryco/contracts";
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

import { resetPointerEmulation, setCoarsePointerEmulation } from "../../../../test/browserPointer";
import { syncDocumentPresentationTier } from "../../../lib/presentationTier";
import { usePresentationTier } from "../../../hooks/usePresentationTier";
import { useStore, type EnvironmentState } from "../../../store";
import type { SidebarThreadSummary } from "../../../types";
import { useUiStateStore } from "../../../uiStateStore";
import { SidebarInset, SidebarProvider } from "../../ui/sidebar";
import type { SessionTabItem } from "../../../sessionTabs.selectors";
import { PhoneHome } from "./PhoneHome";
import { PhoneThreadAppBar } from "./PhoneThreadAppBar";
import { PhoneThreadDock } from "./PhoneThreadDock";

const ENV_ID = EnvironmentId.make("environment-local");
const PROJECT_A = "project-a" as ProjectId;
const THREAD_A = "thread-a" as ThreadId;
const NOW_ISO = "2026-07-20T00:00:00.000Z";

/**
 * Enough threads that the Home list genuinely overflows the tallest viewport
 * under test. `lets the last list row clear the dock` is meaningless without
 * it: with one row the scroll container never scrolls, and the assertion then
 * compares a row near the top of the screen against a capsule near the bottom,
 * which is true of any layout.
 */
const OVERFLOW_THREAD_COUNT = 40;
const THREAD_IDS: ReadonlyArray<ThreadId> = Array.from(
  { length: OVERFLOW_THREAD_COUNT },
  (_unused, index) => (index === 0 ? THREAD_A : (`thread-${index}` as ThreadId)),
);

/** Two sessions, so the strip renders its full pill inventory under test. */
const SESSION_TABS: ReadonlyArray<SessionTabItem> = [
  { key: "session-a", title: "Session A" },
  { key: "session-b", title: "Session B" },
] as unknown as ReadonlyArray<SessionTabItem>;

/**
 * **The enumerated "primary and frequent" inventory**, stated by accessible
 * name so the assertion below cannot be quietly narrowed later. Every entry is
 * a control a phone user reaches repeatedly in a session; each one's centre
 * must fall in the bottom third of the viewport, and none may sit in the
 * top-right corner.
 *
 * **Home** — the three controls the audit found stranded in the top-right:
 * search, New thread, settings.
 *
 * **Thread** — the workspace toggle and the thread-actions kebab, which the
 * audit found in the top-right corner specifically, plus the two contextual
 * entry points that were buried one level down inside the kebab sheet.
 *
 * Deliberately **not** in the inventory, each for a stated reason:
 *
 * - `Back to threads` and the hosted connection indicator. The design keeps
 *   back, title and the connection indicator as the thread app bar's
 *   top-anchored chrome, and title plus the indicator as Home's. They are
 *   navigation and status chrome, not the surface's actions. Moving back to the
 *   bottom would contradict the design's own per-screen layout.
 * - Thread rows, their kebabs, and project headers on Home. Those are content,
 *   scroll with the list, and already met the 44 px floor in the audit.
 * - The composer, its send action and its footer controls. They are already the
 *   bottom-most element of the thread surface by construction.
 */
const PRIMARY_AND_FREQUENT: Record<"home" | "thread", ReadonlyArray<string>> = {
  home: ["Search threads", "New thread", "Open settings"],
  thread: [
    "Toggle workspace panel",
    "Thread actions",
    "Find in thread",
    "Source control feat-x",
    "Sessions 2",
  ],
};

/** Portrait phone widths the design names, narrowest to widest. */
const PORTRAIT_VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
] as const;

/**
 * The coarse-landscape exemption's viewport. It classifies as a phone only
 * through the tier's `(pointer: coarse) and (max-height: 499px)` clause.
 */
const COARSE_LANDSCAPE = { width: 844, height: 390 } as const;

function summary(threadId: ThreadId, projectId: ProjectId, title: string): SidebarThreadSummary {
  return {
    id: threadId,
    environmentId: ENV_ID,
    projectId,
    title,
    interactionMode: "default",
    session: null,
    createdAt: NOW_ISO,
    archivedAt: null,
    latestTurn: null,
    branch: null,
    worktreePath: null,
    latestUserMessageAt: NOW_ISO,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
  };
}

function environmentState(): EnvironmentState {
  return {
    projectIds: [PROJECT_A],
    projectById: {
      [PROJECT_A]: {
        id: PROJECT_A,
        environmentId: ENV_ID,
        name: "Alpha",
        cwd: "/repo/alpha",
        repositoryIdentity: null,
        defaultModelSelection: null,
        scripts: [],
      },
    },
    worktreeIds: [],
    worktreeIdsByProjectId: {},
    worktreeById: {},
    threadIds: [...THREAD_IDS],
    threadIdsByProjectId: { [PROJECT_A]: [...THREAD_IDS] },
    threadShellById: {
      [THREAD_A]: {
        id: THREAD_A,
        environmentId: ENV_ID,
        codexThreadId: null,
        projectId: PROJECT_A,
        title: "Alpha thread",
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
        runtimeMode: "full-access",
        interactionMode: "default",
        error: null,
        createdAt: NOW_ISO,
        archivedAt: null,
        branch: null,
        worktreePath: null,
      },
    },
    threadSessionById: { [THREAD_A]: null },
    threadTurnStateById: {},
    messageIdsByThreadId: {},
    messageByThreadId: {},
    pendingMessagesByThreadId: {},
    activityIdsByThreadId: {},
    activityByThreadId: {},
    proposedPlanIdsByThreadId: {},
    proposedPlanByThreadId: {},
    turnDiffIdsByThreadId: {},
    turnDiffSummaryByThreadId: {},
    sidebarThreadSummaryById: Object.fromEntries(
      THREAD_IDS.map((threadId, index) => [
        threadId,
        summary(threadId, PROJECT_A, index === 0 ? "Alpha thread" : `Alpha thread ${index}`),
      ]),
    ),
    bootstrapComplete: true,
  };
}

/**
 * The thread surface's chrome, laid out exactly as `ChatView` lays it out on
 * the phone tier: the app bar in the header, the timeline taking the remaining
 * height, and the dock row sitting with the composer inside the bottom-anchored
 * input bar. The tier gate is `ChatView`'s own — `usePresentationTier() ===
 * "phone"` — so the desktop case below exercises the same condition.
 *
 * **The `SidebarInset` wrapper is load-bearing, not decoration.** Production
 * reaches `ChatView` through `ChatThreadRouteView` → `SidebarInset`, whose
 * `w-full flex-1` makes the thread column viewport-wide. Mounting the column
 * directly under `SidebarProvider`'s flex wrapper instead makes it a
 * content-sized flex item — measured at 151 px inside a 320 px viewport — and
 * every horizontal assertion below (the top-right corner, on-screen bounds,
 * page overflow) then passes vacuously. `mirrors production's column width`
 * pins this so the artifact cannot come back.
 */
function ThreadSurface() {
  const isPhoneTier = usePresentationTier() === "phone";
  return (
    <SidebarInset className="h-svh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground md:h-dvh">
      <div
        data-testid="thread-column"
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background"
      >
        <header className="border-b border-border bg-muted/24 pl-[calc(env(safe-area-inset-left)+0.75rem)] pr-[calc(env(safe-area-inset-right)+0.75rem)] phone:pt-safe">
          {isPhoneTier ? (
            <PhoneThreadAppBar environmentId={ENV_ID} threadId={THREAD_A} title="Alpha thread" />
          ) : (
            <div data-testid="desktop-thread-header" className="py-2 text-sm">
              Alpha thread
            </div>
          )}
        </header>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto" data-testid="timeline">
            <div style={{ height: "1200px" }} />
          </div>
          <div className="flex min-h-0 flex-col justify-end px-3 pt-1.5 pb-[calc(max(env(safe-area-inset-bottom),var(--app-keyboard-inset,0px))+0.75rem)]">
            {isPhoneTier ? (
              <PhoneThreadDock
                environmentId={ENV_ID}
                threadId={THREAD_A}
                title="Alpha thread"
                projectCwd="/repo/alpha"
                branch="feat-x"
                draft={null}
                workspacePanelOpen={false}
                onToggleWorkspacePanel={() => {}}
                onOpenFindInThread={() => {}}
                onOpenSourceControl={() => {}}
                sessionTabs={SESSION_TABS}
                activeSessionTabKey="session-a"
                onSelectSessionTab={() => {}}
              />
            ) : null}
            <div className="rounded-3xl border border-border p-3 text-sm">Composer</div>
          </div>
        </div>
      </div>
    </SidebarInset>
  );
}

/**
 * Resolved by accessible name, so the inventory above names controls the way a
 * screen-reader user hears them rather than by a test-only hook.
 */
function control(name: string): HTMLElement {
  return page.getByRole("button", { name, exact: true }).element() as HTMLElement;
}

/**
 * Hit-tests the top-right corner — the right half of the top third — and
 * asserts none of the named controls answers anywhere in it. Sampling the
 * region is what makes the claim falsifiable: it fails if a control is put
 * back there, and it does not depend on the bottom-third assertion holding.
 */
function expectTopRightCornerFree(
  viewport: { readonly width: number; readonly height: number },
  names: ReadonlyArray<string>,
): void {
  const wanted = new Set(names.map((name) => control(name)));
  const samples = 12;
  for (let column = 0; column <= samples; column += 1) {
    for (let row = 0; row <= samples; row += 1) {
      const x = viewport.width / 2 + ((viewport.width / 2 - 1) * column) / samples;
      const y = (((viewport.height / 3) * row) / samples) | 0;
      const hit = document.elementFromPoint(x, y);
      const owner = [...wanted].find((element) => hit !== null && element.contains(hit));
      expect(
        owner === undefined,
        `"${owner?.getAttribute("aria-label") ?? owner?.textContent?.trim()}" answers the top-right corner at (${Math.round(x)}, ${y})`,
      ).toBe(true);
    }
  }
}

function expectNoHorizontalOverflow(width: number): void {
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
  expect(document.body.scrollWidth).toBeLessThanOrEqual(width);
}

let mounted: Awaited<ReturnType<typeof render>> | null = null;

async function renderSurface(surface: "home" | "thread"): Promise<void> {
  await mounted?.unmount();
  mounted = await render(
    <SidebarProvider>{surface === "home" ? <PhoneHome /> : <ThreadSurface />}</SidebarProvider>,
  );
}

describe("phone reachability", () => {
  beforeAll(() => {
    syncDocumentPresentationTier();
  });

  beforeEach(() => {
    localStorage.clear();
    navigate.mockClear();
    useStore.setState({
      activeEnvironmentId: ENV_ID,
      environmentStateById: { [ENV_ID]: environmentState() },
    });
  });

  afterEach(async () => {
    await mounted?.unmount();
    mounted = null;
    useStore.setState({ activeEnvironmentId: null, environmentStateById: {} });
    useUiStateStore.setState({ pinnedThreadKeys: {}, projectExpandedById: {} });
    vi.restoreAllMocks();
    document.body.innerHTML = "";
    await resetPointerEmulation();
    await page.viewport(1_280, 720);
  });

  it("puts every primary and frequent action's centre in the bottom third on Home and Thread", async () => {
    for (const viewport of PORTRAIT_VIEWPORTS) {
      await page.viewport(viewport.width, viewport.height);
      await setCoarsePointerEmulation(true);
      await vi.waitFor(() => {
        expect(document.documentElement.getAttribute("data-tier")).toBe("phone");
      });
      expect(window.matchMedia("(pointer: coarse)").matches).toBe(true);

      for (const surface of ["home", "thread"] as const) {
        await renderSurface(surface);
        const twoThirds = (viewport.height * 2) / 3;

        {
          const column = document.querySelector<HTMLElement>(
            surface === "thread"
              ? '[data-testid="thread-column"]'
              : '[data-testid="phone-home-list"]',
          );
          expect(
            column?.getBoundingClientRect().width,
            `${surface} column width at ${viewport.width}`,
          ).toBe(viewport.width);
        }
        for (const name of PRIMARY_AND_FREQUENT[surface]) {
          const element = control(name);
          // A pill parked past the context strip's fold is reachable by
          // scrolling the rail — that is the primitive's contract — so it is
          // brought into the rail's view before its position is measured. The
          // page itself never scrolls horizontally, which is asserted below.
          element.scrollIntoView({ block: "nearest", inline: "nearest" });
          const rect = element.getBoundingClientRect();
          const centre = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
          const where = `${surface} "${name}" at ${viewport.width}×${viewport.height}`;

          // The assertion this whole step exists to satisfy.
          expect(centre.y, `${where}: centre above the bottom third`).toBeGreaterThan(twoThirds);

          // Effective touch size equals visual size on this tier, so the
          // border box is the measurement.
          expect(rect.width, `${where}: width`).toBeGreaterThanOrEqual(44);
          expect(rect.height, `${where}: height`).toBeGreaterThanOrEqual(44);

          // Fully on-screen at every tested width.
          expect(rect.left, `${where}: off-screen left`).toBeGreaterThanOrEqual(0);
          expect(rect.right, `${where}: off-screen right`).toBeLessThanOrEqual(
            viewport.width + 0.5,
          );
        }

        // The top-right corner holds none of them. This is hit-tested over the
        // region rather than derived from the centres above — deriving it
        // would make it true by construction, since a centre below two thirds
        // cannot also be above one third. Restoring any of these controls to
        // the app bar's top-right corner fails here.
        expectTopRightCornerFree(viewport, PRIMARY_AND_FREQUENT[surface]);

        expectNoHorizontalOverflow(viewport.width);
      }
    }
  });

  it("asserts the coarse-landscape exemption rather than skipping it", async () => {
    // The exemption's premise is what the dock COSTS in landscape, and it is
    // measured on both orientations rather than restated from the constants
    // above: the capsule plus the gap it floats over takes a far larger share
    // of a 390px-tall viewport than of an 844px one, and the lower third it
    // would have to live in is only ~130px. That is why the design exempts
    // bottom-anchored navigation here.
    const dockViewportShare = (): number => {
      const capsule = document.querySelector<HTMLElement>('[data-slot="mobile-dock"]')!;
      const rect = capsule.getBoundingClientRect();
      return (rect.height + (window.innerHeight - rect.bottom)) / window.innerHeight;
    };

    await page.viewport(390, 844);
    await setCoarsePointerEmulation(true);
    await renderSurface("home");
    const portraitShare = dockViewportShare();

    await page.viewport(COARSE_LANDSCAPE.width, COARSE_LANDSCAPE.height);
    await vi.waitFor(() => {
      expect(document.documentElement.getAttribute("data-tier")).toBe("phone");
    });
    await renderSurface("home");
    const landscapeShare = dockViewportShare();

    expect(window.innerHeight).toBe(COARSE_LANDSCAPE.height);
    expect(
      window.innerHeight / 3,
      "the lower third is not the ~130px the exemption assumes",
    ).toBeLessThanOrEqual(140);
    expect(
      landscapeShare,
      "the dock costs no more of a landscape viewport than a portrait one, so the exemption has no premise",
    ).toBeGreaterThan(portraitShare * 1.8);

    for (const surface of ["home", "thread"] as const) {
      await renderSurface(surface);
      // What is still required in landscape: chrome stays reachable — every
      // enumerated action is on-screen, keeps its 44px target, and is not
      // clipped — and the page still does not scroll horizontally.
      for (const name of PRIMARY_AND_FREQUENT[surface]) {
        const element = control(name);
        element.scrollIntoView({ block: "nearest", inline: "nearest" });
        const rect = element.getBoundingClientRect();
        const where = `${surface} "${name}" in coarse landscape`;
        expect(rect.width, `${where}: width`).toBeGreaterThanOrEqual(44);
        expect(rect.height, `${where}: height`).toBeGreaterThanOrEqual(44);
        expect(rect.left, `${where}: off-screen left`).toBeGreaterThanOrEqual(0);
        expect(rect.right, `${where}: off-screen right`).toBeLessThanOrEqual(
          COARSE_LANDSCAPE.width + 0.5,
        );
        expect(rect.top, `${where}: off-screen top`).toBeGreaterThanOrEqual(0);
        expect(rect.bottom, `${where}: off-screen bottom`).toBeLessThanOrEqual(
          COARSE_LANDSCAPE.height + 0.5,
        );

        // Measured outcome, recorded rather than assumed: the bottom-third
        // property the exemption releases is in fact STILL met at 844×390 —
        // Home's actions centre at y≈343 and Thread's at y≈304, against a
        // two-thirds line of 260. The exemption is therefore available but
        // unexercised, so this pins the better-than-required behaviour. A
        // future layout that genuinely needs the exemption fails here and has
        // to invoke it deliberately, which is the point of asserting it.
        expect(
          rect.top + rect.height / 2,
          `${where}: centre above the bottom third — invoke the landscape exemption deliberately if this is intended`,
        ).toBeGreaterThan((COARSE_LANDSCAPE.height * 2) / 3);
      }
      expectNoHorizontalOverflow(COARSE_LANDSCAPE.width);
    }
  });

  it("lets the last list row clear the dock instead of resting permanently behind it", async () => {
    await page.viewport(390, 844);
    await setCoarsePointerEmulation(true);
    await renderSurface("home");

    const list = document.querySelector<HTMLElement>('[data-testid="phone-home-list"]')!;
    // The dock is an overlay, so the surface adds bottom scroll padding rather
    // than reserving layout height for it.
    const clearance = Number.parseFloat(getComputedStyle(list).paddingBottom);
    const capsule = document.querySelector<HTMLElement>('[data-slot="mobile-dock"]')!;
    const capsuleRect = capsule.getBoundingClientRect();
    expect(clearance).toBeGreaterThanOrEqual(capsuleRect.height + (844 - capsuleRect.bottom) - 0.5);

    // The list must genuinely overflow, or scrolling to the end proves nothing.
    expect(list.scrollHeight).toBeGreaterThan(list.clientHeight + 100);
    const rows = [...list.querySelectorAll<HTMLElement>('[role="listitem"]')];
    expect(rows.length).toBe(OVERFLOW_THREAD_COUNT);
    const lastRowBefore = rows.at(-1)!.getBoundingClientRect().top;

    list.scrollTop = list.scrollHeight;
    await vi.waitFor(() => {
      expect(list.scrollTop).toBeGreaterThan(100);
    });
    // …and the scroll actually moved the content.
    expect(rows.at(-1)!.getBoundingClientRect().top).toBeLessThan(lastRowBefore - 100);
    // Scrolled to the end, the last row clears the capsule rather than resting
    // permanently behind it.
    expect(list.scrollTop).toBeGreaterThanOrEqual(list.scrollHeight - list.clientHeight - 1);
    expect(rows.at(-1)!.getBoundingClientRect().bottom).toBeLessThanOrEqual(capsuleRect.top + 0.5);
  });

  it("mounts no dock on the desktop tier", async () => {
    await page.viewport(1_280, 720);
    await vi.waitFor(() => {
      expect(document.documentElement.getAttribute("data-tier")).toBe("desktop");
    });
    await renderSurface("thread");

    // The gate is `ChatView`'s own tier condition, so the desktop tier keeps
    // its existing header and gains nothing from this step.
    expect(document.querySelector('[data-testid="desktop-thread-header"]')).not.toBeNull();
    expect(document.querySelector('[data-slot="phone-thread-dock"]')).toBeNull();
    expect(document.querySelector('[data-slot="mobile-dock"]')).toBeNull();
    expect(document.querySelector('[data-slot="mobile-context-strip"]')).toBeNull();
    // Resolved by accessible name, because the strip's pills carry no
    // `aria-label` — querying one would be a selector that can never match.
    for (const name of PRIMARY_AND_FREQUENT.thread) {
      expect(
        page.getByRole("button", { name, exact: true }).elements(),
        `desktop tier renders "${name}"`,
      ).toHaveLength(0);
    }
    expectNoHorizontalOverflow(1_280);
  });
});
