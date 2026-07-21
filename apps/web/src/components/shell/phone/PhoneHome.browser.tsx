// Production CSS is part of the behavior under test: row heights and the
// phone tier variants drive the touch-target assertions.
import "../../../index.css";

import {
  EnvironmentId,
  ProviderInstanceId,
  type EnvironmentApi,
  type ProjectId,
  type ThreadId,
  type WorktreeId,
} from "@ryco/contracts";
import { scopedThreadKey, scopeThreadRef } from "@ryco/client-runtime";
import { page, userEvent } from "vite-plus/test/browser";
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

import {
  __resetEnvironmentApiOverridesForTests,
  __setEnvironmentApiOverrideForTests,
} from "../../../environmentApi";
import { clearHostedNodeScopedState } from "../../../hostedHub/environment";
import { syncDocumentPresentationTier } from "../../../lib/presentationTier";
import { useStore, type EnvironmentState } from "../../../store";
import type { SidebarThreadSummary } from "../../../types";
import { useUiStateStore } from "../../../uiStateStore";
import { SidebarProvider } from "../../ui/sidebar";
import { PhoneHome } from "./PhoneHome";

const ENV_ID = EnvironmentId.make("environment-local");
const PROJECT_A = "project-a" as ProjectId;
const PROJECT_B = "project-b" as ProjectId;
const THREAD_A = "thread-a" as ThreadId;
const THREAD_B = "thread-b" as ThreadId;
const THREAD_C = "thread-c" as ThreadId;
const WORKTREE_MAIN = "worktree-main" as WorktreeId;
const WORKTREE_FEATURE = "worktree-feature" as WorktreeId;
const THREAD_A_KEY = scopedThreadKey(scopeThreadRef(ENV_ID, THREAD_A));
const NOW_ISO = "2026-07-20T00:00:00.000Z";
const LONG_PRESS_HOLD_MS = 600;

async function dispatchLongPress(element: HTMLElement, moveByPx = 0): Promise<void> {
  const rect = element.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  element.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      pointerId: 11,
      isPrimary: true,
      button: 0,
      clientX: x,
      clientY: y,
      pointerType: "touch",
    }),
  );
  if (moveByPx > 0) {
    element.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        cancelable: true,
        pointerId: 11,
        isPrimary: true,
        clientX: x,
        clientY: y + moveByPx,
        pointerType: "touch",
      }),
    );
  }
  await new Promise((resolve) => setTimeout(resolve, LONG_PRESS_HOLD_MS));
  element.dispatchEvent(
    new PointerEvent("pointerup", {
      bubbles: true,
      cancelable: true,
      pointerId: 11,
      isPrimary: true,
      button: 0,
      clientX: x,
      clientY: y + moveByPx,
      pointerType: "touch",
    }),
  );
}

function worktreeSummary(
  worktreeId: WorktreeId,
  branch: string,
  worktreePath: string | null,
  origin: "main" | "branch",
) {
  return {
    id: worktreeId,
    environmentId: ENV_ID,
    projectId: PROJECT_B,
    title: null,
    branch,
    worktreePath,
    origin,
    prNumber: null,
    issueNumber: null,
    prTitle: null,
    issueTitle: null,
    prState: null,
    prIsDraft: null,
    issueState: null,
    workItemProvider: null,
    workItemKey: null,
    workItemTitle: null,
    workItemState: null,
    workItemStateName: null,
    workItemUrl: null,
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
    archivedAt: null,
    manualPosition: origin === "main" ? 0 : 1,
  };
}

function summary(
  threadId: ThreadId,
  projectId: ProjectId,
  title: string,
  overrides: Partial<SidebarThreadSummary> = {},
): SidebarThreadSummary {
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
    ...overrides,
  };
}

function project(projectId: ProjectId, name: string, cwd: string) {
  return {
    id: projectId,
    environmentId: ENV_ID,
    name,
    cwd,
    repositoryIdentity: null,
    defaultModelSelection: null,
    scripts: [],
  };
}

