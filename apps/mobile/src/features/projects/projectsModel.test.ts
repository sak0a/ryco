import { describe, expect, it } from "vite-plus/test";

import type {
  Project,
  SidebarThreadSummary,
  SidebarWorktreeSummary,
} from "@ryco/client-runtime/state/threads";
import type { EnvironmentId, ProjectId } from "@ryco/contracts";

import {
  buildProjectDetail,
  buildProjectRows,
  projectMachineStatusLabel,
  projectRowAccessibilityLabel,
  type ProjectEnvironment,
} from "./projectsModel";

const NODE_A = "node-a" as EnvironmentId;
const NODE_B = "node-b" as EnvironmentId;
const CANONICAL_KEY = "github.com/ryco/ryco";

function project(input: {
  readonly environmentId: EnvironmentId;
  readonly id: string;
  readonly name: string;
  readonly cwd: string;
  readonly canonicalKey?: string;
  readonly updatedAt?: string;
}): Project {
  return {
    environmentId: input.environmentId,
    id: input.id as ProjectId,
    name: input.name,
    cwd: input.cwd,
    defaultModelSelection: null,
    scripts: [],
    ...(input.canonicalKey
      ? {
          repositoryIdentity: {
            canonicalKey: input.canonicalKey,
            locator: {
              source: "git-remote" as const,
              remoteName: "origin",
              remoteUrl: `git@github.com:${input.canonicalKey}.git`,
            },
            displayName: "Ryco",
            remotes: [],
          },
        }
      : {}),
    ...(input.updatedAt ? { updatedAt: input.updatedAt } : {}),
  };
}

function worktree(environmentId: EnvironmentId, id: string, projectId: string) {
  return { environmentId, id, projectId, archivedAt: null } as SidebarWorktreeSummary;
}

function thread(
  environmentId: EnvironmentId,
  id: string,
  projectId: string,
  updatedAt = "2026-07-26T10:00:00.000Z",
) {
  return { environmentId, id, projectId, archivedAt: null, updatedAt } as SidebarThreadSummary;
}

const MAC: ProjectEnvironment = {
  environmentId: NODE_A,
  label: "Mac Studio",
  connectionState: "connected",
};
const LINUX: ProjectEnvironment = {
  environmentId: NODE_B,
  label: "Linux box",
  connectionState: "connected",
};

const PROJECT = project({
  environmentId: NODE_A,
  id: "project-a",
  name: "Ryco",
  cwd: "/code/ryco",
});
const WORKTREE = worktree(NODE_A, "tree-a", "project-a");
const THREAD = thread(NODE_A, "thread-a", "project-a");

const EMPTY = { worktrees: [], threads: [] } as const;

