// Production CSS is part of the behavior under test: row heights and the
// phone tier variants drive the touch-target assertions.
import "../../../index.css";

import {
  EnvironmentId,
  ProviderInstanceId,
  type EnvironmentApi,
  type ProjectId,
  type ThreadId,
} from "@ryco/contracts";
import { scopedThreadKey, scopeThreadRef } from "@ryco/client-runtime";
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
const THREAD_A_KEY = scopedThreadKey(scopeThreadRef(ENV_ID, THREAD_A));
const NOW_ISO = "2026-07-20T00:00:00.000Z";

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
