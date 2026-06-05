import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@ryco/contracts";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_INTERACTION_MODE } from "../../types";
import type {
  SidebarTreeProject,
  SidebarTreeThread,
  SidebarTreeWorktree,
  SidebarWorktree,
} from "./hooks/useSidebarTree";
import type { SidebarStatusBucket } from "../Sidebar.logic";
import { SidebarWorktreeList } from "./SidebarWorktreeList";

const environmentId = EnvironmentId.make("environment-local");
const projectId = ProjectId.make("project-1");

describe("SidebarWorktreeList", () => {
  it("renders worktree sections collapsed by default and expands them on demand", async () => {
    await render(
      <SidebarWorktreeList
        attachThreadListAutoAnimateRef={() => undefined}
        projectExpanded
        resolveThreadGitStatusTarget={() => null}
        renderThread={(thread) => <div>{thread.title}</div>}
        treeProject={makeTreeProject()}
        visibleThreadKeys={null}
        onArchiveWorktree={vi.fn()}
        onCopyWorktreePath={vi.fn()}
        onDeleteWorktree={vi.fn()}
        onNewSession={vi.fn()}
        onOpenInEditor={vi.fn()}
        onOpenWorktree={vi.fn()}
        onRenameWorktree={vi.fn()}
        onRestoreWorktree={vi.fn()}
      />,
    );

    expect(document.body.textContent).toContain("main");
    expect(document.body.textContent).not.toContain("Release checklist");

    await page.getByRole("button", { name: "Expand main", exact: true }).click();

    await expect.element(page.getByText("Release checklist")).toBeInTheDocument();
  });

  it("expands a worktree when clicking its title without opening it", async () => {
    const onOpenWorktree = vi.fn();
    await render(
      <SidebarWorktreeList
        attachThreadListAutoAnimateRef={() => undefined}
        projectExpanded
        resolveThreadGitStatusTarget={() => null}
        renderThread={(thread) => <div>{thread.title}</div>}
        treeProject={makeTreeProject()}
        visibleThreadKeys={null}
        onArchiveWorktree={vi.fn()}
        onCopyWorktreePath={vi.fn()}
        onDeleteWorktree={vi.fn()}
        onNewSession={vi.fn()}
        onOpenInEditor={vi.fn()}
        onOpenWorktree={onOpenWorktree}
        onRenameWorktree={vi.fn()}
        onRestoreWorktree={vi.fn()}
      />,
    );

    expect(document.body.textContent).not.toContain("Release checklist");

    await page.getByText("main").click();

    await expect.element(page.getByText("Release checklist")).toBeInTheDocument();
    expect(onOpenWorktree).not.toHaveBeenCalled();
  });

  it("renders state-aware chips for every linked PR/issue lifecycle state", async () => {
    const treeProject = makeVariantsTreeProject();
    await render(
      <SidebarWorktreeList
        attachThreadListAutoAnimateRef={() => undefined}
        projectExpanded
        resolveThreadGitStatusTarget={() => null}
        renderThread={(thread) => <div>{thread.title}</div>}
        treeProject={treeProject}
        visibleThreadKeys={null}
        onArchiveWorktree={vi.fn()}
        onCopyWorktreePath={vi.fn()}
        onDeleteWorktree={vi.fn()}
        onNewSession={vi.fn()}
        onOpenInEditor={vi.fn()}
        onOpenWorktree={vi.fn()}
        onRenameWorktree={vi.fn()}
        onRestoreWorktree={vi.fn()}
      />,
    );

    await expect.element(page.getByLabelText("Issue #101 — Open")).toBeInTheDocument();
    await expect.element(page.getByLabelText("Issue #102 — Closed")).toBeInTheDocument();
    await expect.element(page.getByLabelText("Pull request #201 — Draft")).toBeInTheDocument();
    await expect.element(page.getByLabelText("Pull request #202 — Open")).toBeInTheDocument();
    await expect.element(page.getByLabelText("Pull request #203 — Merged")).toBeInTheDocument();
    await expect.element(page.getByLabelText("Pull request #204 — Closed")).toBeInTheDocument();
    await expect.element(page.getByLabelText("Pull request #205")).toBeInTheDocument();
  });

  it("colors active worktree names instead of reserving a chat-activity dot slot", async () => {
    const treeProject = makeStatusDotTreeProject();
    await render(
      <SidebarWorktreeList
        attachThreadListAutoAnimateRef={() => undefined}
        projectExpanded
        resolveThreadGitStatusTarget={() => null}
        renderThread={(thread) => <div>{thread.title}</div>}
        treeProject={treeProject}
        visibleThreadKeys={null}
        onArchiveWorktree={vi.fn()}
        onCopyWorktreePath={vi.fn()}
        onDeleteWorktree={vi.fn()}
        onNewSession={vi.fn()}
        onOpenInEditor={vi.fn()}
        onOpenWorktree={vi.fn()}
        onRenameWorktree={vi.fn()}
        onRestoreWorktree={vi.fn()}
      />,
    );

    const idleToggle = page.getByRole("button", { name: "Expand idle-feat", exact: true });
    const idleRow = idleToggle.element().closest(".group\\/worktree");
    expect(idleRow?.querySelector("span.rounded-full")).toBeNull();

    const inProgressTitle = page.getByText("working-feat").element();
    expect(inProgressTitle.classList.contains("sidebar-status-text")).toBe(true);
    expect(inProgressTitle.classList.contains("sidebar-status-text--in-progress")).toBe(true);
    expect(inProgressTitle.classList.contains("sidebar-status-text--shimmer")).toBe(true);
    expect(inProgressTitle.style.getPropertyValue("--sidebar-status-text-spread")).toBe("24px");
    expect(inProgressTitle.getAttribute("aria-label")).toBe("In progress: working-feat");
  });
});