describe("Projects rows", () => {
  it("counts worktrees and active tasks on a single-machine row", () => {
    const rows = buildProjectRows({
      projects: [PROJECT],
      worktrees: [WORKTREE],
      threads: [THREAD],
      environments: [MAC],
      groupingMode: "repository",
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      title: "Ryco",
      path: "/code/ryco",
      worktreeCount: 1,
      activeThreadCount: 1,
      open: { environmentId: NODE_A, projectId: "project-a" },
    });
    expect(rows[0]?.machines.map((machine) => machine.label)).toEqual(["Mac Studio"]);
  });

  it("ignores archived worktrees and threads", () => {
    const rows = buildProjectRows({
      projects: [PROJECT],
      worktrees: [
        { ...WORKTREE, archivedAt: "2026-07-26T10:00:00.000Z" } as SidebarWorktreeSummary,
      ],
      threads: [{ ...THREAD, archivedAt: "2026-07-26T10:00:00.000Z" } as SidebarThreadSummary],
      environments: [MAC],
      groupingMode: "repository",
    });

    expect(rows[0]).toMatchObject({ worktreeCount: 0, activeThreadCount: 0 });
  });

  it("merges one repository checked out on two machines into a single row", () => {
    const rows = buildProjectRows({
      projects: [
        project({
          environmentId: NODE_A,
          id: "project-a",
          name: "ryco",
          cwd: "/code/ryco",
          canonicalKey: CANONICAL_KEY,
          updatedAt: "2026-07-20T10:00:00.000Z",
        }),
        project({
          environmentId: NODE_B,
          id: "project-b",
          name: "ryco-server",
          cwd: "/srv/ryco",
          // Later than machine A's most recent task, so B is the representative.
          canonicalKey: CANONICAL_KEY,
          updatedAt: "2026-07-28T10:00:00.000Z",
        }),
      ],
      worktrees: [
        worktree(NODE_A, "tree-a", "project-a"),
        worktree(NODE_B, "tree-b1", "project-b"),
        worktree(NODE_B, "tree-b2", "project-b"),
      ],
      threads: [thread(NODE_A, "thread-a", "project-a")],
      environments: [MAC, LINUX],
      groupingMode: "repository",
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      key: CANONICAL_KEY,
      // The shared repository display name, not either checkout's local name.
      title: "Ryco",
      // Representative (most recently updated) member owns path and open target.
      path: "/srv/ryco",
      worktreeCount: 3,
      activeThreadCount: 1,
      open: { environmentId: NODE_B, projectId: "project-b" },
    });
    expect(rows[0]?.machines.map((machine) => machine.label)).toEqual(["Linux box", "Mac Studio"]);
    expect(rows[0]?.machines.map((machine) => machine.projectId)).toEqual([
      "project-b",
      "project-a",
    ]);
  });

  it("refuses to merge an ambiguous key: two checkouts on one machine, one on another", () => {
    const rows = buildProjectRows({
      projects: [
        project({
          environmentId: NODE_A,
          id: "project-a1",
          name: "ryco",
          cwd: "/code/ryco",
          canonicalKey: CANONICAL_KEY,
          updatedAt: "2026-07-20T10:00:00.000Z",
        }),
        project({
          environmentId: NODE_A,
          id: "project-a2",
          name: "ryco (review)",
          cwd: "/code/ryco-review",
          canonicalKey: CANONICAL_KEY,
          updatedAt: "2026-07-21T10:00:00.000Z",
        }),
        project({
          environmentId: NODE_B,
          id: "project-b",
          name: "ryco-server",
          cwd: "/srv/ryco",
          canonicalKey: CANONICAL_KEY,
          updatedAt: "2026-07-22T10:00:00.000Z",
        }),
      ],
      ...EMPTY,
      environments: [MAC, LINUX],
      groupingMode: "repository",
    });

    // No partial merging and no within-machine collapsing: every member stands
    // alone, keyed by its physical (environment + path) key.
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.key)).toEqual([
      `${NODE_B}:/srv/ryco`,
      `${NODE_A}:/code/ryco-review`,
      `${NODE_A}:/code/ryco`,
    ]);
    for (const row of rows) expect(row.machines).toHaveLength(1);
  });

  it("never merges in separate mode", () => {
    const projects = [
      project({
        environmentId: NODE_A,
        id: "project-a",
        name: "ryco",
        cwd: "/code/ryco",
        canonicalKey: CANONICAL_KEY,
        updatedAt: "2026-07-20T10:00:00.000Z",
      }),
      project({
        environmentId: NODE_B,
        id: "project-b",
        name: "ryco-server",
        cwd: "/srv/ryco",
        canonicalKey: CANONICAL_KEY,
        updatedAt: "2026-07-25T10:00:00.000Z",
      }),
    ];

    const rows = buildProjectRows({
      projects,
      ...EMPTY,
      environments: [MAC, LINUX],
      groupingMode: "separate",
    });

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.key)).toEqual([`${NODE_B}:/srv/ryco`, `${NODE_A}:/code/ryco`]);
    expect(rows.map((row) => row.title)).toEqual(["ryco-server", "ryco"]);
  });

  it("never merges projects without a repository identity", () => {
    const rows = buildProjectRows({
      projects: [
        project({
          environmentId: NODE_A,
          id: "project-a",
          name: "ryco",
          cwd: "/code/ryco",
          updatedAt: "2026-07-20T10:00:00.000Z",
        }),
        project({
          environmentId: NODE_B,
          id: "project-b",
          name: "ryco",
          cwd: "/code/ryco",
          updatedAt: "2026-07-25T10:00:00.000Z",
        }),
      ],
      ...EMPTY,
      environments: [MAC, LINUX],
      groupingMode: "repository",
    });

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.key)).toEqual([`${NODE_B}:/code/ryco`, `${NODE_A}:/code/ryco`]);
  });

  it("degrades a merged row to a plain row when scoped to one machine", () => {
    const projects = [
      project({
        environmentId: NODE_A,
        id: "project-a",
        name: "ryco",
        cwd: "/code/ryco",
        canonicalKey: CANONICAL_KEY,
        updatedAt: "2026-07-20T10:00:00.000Z",
      }),
      project({
        environmentId: NODE_B,
        id: "project-b",
        name: "ryco-server",
        cwd: "/srv/ryco",
        canonicalKey: CANONICAL_KEY,
        updatedAt: "2026-07-25T10:00:00.000Z",
      }),
    ];
    const worktrees = [
      worktree(NODE_A, "tree-a", "project-a"),
      worktree(NODE_B, "tree-b", "project-b"),
    ];

    const rows = buildProjectRows({
      projects,
      worktrees,
      threads: [],
      environments: [MAC, LINUX],
      nodeScope: NODE_A,
      groupingMode: "repository",
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      key: `${NODE_A}:/code/ryco`,
      title: "ryco",
      path: "/code/ryco",
      // Only the surviving member's counts — never the excluded machine's.
      worktreeCount: 1,
      open: { environmentId: NODE_A, projectId: "project-a" },
    });
    expect(rows[0]?.machines.map((machine) => machine.label)).toEqual(["Mac Studio"]);
  });

  it("carries stale, role, and trust provenance onto each machine entry", () => {
    const rows = buildProjectRows({
      projects: [
        project({
          environmentId: NODE_A,
          id: "project-a",
          name: "ryco",
          cwd: "/code/ryco",
          canonicalKey: CANONICAL_KEY,
          updatedAt: "2026-07-20T10:00:00.000Z",
        }),
        project({
          environmentId: NODE_B,
          id: "project-b",
          name: "ryco-server",
          cwd: "/srv/ryco",
          canonicalKey: CANONICAL_KEY,
          updatedAt: "2026-07-25T10:00:00.000Z",
        }),
      ],
      ...EMPTY,
      environments: [
        {
          ...MAC,
          connectionState: "offline",
          stale: true,
          staleDetail: "Offline · last seen 12m ago",
          role: "owner",
          trust: "verified",
        },
        { ...LINUX, connectionState: "read-only", role: "viewer", trust: "unverified" },
      ],
      groupingMode: "repository",
    });

    const [linux, mac] = rows[0]?.machines ?? [];
    expect(linux).toMatchObject({
      label: "Linux box",
      connectionState: "read-only",
      role: "viewer",
      trust: "unverified",
    });
    expect(linux?.stale).toBeUndefined();
    expect(mac).toMatchObject({
      stale: true,
      staleDetail: "Offline · last seen 12m ago",
      role: "owner",
      trust: "verified",
    });
    // Wave 2 vocabulary wins over the live-state word for cached rows.
    expect(projectMachineStatusLabel(mac!)).toBe("Offline · last seen 12m ago");
    expect(projectMachineStatusLabel(linux!)).toBe("Read-only");
    expect(projectRowAccessibilityLabel(rows[0]!)).toBe(
      "Ryco, 0 worktrees, 0 active tasks, on Linux box, Mac Studio, Viewer, Not verified",
    );
  });

  it("sorts rows by recency, then title", () => {
    const rows = buildProjectRows({
      projects: [
        project({
          environmentId: NODE_A,
          id: "project-old",
          name: "Older",
          cwd: "/code/older",
          updatedAt: "2026-07-01T10:00:00.000Z",
        }),
        project({
          environmentId: NODE_A,
          id: "project-new",
          name: "Newer",
          cwd: "/code/newer",
          updatedAt: "2026-07-30T10:00:00.000Z",
        }),
      ],
      worktrees: [],
      // A live task is more recent than either project's own timestamp.
      threads: [thread(NODE_A, "thread-old", "project-old", "2026-08-02T10:00:00.000Z")],
      environments: [MAC],
      groupingMode: "repository",
    });

    expect(rows.map((row) => row.title)).toEqual(["Older", "Newer"]);
  });

  it("keeps a project whose machine is missing from the roster", () => {
    const rows = buildProjectRows({
      projects: [PROJECT],
      ...EMPTY,
      environments: [],
      groupingMode: "repository",
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.machines[0]).toMatchObject({
      label: "Unknown machine",
      connectionState: "offline",
    });
    expect(projectMachineStatusLabel(rows[0]!.machines[0]!)).toBe("Offline");
  });

  it("keeps a merged row when the query matches every member, and degrades when it matches one", () => {
    const projects = [
      project({
        environmentId: NODE_A,
        id: "project-a",
        name: "Ryco",
        cwd: "/code/checkout",
        canonicalKey: CANONICAL_KEY,
        updatedAt: "2026-07-20T10:00:00.000Z",
      }),
      project({
        environmentId: NODE_B,
        id: "project-b",
        name: "server checkout",
        cwd: "/srv/ryco",
        canonicalKey: CANONICAL_KEY,
        updatedAt: "2026-07-25T10:00:00.000Z",
      }),
    ];

    // Matches member A by name and member B by path — the row stays merged.
    const merged = buildProjectRows({
      projects,
      ...EMPTY,
      environments: [MAC, LINUX],
      query: "ryco",
      groupingMode: "repository",
    });
    expect(merged).toHaveLength(1);
    expect(merged[0]?.machines).toHaveLength(2);

    // The query filters MEMBERS, so a one-member match is a plain row, never a
    // merged row claiming a machine the filter excluded.
    const scoped = buildProjectRows({
      projects,
      ...EMPTY,
      environments: [MAC, LINUX],
      query: "/srv",
      groupingMode: "repository",
    });
    expect(scoped).toHaveLength(1);
    expect(scoped[0]).toMatchObject({ key: `${NODE_B}:/srv/ryco`, title: "server checkout" });
    expect(scoped[0]?.machines).toHaveLength(1);
  });
});

describe("Project detail", () => {
  it("builds project detail with active, archived, and unattached task groups", () => {
    const archivedWorktree = {
      ...WORKTREE,
      id: "tree-archived",
      archivedAt: "2026-07-26T11:00:00.000Z",
    } as SidebarWorktreeSummary;
    const detail = buildProjectDetail({
      environmentId: NODE_A,
      projectId: PROJECT.id,
      projects: [PROJECT],
      worktrees: [WORKTREE, archivedWorktree],
      threads: [
        { ...THREAD, worktreeId: WORKTREE.id },
        { ...THREAD, id: "thread-root", worktreeId: null },
        { ...THREAD, id: "thread-archived", archivedAt: "2026-07-26T12:00:00.000Z" },
      ] as SidebarThreadSummary[],
      environments: [MAC],
    });

    expect(detail?.activeWorktrees).toHaveLength(1);
    expect(detail?.activeWorktrees[0]?.threads.map((thread) => thread.id)).toEqual(["thread-a"]);
    expect(detail?.archivedWorktrees).toHaveLength(1);
    expect(detail?.projectThreads.map((thread) => thread.id)).toEqual(["thread-root"]);
    expect(detail?.environment?.label).toBe("Mac Studio");
  });
});
