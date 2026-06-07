import { describe, expect, it } from "vitest";
import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@ryco/contracts";
import { DEFAULT_INTERACTION_MODE, type Project } from "../../../types";
import { composeSidebarTree, type SidebarTreeThread, type SidebarWorktree } from "./useSidebarTree";

const environmentId = EnvironmentId.make("environment-local");

describe("composeSidebarTree", () => {
  it("groups sessions by worktree while retaining derived bucket metadata", () => {
    const tree = composeSidebarTree({
      diffStatsByWorktreeIdRecord: {
        "worktree-main": null,
      },
      isGitRepoByProjectId: new Map([[ProjectId.make("project-1"), true]]),
      nowMs: Date.parse("2026-05-08T00:00:00.000Z"),
      projects: [makeProject()],
      threads: [
        makeThread({
          id: ThreadId.make("thread-done"),
          statusPill: { label: "Completed", colorClass: "", dotClass: "", pulse: false },
          worktreeId: "worktree-main",
        }),
      ],
      worktrees: [
        makeWorktree({
          worktreeId: "worktree-main",
        }),
      ],
    });

    const worktree = tree.projects[0]?.worktrees[0];
    expect(worktree?.buckets.done.map((thread) => thread.id)).toEqual([
      ThreadId.make("thread-done"),
    ]);
    expect(worktree?.sessions.map((thread) => thread.id)).toEqual([ThreadId.make("thread-done")]);
    expect(worktree?.aggregateStatus).toBe("done");
  });

  it("uses manual bucket overrides before runtime-derived buckets", () => {
    const tree = composeSidebarTree({
      isGitRepoByProjectId: new Map([[ProjectId.make("project-1"), true]]),
      nowMs: Date.parse("2026-05-08T00:00:00.000Z"),
      projects: [makeProject()],
      threads: [
        makeThread({
          manualStatusBucket: "review",
          statusPill: { label: "Working", colorClass: "", dotClass: "", pulse: false },
          worktreeId: "worktree-main",
        }),
      ],
      worktrees: [makeWorktree()],
    });

    expect(tree.projects[0]?.worktrees[0]?.buckets.review).toHaveLength(1);
    expect(tree.projects[0]?.worktrees[0]?.buckets.in_progress).toHaveLength(0);
  });

  it("flattens sessions for non-git projects", () => {
    const tree = composeSidebarTree({
      isGitRepoByProjectId: new Map([[ProjectId.make("project-1"), false]]),
      nowMs: Date.parse("2026-05-08T00:00:00.000Z"),
      projects: [makeProject()],
      threads: [
        makeThread({
          id: ThreadId.make("thread-flat"),
          worktreeId: null,
        }),
        makeThread({
          archivedAt: "2026-05-02T00:00:00.000Z",
          id: ThreadId.make("thread-archived"),
          worktreeId: null,
        }),
      ],
      worktrees: [],
    });

    expect(tree.projects[0]?.flatSessions.map((thread) => thread.id)).toEqual([
      ThreadId.make("thread-flat"),
    ]);
    expect(tree.projects[0]?.archivedSessions.map((thread) => thread.id)).toEqual([
      ThreadId.make("thread-archived"),
    ]);
    expect(tree.projects[0]?.worktrees).toHaveLength(0);
  });

  it("pins main before manually ordered worktrees", () => {
    const tree = composeSidebarTree({
      isGitRepoByProjectId: new Map([[ProjectId.make("project-1"), true]]),
      nowMs: Date.parse("2026-05-08T00:00:00.000Z"),
      projects: [makeProject()],
      threads: [],
      worktrees: [
        makeWorktree({
          branch: "feature/a",
          manualPosition: 0,
          origin: "branch",
          worktreeId: "worktree-feature",
        }),
        makeWorktree({
          branch: "main",
          manualPosition: 10,
          origin: "main",
          worktreeId: "worktree-main",
        }),
      ],
    });

    expect(tree.projects[0]?.worktrees.map((entry) => entry.worktree.worktreeId)).toEqual([
      "worktree-main",
      "worktree-feature",
    ]);
  });

  it("synthesizes a main worktree for legacy git sidebar data without worktree rows", () => {
    const tree = composeSidebarTree({
      isGitRepoByProjectId: new Map([[ProjectId.make("project-1"), true]]),
      nowMs: Date.parse("2026-05-08T00:00:00.000Z"),
      projects: [makeProject()],
      threads: [
        makeThread({
          branch: "trunk",
          statusPill: { label: "Completed", colorClass: "", dotClass: "", pulse: false },
          worktreePath: null,
        }),
      ],
      worktrees: [],
    });

    const worktree = tree.projects[0]?.worktrees[0];
    expect(worktree?.worktree.origin).toBe("main");
    expect(worktree?.worktree.branch).toBe("trunk");
    expect(worktree?.buckets.done).toHaveLength(1);
  });

  it("synthesizes a separate legacy branch group for null-path branch sessions", () => {
    const tree = composeSidebarTree({
      isGitRepoByProjectId: new Map([[ProjectId.make("project-1"), true]]),
      nowMs: Date.parse("2026-05-08T00:00:00.000Z"),
      projects: [makeProject()],
      threads: [
        makeThread({
          id: ThreadId.make("thread-main"),
          branch: "main",
          worktreePath: null,
        }),
        makeThread({
          id: ThreadId.make("thread-feature"),
          branch: "feature/legacy",
          worktreePath: null,
        }),
      ],
      worktrees: [],
    });

    expect(tree.projects[0]?.worktrees.map((entry) => entry.worktree.origin)).toEqual([
      "main",
      "branch",
    ]);
    expect(tree.projects[0]?.worktrees[0]?.sessions.map((thread) => thread.id)).toEqual([
      ThreadId.make("thread-main"),
    ]);
    expect(tree.projects[0]?.worktrees[1]?.worktree.branch).toBe("feature/legacy");
    expect(tree.projects[0]?.worktrees[1]?.sessions.map((thread) => thread.id)).toEqual([
      ThreadId.make("thread-feature"),
    ]);
  });

  it("synthesizes a path worktree for threads materialized without a worktree row", () => {
    const tree = composeSidebarTree({
      isGitRepoByProjectId: new Map([[ProjectId.make("project-1"), true]]),
      nowMs: Date.parse("2026-05-08T00:00:00.000Z"),
      projects: [makeProject()],
      threads: [
        makeThread({
          id: ThreadId.make("thread-worktree"),
          branch: "feature/materialized",
          worktreePath: "/repo/.ryco/worktrees/feature-materialized",
        }),
      ],
      worktrees: [],
    });

    const worktree = tree.projects[0]?.worktrees[0];
    expect(worktree?.worktree.origin).toBe("branch");
    expect(worktree?.worktree.worktreePath).toBe("/repo/.ryco/worktrees/feature-materialized");
    expect(worktree?.sessions.map((thread) => thread.id)).toEqual([
      ThreadId.make("thread-worktree"),
    ]);
  });

  it("merges duplicate base worktree rows for the same project", () => {
    const tree = composeSidebarTree({
      isGitRepoByProjectId: new Map([[ProjectId.make("project-1"), true]]),
      nowMs: Date.parse("2026-05-08T00:00:00.000Z"),
      projects: [makeProject()],
      threads: [
        makeThread({
          id: ThreadId.make("thread-a"),
          branch: "master",
          worktreeId: "worktree-main-explicit",
          worktreePath: null,
        }),
        makeThread({
          id: ThreadId.make("thread-b"),
          branch: "master",
          worktreeId: null,
          worktreePath: null,
        }),
      ],
      worktrees: [
        makeWorktree({
          branch: "master",
          origin: "main",
          worktreeId: "worktree-main-explicit",
          worktreePath: null,
        }),
        makeWorktree({
          branch: "master",
          origin: "main",
          worktreeId: "worktree-main-duplicate",
          worktreePath: null,
        }),
      ],
    });

    expect(tree.projects[0]?.worktrees.map((entry) => entry.worktree.branch)).toEqual(["master"]);
    expect(tree.projects[0]?.worktrees[0]?.sessions.map((thread) => thread.id)).toEqual([
      ThreadId.make("thread-a"),
      ThreadId.make("thread-b"),
    ]);
  });

  it("keeps the newest title when equivalent worktrees are merged", () => {
    const tree = composeSidebarTree({
      isGitRepoByProjectId: new Map([[ProjectId.make("project-1"), true]]),
      nowMs: Date.parse("2026-05-08T00:00:00.000Z"),
      projects: [makeProject()],
      threads: [],
      worktrees: [
        makeWorktree({
          title: "Old title",
          updatedAt: "2026-05-01T00:00:00.000Z",
          worktreeId: "worktree-main-stale",
        }),
        makeWorktree({
          title: "New title",
          updatedAt: "2026-05-02T00:00:00.000Z",
          worktreeId: "worktree-main-renamed",
        }),
      ],
    });

    expect(tree.projects[0]?.worktrees[0]?.worktree.title).toBe("New title");
  });

  it("keeps the real projected worktree id when merging with a synthesized row", () => {
    const tree = composeSidebarTree({
      isGitRepoByProjectId: new Map([[ProjectId.make("project-1"), true]]),
      nowMs: Date.parse("2026-05-08T00:00:00.000Z"),
      projects: [makeProject()],
      threads: [],
      worktrees: [
        makeWorktree({
          origin: "main",
          worktreeId: "main:project-1:main",
          worktreePath: null,
        }),
        makeWorktree({
          origin: "main",
          title: "Renamable main",
          worktreeId: "worktree-project-1-main",
          worktreePath: null,
        }),
      ],
    });

    expect(tree.projects[0]?.worktrees[0]?.worktree.worktreeId).toBe("worktree-project-1-main");
    expect(tree.projects[0]?.worktrees[0]?.worktree.title).toBe("Renamable main");
  });

  it("suggests archive only for stale all-done worktrees", () => {
    const nowMs = Date.parse("2026-05-08T00:00:00.000Z");
    const tree = composeSidebarTree({
      isGitRepoByProjectId: new Map([[ProjectId.make("project-1"), true]]),
      nowMs,
      projects: [makeProject()],
      threads: [
        makeThread({
          statusPill: { label: "Completed", colorClass: "", dotClass: "", pulse: false },
          updatedAt: "2026-04-30T23:59:59.000Z",
          worktreeId: "worktree-main",
        }),
      ],
      worktrees: [makeWorktree()],
    });

    expect(tree.projects[0]?.worktrees[0]?.shouldSuggestArchive).toBe(true);
  });
});

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: ProjectId.make("project-1"),
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
    ...overrides,
  };
}

function makeThread(overrides: Partial<SidebarTreeThread> = {}): SidebarTreeThread {
  return {
    id: ThreadId.make("thread-1"),
    environmentId,
    projectId: ProjectId.make("project-1"),
    title: "Thread",
    interactionMode: DEFAULT_INTERACTION_MODE,
    session: null,
    createdAt: "2026-05-01T00:00:00.000Z",
    archivedAt: null,
    updatedAt: "2026-05-01T00:00:00.000Z",
    latestTurn: null,
    branch: null,
    worktreePath: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    manualStatusBucket: null,
    statusPill: null,
    worktreeId: null,
    ...overrides,
  };
}

function makeWorktree(overrides: Partial<SidebarWorktree> = {}): SidebarWorktree {
  return {
    worktreeId: "worktree-main",
    projectId: ProjectId.make("project-1"),
    branch: "main",
    worktreePath: null,
    origin: "main",
    archivedAt: null,
    manualPosition: 0,
    updatedAt: "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}