function makeTreeProject(): SidebarTreeProject {
  const thread = makeThread();
  return {
    archivedSessions: [],
    archivedWorktrees: [],
    flatSessions: [],
    isGitRepo: true,
    project: {
      id: projectId,
      environmentId,
      name: "Project",
      cwd: "/repo/project",
      repositoryIdentity: null,
      defaultModelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5.4",
      },
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
      scripts: [],
    },
    worktrees: [
      {
        aggregateStatus: "idle",
        archivedSessions: [],
        buckets: {
          done: [],
          idle: [thread],
          in_progress: [],
          review: [],
        },
        diffStats: null,
        sessions: [thread],
        shouldSuggestArchive: false,
        worktree: {
          worktreeId: "worktree-main",
          projectId,
          branch: "main",
          worktreePath: null,
          origin: "main",
          archivedAt: null,
          manualPosition: 0,
          updatedAt: "2026-05-01T00:00:00.000Z",
        },
      },
    ],
  };
}

interface VariantSpec {
  worktreeId: string;
  branch: string;
  origin: "pr" | "issue";
  prNumber?: number;
  issueNumber?: number;
  prState?: "open" | "closed" | "merged" | null;
  prIsDraft?: boolean | null;
  issueState?: "open" | "closed" | null;
}

function makeVariantsTreeProject(): SidebarTreeProject {
  const specs: VariantSpec[] = [
    {
      worktreeId: "wt-issue-open",
      branch: "issue/open",
      origin: "issue",
      issueNumber: 101,
      issueState: "open",
    },
    {
      worktreeId: "wt-issue-closed",
      branch: "issue/closed",
      origin: "issue",
      issueNumber: 102,
      issueState: "closed",
    },
    {
      worktreeId: "wt-pr-draft",
      branch: "pr/draft",
      origin: "pr",
      prNumber: 201,
      prState: "open",
      prIsDraft: true,
    },
    {
      worktreeId: "wt-pr-open",
      branch: "pr/open",
      origin: "pr",
      prNumber: 202,
      prState: "open",
      prIsDraft: false,
    },
    {
      worktreeId: "wt-pr-merged",
      branch: "pr/merged",
      origin: "pr",
      prNumber: 203,
      prState: "merged",
    },
    {
      worktreeId: "wt-pr-closed",
      branch: "pr/closed",
      origin: "pr",
      prNumber: 204,
      prState: "closed",
    },
    {
      worktreeId: "wt-pr-unknown",
      branch: "pr/unknown",
      origin: "pr",
      prNumber: 205,
      prState: null,
    },
  ];
  return {
    archivedSessions: [],
    archivedWorktrees: [],
    flatSessions: [],
    isGitRepo: true,
    project: makeProject(),
    worktrees: specs.map((spec, index) =>
      makeWorktreeNode({
        aggregateStatus: "idle",
        manualPosition: index + 1,
        worktree: {
          worktreeId: spec.worktreeId,
          projectId,
          branch: spec.branch,
          worktreePath: `/tmp/${spec.branch}`,
          origin: spec.origin,
          prNumber: spec.prNumber ?? null,
          issueNumber: spec.issueNumber ?? null,
          prState: spec.prState ?? null,
          prIsDraft: spec.prIsDraft ?? null,
          issueState: spec.issueState ?? null,
          archivedAt: null,
          manualPosition: index + 1,
          updatedAt: "2026-05-17T00:00:00.000Z",
        },
      }),
    ),
  };
}

