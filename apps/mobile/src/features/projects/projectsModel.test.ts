import { describe, expect, it } from "vite-plus/test";

import type {
  Project,
  SidebarThreadSummary,
  SidebarWorktreeSummary,
} from "@ryco/client-runtime/state/threads";
import type { EnvironmentId } from "@ryco/contracts";

import { buildProjectNodeGroups } from "./projectsModel";

const NODE_A = "node-a" as EnvironmentId;

const PROJECT: Project = {
  environmentId: NODE_A,
  id: "project-a" as never,
  name: "Ryco",
  cwd: "/code/ryco",
  defaultModelSelection: null,
  scripts: [],
};

const WORKTREE = {
  environmentId: NODE_A,
  id: "tree-a",
  projectId: "project-a",
  archivedAt: null,
} as SidebarWorktreeSummary;

const THREAD = {
  environmentId: NODE_A,
  id: "thread-a",
  projectId: "project-a",
  archivedAt: null,
  updatedAt: "2026-07-26T10:00:00.000Z",
} as SidebarThreadSummary;

describe("Projects model", () => {
  it("groups project counts under their node", () => {
    const groups = buildProjectNodeGroups({
      projects: [PROJECT],
      worktrees: [WORKTREE],
      threads: [THREAD],
      environments: [{ environmentId: NODE_A, label: "Mac Studio", connectionState: "connected" }],
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.nodeLabel).toBe("Mac Studio");
    expect(groups[0]?.rows[0]).toMatchObject({
      title: "Ryco",
      path: "/code/ryco",
      worktreeCount: 1,
      activeThreadCount: 1,
    });
  });

  it("ignores archived worktrees and threads", () => {
    const groups = buildProjectNodeGroups({
      projects: [PROJECT],
      worktrees: [{ ...WORKTREE, archivedAt: "2026-07-26T10:00:00.000Z" }],
      threads: [{ ...THREAD, archivedAt: "2026-07-26T10:00:00.000Z" }],
      environments: [{ environmentId: NODE_A, label: "Mac Studio", connectionState: "connected" }],
    });

    expect(groups[0]?.rows[0]).toMatchObject({
      worktreeCount: 0,
      activeThreadCount: 0,
    });
  });

  it("filters by project name or remote path", () => {
    const groups = buildProjectNodeGroups({
      projects: [PROJECT],
      worktrees: [],
      threads: [],
      environments: [{ environmentId: NODE_A, label: "Mac Studio", connectionState: "connected" }],
      query: "code/ryco",
    });

    expect(groups[0]?.rows.map((row) => row.projectId)).toEqual(["project-a"]);
  });
});
