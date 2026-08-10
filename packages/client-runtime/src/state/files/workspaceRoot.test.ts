import { EnvironmentId, ProjectId, WorktreeId } from "@ryco/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { SidebarWorktreeSummary, Thread } from "../threads/types.ts";
import { findThreadWorktree, resolveThreadWorkspaceRoot } from "./workspaceRoot.ts";

const environmentId = EnvironmentId.make("environment-local");
const projectId = ProjectId.make("project-1");

type ThreadMatch = Pick<
  Thread,
  "environmentId" | "projectId" | "worktreeId" | "worktreePath" | "branch"
>;

function thread(overrides: Partial<ThreadMatch> = {}): ThreadMatch {
  return {
    environmentId,
    projectId,
    worktreeId: null,
    worktreePath: null,
    branch: null,
    ...overrides,
  };
}

function worktree(
  id: string,
  overrides: Partial<SidebarWorktreeSummary> = {},
): SidebarWorktreeSummary {
  return {
    id: WorktreeId.make(id),
    environmentId,
    projectId,
    branch: `feat/${id}`,
    worktreePath: `/repo/.worktrees/${id}`,
    ...overrides,
  } as SidebarWorktreeSummary;
}

describe("findThreadWorktree", () => {
  const worktrees = [worktree("alpha"), worktree("beta")];

  it("matches by id, then path, then branch", () => {
    expect(findThreadWorktree(thread({ worktreeId: "beta" }), worktrees)?.id).toBe("beta");
    expect(
      findThreadWorktree(thread({ worktreePath: "/repo/.worktrees/alpha" }), worktrees)?.id,
    ).toBe("alpha");
    expect(findThreadWorktree(thread({ branch: "feat/beta" }), worktrees)?.id).toBe("beta");
  });

  it("falls through to the next signal when the stronger one misses", () => {
    expect(
      findThreadWorktree(thread({ worktreeId: "gone", branch: "feat/alpha" }), worktrees)?.id,
    ).toBe("alpha");
    expect(findThreadWorktree(thread({ branch: "feat/missing" }), worktrees)).toBeNull();
    expect(findThreadWorktree(thread(), worktrees)).toBeNull();
  });

  it("never crosses node or project boundaries", () => {
    const foreign = [
      worktree("alpha", { environmentId: EnvironmentId.make("environment-remote") }),
      worktree("beta", { projectId: ProjectId.make("project-2") }),
    ];

    expect(findThreadWorktree(thread({ worktreeId: "alpha" }), foreign)).toBeNull();
    expect(findThreadWorktree(thread({ branch: "feat/beta" }), foreign)).toBeNull();
  });
});

describe("resolveThreadWorkspaceRoot", () => {
  it("prefers the worktree, then the thread, then the project checkout", () => {
    expect(
      resolveThreadWorkspaceRoot({
        thread: { worktreePath: "/repo/.worktrees/thread" },
        worktree: { worktreePath: "/repo/.worktrees/summary" },
        project: { cwd: "/repo" },
      }),
    ).toBe("/repo/.worktrees/summary");

    expect(
      resolveThreadWorkspaceRoot({
        thread: { worktreePath: "/repo/.worktrees/thread" },
        worktree: null,
        project: { cwd: "/repo" },
      }),
    ).toBe("/repo/.worktrees/thread");

    expect(
      resolveThreadWorkspaceRoot({
        thread: { worktreePath: null },
        worktree: null,
        project: { cwd: "/repo" },
      }),
    ).toBe("/repo");
  });

  it("skips a worktree the node manages without exposing a path", () => {
    expect(
      resolveThreadWorkspaceRoot({
        thread: { worktreePath: "/repo/.worktrees/thread" },
        worktree: { worktreePath: null },
        project: { cwd: "/repo" },
      }),
    ).toBe("/repo/.worktrees/thread");
  });

  it("has no root without a worktree, thread path or project", () => {
    expect(resolveThreadWorkspaceRoot({ thread: null, worktree: null, project: null })).toBeNull();
    expect(
      resolveThreadWorkspaceRoot({
        thread: { worktreePath: null },
        worktree: { worktreePath: null },
        project: null,
      }),
    ).toBeNull();
  });
});