function makeStatusDotTreeProject(): SidebarTreeProject {
  return {
    archivedSessions: [],
    archivedWorktrees: [],
    flatSessions: [],
    isGitRepo: true,
    project: makeProject(),
    worktrees: [
      makeWorktreeNode({
        aggregateStatus: "idle",
        manualPosition: 1,
        worktree: makeWorktreeSummary({
          worktreeId: "wt-idle",
          branch: "idle-feat",
        }),
      }),
      makeWorktreeNode({
        aggregateStatus: "in_progress",
        manualPosition: 2,
        worktree: makeWorktreeSummary({
          worktreeId: "wt-working",
          branch: "working-feat",
        }),
      }),
    ],
  };
}

function makeWorktreeNode(input: {
  aggregateStatus: SidebarStatusBucket;
  manualPosition: number;
  worktree: SidebarWorktree;
}): SidebarTreeWorktree {
  return {
    aggregateStatus: input.aggregateStatus,
    archivedSessions: [],
    buckets: { done: [], idle: [], in_progress: [], review: [] },
    diffStats: null,
    sessions: [],
    shouldSuggestArchive: false,
    worktree: input.worktree,
  };
}

function makeWorktreeSummary(input: { worktreeId: string; branch: string }): SidebarWorktree {
  return {
    worktreeId: input.worktreeId,
    projectId,
    branch: input.branch,
    worktreePath: `/tmp/${input.branch}`,
    origin: "branch",
    prNumber: null,
    issueNumber: null,
    prState: null,
    prIsDraft: null,
    issueState: null,
    archivedAt: null,
    manualPosition: 0,
    updatedAt: "2026-05-17T00:00:00.000Z",
  };
}

function makeProject() {
  return {
    id: projectId,
    environmentId,
    name: "Project",
    cwd: "/repo/project",
    repositoryIdentity: null,
    defaultModelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.4",
    },
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
    scripts: [],
  };
}

function makeThread(): SidebarTreeThread {
  return {
    id: ThreadId.make("thread-1"),
    environmentId,
    projectId,
    title: "Release checklist",
    interactionMode: DEFAULT_INTERACTION_MODE,
    session: null,
    createdAt: "2026-05-01T00:00:00.000Z",
    archivedAt: null,
    updatedAt: "2026-05-01T00:00:00.000Z",
    latestTurn: null,
    branch: "main",
    worktreePath: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    manualStatusBucket: null,
    statusPill: null,
    worktreeId: "worktree-main",
  };
}