function environmentState(): EnvironmentState {
  return {
    projectIds: [PROJECT_A, PROJECT_B],
    projectById: {
      [PROJECT_A]: project(PROJECT_A, "Alpha", "/repo/alpha"),
      [PROJECT_B]: project(PROJECT_B, "Beta", "/repo/beta"),
    },
    worktreeIds: [],
    worktreeIdsByProjectId: {},
    worktreeById: {},
    threadIds: [THREAD_A, THREAD_B],
    threadIdsByProjectId: { [PROJECT_A]: [THREAD_A], [PROJECT_B]: [THREAD_B] },
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
    sidebarThreadSummaryById: {
      [THREAD_A]: summary(THREAD_A, PROJECT_A, "Alpha thread"),
      [THREAD_B]: summary(THREAD_B, PROJECT_B, "Beta running thread", {
        hasPendingApprovals: true,
      }),
    },
    bootstrapComplete: true,
  };
}

function seedStores() {
  useStore.setState({
    activeEnvironmentId: ENV_ID,
    environmentStateById: { [ENV_ID]: environmentState() },
  });
  useUiStateStore.setState({ pinnedThreadKeys: { [THREAD_A_KEY]: true } });
}

let mounted: Awaited<ReturnType<typeof render>> | null = null;

describe("PhoneHome", () => {
  beforeAll(() => {
    syncDocumentPresentationTier();
  });

  beforeEach(async () => {
    await page.viewport(390, 844);
    localStorage.clear();
    navigate.mockClear();
    seedStores();
  });

  afterEach(async () => {
    await mounted?.unmount();
    mounted = null;
    __resetEnvironmentApiOverridesForTests();
    useStore.setState({ activeEnvironmentId: null, environmentStateById: {} });
    useUiStateStore.setState({ pinnedThreadKeys: {}, projectExpandedById: {} });
    vi.restoreAllMocks();
    document.body.innerHTML = "";
    await page.viewport(1_280, 720);
  });

  it("renders the project-grouped thread list from the live stores with visible status and touch-sized rows", async () => {
    mounted = await render(
      <SidebarProvider>
        <PhoneHome />
      </SidebarProvider>,
    );

    await expect.element(page.getByRole("heading", { name: "Threads" })).toBeVisible();
    await expect.element(page.getByText("Alpha", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Beta", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Alpha thread")).toBeVisible();
    await expect.element(page.getByText("Beta running thread")).toBeVisible();
    // Always-visible status: text plus indicator, not a hover affordance.
    await expect.element(page.getByText("Pending Approval")).toBeVisible();
    // Pinned marker from the live uiState store.
    await expect.element(page.getByRole("img", { name: "Pinned" })).toBeVisible();

    // Rows and kebabs meet the 44 px phone touch target.
    const row = page.getByText("Alpha thread").element().closest('[role="listitem"]');
    expect(row).not.toBeNull();
    expect((row as HTMLElement).getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    const kebab = page.getByRole("button", { name: "Thread actions for Alpha thread" }).element();
    expect(kebab.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    expect(kebab.getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
    // No page-level horizontal overflow at the phone viewport.
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  });

  it("navigates into a thread from a row", async () => {
    mounted = await render(
      <SidebarProvider>
        <PhoneHome />
      </SidebarProvider>,
    );

    await page.getByText("Alpha thread").click();
    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "/$environmentId/$threadId",
        params: expect.objectContaining({ threadId: THREAD_A }),
      }),
    );
  });

  it("exposes the full shared action inventory in the kebab sheet and dispatches through the shared handlers", async () => {
    const dispatchCommand = vi.fn(async () => undefined);
    __setEnvironmentApiOverrideForTests(ENV_ID, {
      orchestration: { dispatchCommand },
    } as unknown as EnvironmentApi);

    mounted = await render(
      <SidebarProvider>
        <PhoneHome />
      </SidebarProvider>,
    );

    // Full inventory for a pinned, archivable thread.
    await page.getByRole("button", { name: "Thread actions for Alpha thread" }).click();
    for (const label of [
      "Unpin thread",
      "Rename thread",
      "Mark unread",
      "Copy Path",
      "Copy Thread ID",
      "Archive session",
      "Delete thread",
    ]) {
      await expect.element(page.getByRole("button", { name: label })).toBeVisible();
    }

    // Pin round-trip through the live uiState store.
    await page.getByRole("button", { name: "Unpin thread" }).click();
    await vi.waitFor(() => {
      expect(useUiStateStore.getState().pinnedThreadKeys[THREAD_A_KEY]).toBeUndefined();
    });

    // Rename round-trip through the existing environment-api mock.
    await page.getByRole("button", { name: "Thread actions for Alpha thread" }).click();
    await page.getByRole("button", { name: "Pin thread" }).click();
    await page.getByRole("button", { name: "Thread actions for Alpha thread" }).click();
    await page.getByRole("button", { name: "Rename thread" }).click();
    const renameInput = page.getByLabelText("Thread title");
    await expect.element(renameInput).toBeVisible();
    await renameInput.fill("Alpha thread renamed");
    await page.getByRole("button", { name: "Rename", exact: true }).click();
    await vi.waitFor(() => {
      expect(dispatchCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "thread.meta.update",
          threadId: THREAD_A,
          title: "Alpha thread renamed",
        }),
      );
    });

    // Archive round-trip through the same shared handler.
    await page.getByRole("button", { name: "Thread actions for Alpha thread" }).click();
    await page.getByRole("button", { name: "Archive session" }).click();
    await vi.waitFor(() => {
      expect(dispatchCommand).toHaveBeenCalledWith(
        expect.objectContaining({ type: "thread.archive", threadId: THREAD_A }),
      );
    });
  });

  it("supports the keyboard flow from a thread row through the kebab action sheet", async () => {
    mounted = await render(
      <SidebarProvider>
        <PhoneHome />
      </SidebarProvider>,
    );

    // The row and its kebab are reachable in tab order: the kebab follows
    // the row button directly.
    const rowButton = page
      .getByText("Alpha thread")
      .element()
      .closest("button") as HTMLButtonElement;
    expect(rowButton).not.toBeNull();
    rowButton.focus();
    expect(document.activeElement).toBe(rowButton);
    await userEvent.keyboard("{Tab}");
    const kebab = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Thread actions for Alpha thread"]',
    )!;
    expect(document.activeElement).toBe(kebab);

    // Enter opens the bottom-sheet action inventory and moves focus inside.
    await userEvent.keyboard("{Enter}");
    const sheet = await vi.waitFor(() => {
      const popup = document.querySelector<HTMLElement>('[data-slot="sheet-popup"]');
      expect(popup).not.toBeNull();
      return popup!;
    });
    await vi.waitFor(() => {
      expect(sheet.contains(document.activeElement)).toBe(true);
    });

    // Focus is trapped: tabbing cycles within the sheet.
    for (let index = 0; index < 12; index += 1) {
      await userEvent.keyboard("{Tab}");
      expect(sheet.contains(document.activeElement)).toBe(true);
    }

    // Escape closes the sheet and focus returns to the kebab.
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => {
      expect(document.querySelector('[data-slot="sheet-popup"]')).toBeNull();
    });
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(kebab);
    });
  });

  it("opens the thread action sheet from a long-press without hijacking scroll", async () => {
    mounted = await render(
      <SidebarProvider>
        <PhoneHome />
      </SidebarProvider>,
    );
    const rowButton = await vi.waitFor(() => {
      const button = page.getByText("Alpha thread").element().closest("button");
      expect(button).not.toBeNull();
      return button as HTMLButtonElement;
    });

    // A >10px drag (scroll gesture) cancels the press: no sheet opens.
    await dispatchLongPress(rowButton, 24);
    expect(document.querySelector('[data-slot="sheet-popup"]')).toBeNull();
    expect(window.getSelection()?.toString() ?? "").toBe("");

    // A stationary long-press opens the same shared action inventory as the
    // visible kebab.
    await dispatchLongPress(rowButton);
    await vi.waitFor(() => {
      expect(document.querySelector('[data-slot="sheet-popup"]')).not.toBeNull();
    });
    await expect.element(page.getByRole("button", { name: "Unpin thread" })).toBeVisible();
    // The long-press did not also navigate into the thread.
    expect(navigate).not.toHaveBeenCalled();
  });

  it("layers worktree sections into project groups with collapsed-by-default touch and keyboard rows", async () => {
    const state = environmentState();
    state.threadIds = [THREAD_A, THREAD_B, THREAD_C];
    state.threadIdsByProjectId = {
      [PROJECT_A]: [THREAD_A],
      [PROJECT_B]: [THREAD_B, THREAD_C],
    };
    state.sidebarThreadSummaryById = {
      ...state.sidebarThreadSummaryById,
      [THREAD_C]: summary(THREAD_C, PROJECT_B, "Beta worktree thread", {
        branch: "feat-x",
        worktreePath: "/repo/beta-wt",
      }),
    };
    state.worktreeIds = [WORKTREE_MAIN, WORKTREE_FEATURE];
    state.worktreeIdsByProjectId = { [PROJECT_B]: [WORKTREE_MAIN, WORKTREE_FEATURE] };
    state.worktreeById = {
      [WORKTREE_MAIN]: worktreeSummary(WORKTREE_MAIN, "main", null, "main"),
      [WORKTREE_FEATURE]: worktreeSummary(WORKTREE_FEATURE, "feat-x", "/repo/beta-wt", "branch"),
    };
    useStore.setState({
      activeEnvironmentId: ENV_ID,
      environmentStateById: { [ENV_ID]: state },
    });

    mounted = await render(
      <SidebarProvider>
        <PhoneHome />
      </SidebarProvider>,
    );

    // The multi-worktree project renders collapsed sections; its threads are
    // not in the flat list.
    const mainHeader = await vi.waitFor(() => {
      const header = page.getByRole("button", { name: "main 1" }).element() as HTMLButtonElement;
      expect(header).not.toBeNull();
      return header;
    });
    const featureHeader = page
      .getByRole("button", { name: "feat-x 1" })
      .element() as HTMLButtonElement;
    expect(mainHeader.getAttribute("aria-expanded")).toBe("false");
    expect(featureHeader.getAttribute("aria-expanded")).toBe("false");
    expect(mainHeader.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    expect(featureHeader.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    await expect.element(page.getByText("Beta running thread")).not.toBeInTheDocument();
    await expect.element(page.getByText("Beta worktree thread")).not.toBeInTheDocument();

    // The single-worktree project keeps its flat list.
    await expect.element(page.getByText("Alpha thread")).toBeVisible();

    // Tap expands a section and reveals its sessions in tree order.
    featureHeader.click();
    await expect.element(page.getByText("Beta worktree thread")).toBeVisible();
    expect(featureHeader.getAttribute("aria-expanded")).toBe("true");

    // Keyboard: Enter toggles the section, matching the desktop tree rows.
    mainHeader.focus();
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByText("Beta running thread")).toBeVisible();
    expect(mainHeader.getAttribute("aria-expanded")).toBe("true");
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByText("Beta running thread")).not.toBeInTheDocument();
  });

  it("survives a hosted node switch reset of the presentation stores", async () => {
    mounted = await render(
      <SidebarProvider>
        <PhoneHome />
      </SidebarProvider>,
    );
    await expect.element(page.getByText("Alpha thread")).toBeVisible();

    // The node-switch teardown resets exactly the live stores Home consumes.
    clearHostedNodeScopedState(ENV_ID);

    await expect.element(page.getByText("No projects yet")).toBeVisible();
    expect(useUiStateStore.getState().pinnedThreadKeys).toEqual({});
  });
});
