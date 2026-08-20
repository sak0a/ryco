import { describe, expect, it } from "vite-plus/test";

import type {
  Project,
  SidebarThreadSummary,
  SidebarWorktreeSummary,
} from "@ryco/client-runtime/state/threads";
import type { EnvironmentId } from "@ryco/contracts";

import { NODE_TRUST_UNVERIFIED_LABEL } from "../home/nodeTrustModel";
import { buildInboxSections, resolveInboxEmptyState, type InboxEnvironment } from "./inboxModel";

const NODE_A = "node-a" as EnvironmentId;
const NODE_B = "node-b" as EnvironmentId;

function project(environmentId: EnvironmentId, id: string, name: string): Project {
  return {
    environmentId,
    id: id as never,
    name,
    cwd: `/${name.toLocaleLowerCase()}`,
    defaultModelSelection: null,
    scripts: [],
  };
}

function worktree(
  environmentId: EnvironmentId,
  id: string,
  projectId: string,
  branch: string,
): SidebarWorktreeSummary {
  return {
    environmentId,
    id: id as never,
    projectId: projectId as never,
    branch,
    title: null,
    worktreePath: null,
    origin: "main",
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
    createdAt: "2026-07-26T08:00:00.000Z",
    updatedAt: "2026-07-26T08:00:00.000Z",
    archivedAt: null,
    manualPosition: 0,
  };
}

function thread(
  environmentId: EnvironmentId,
  id: string,
  projectId: string,
  overrides: Partial<SidebarThreadSummary> = {},
): SidebarThreadSummary {
  return {
    environmentId,
    id: id as never,
    projectId: projectId as never,
    title: id,
    interactionMode: "default",
    session: null,
    createdAt: "2026-07-26T08:00:00.000Z",
    archivedAt: null,
    updatedAt: "2026-07-26T08:00:00.000Z",
    latestTurn: null,
    branch: null,
    worktreePath: null,
    worktreeId: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...overrides,
  };
}

describe("Inbox model", () => {
  it("prioritizes input, delivery uncertainty, and running work above recent tasks", () => {
    const projects = [project(NODE_A, "project-a", "Ryco"), project(NODE_B, "project-b", "Hub")];
    const sections = buildInboxSections({
      projects,
      worktrees: [],
      environments: [
        { environmentId: NODE_A, label: "Mac Studio", connectionState: "connected" },
        { environmentId: NODE_B, label: "Build node", connectionState: "connected" },
      ],
      threads: [
        thread(NODE_A, "idle", "project-a", {
          updatedAt: "2026-07-26T09:00:00.000Z",
        }),
        thread(NODE_A, "working", "project-a", {
          latestTurn: { state: "running" } as never,
        }),
        thread(NODE_B, "approval", "project-b", {
          hasPendingApprovals: true,
        }),
        thread(NODE_B, "uncertain", "project-b"),
      ],
      deliveryUnknownThreadIds: new Set(["node-b:uncertain"]),
    });

    expect(sections.map((section) => section.title)).toEqual(["Active now", "Recent"]);
    expect(sections[0]?.rows.map((row) => row.threadId)).toEqual([
      "approval",
      "uncertain",
      "working",
    ]);
    expect(sections[1]?.rows.map((row) => row.threadId)).toEqual(["idle"]);
  });

  it("builds the complete node, project, and worktree context and filters it", () => {
    const sections = buildInboxSections({
      projects: [project(NODE_A, "project-a", "Ryco")],
      worktrees: [worktree(NODE_A, "tree-a", "project-a", "feat/mobile")],
      environments: [{ environmentId: NODE_A, label: "Mac Studio", connectionState: "connected" }],
      threads: [
        thread(NODE_A, "thread-a", "project-a", {
          title: "Polish inbox",
          worktreeId: "tree-a",
        } as never),
      ],
      query: "feat/mobile",
    });

    expect(sections[0]?.rows[0]?.contextLabel).toBe("Mac Studio · Ryco · feat/mobile");
  });

  it("scopes by node and excludes archived tasks", () => {
    const sections = buildInboxSections({
      projects: [project(NODE_A, "a", "A"), project(NODE_B, "b", "B")],
      worktrees: [],
      environments: [
        { environmentId: NODE_A, label: "A", connectionState: "connected" },
        { environmentId: NODE_B, label: "B", connectionState: "connected" },
      ],
      threads: [
        thread(NODE_A, "visible", "a"),
        thread(NODE_B, "other", "b"),
        thread(NODE_A, "archived", "a", { archivedAt: "2026-07-26T09:00:00.000Z" }),
      ],
      nodeScope: NODE_A,
    });

    expect(sections.flatMap((section) => section.rows).map((row) => row.threadId)).toEqual([
      "visible",
    ]);
  });

  it("routes every empty state to its missing prerequisite", () => {
    expect(
      resolveInboxEmptyState({
        environmentCount: 0,
        projectCount: 0,
        threadCount: 0,
        hasFilter: false,
      }),
    ).toBe("connect-node");
    expect(
      resolveInboxEmptyState({
        environmentCount: 1,
        projectCount: 0,
        threadCount: 0,
        hasFilter: false,
      }),
    ).toBe("add-project");
    expect(
      resolveInboxEmptyState({
        environmentCount: 1,
        projectCount: 1,
        threadCount: 0,
        hasFilter: false,
      }),
    ).toBe("new-task");
    expect(
      resolveInboxEmptyState({
        environmentCount: 1,
        projectCount: 1,
        threadCount: 2,
        hasFilter: true,
      }),
    ).toBe("clear-filter");
  });
});

describe("inbox change-request badge", () => {
  it("carries the worktree's pull request onto the row", () => {
    // The fields were already reaching this module and being discarded at the
    // output boundary — that is the regression this pins.
    const tree = {
      ...worktree(NODE_A, "tree-a", "project-a", "feat/mobile"),
      prNumber: 42,
      prState: "open" as const,
    };
    const sections = buildInboxSections({
      projects: [project(NODE_A, "project-a", "Ryco")],
      worktrees: [tree],
      threads: [thread(NODE_A, "thread-a", "project-a", { worktreeId: "tree-a" })],
      environments: [{ environmentId: NODE_A, label: "Studio", connectionState: "connected" }],
    });
    const row = sections.flatMap((section) => section.rows)[0];
    expect(row?.changeRequest?.label).toBe("#42");
    expect(row?.changeRequest?.tone).toBe("open");
  });

  it("leaves the badge null when the worktree has no linked work", () => {
    const sections = buildInboxSections({
      projects: [project(NODE_A, "project-a", "Ryco")],
      worktrees: [worktree(NODE_A, "tree-a", "project-a", "feat/mobile")],
      threads: [thread(NODE_A, "thread-a", "project-a", { worktreeId: "tree-a" })],
      environments: [{ environmentId: NODE_A, label: "Studio", connectionState: "connected" }],
    });
    expect(sections.flatMap((section) => section.rows)[0]?.changeRequest).toBeNull();
  });

  it("presents a stale environment's rows as offline, never as live or actionable", () => {
    const sections = buildInboxSections({
      projects: [project(NODE_A, "project-a", "Ryco"), project(NODE_B, "project-b", "Hub")],
      worktrees: [],
      environments: [
        {
          environmentId: NODE_A,
          label: "Work Mac",
          connectionState: "offline",
          stale: true,
          staleDetail: "Offline · last seen 2h ago",
        },
        { environmentId: NODE_B, label: "Build node", connectionState: "connected" },
      ],
      threads: [
        // Cached fields that would otherwise read as live or actionable.
        thread(NODE_A, "cached-running", "project-a", {
          latestTurn: { state: "running" } as never,
        }),
        thread(NODE_A, "cached-approval", "project-a", { hasPendingApprovals: true }),
        thread(NODE_B, "live-working", "project-b", {
          latestTurn: { state: "running" } as never,
        }),
      ],
    });

    const active = sections.find((section) => section.key === "active");
    const recent = sections.find((section) => section.key === "recent");
    expect(active?.rows.map((row) => row.threadId)).toEqual(["live-working"]);
    expect(recent?.rows.map((row) => row.state)).toEqual(["offline", "offline"]);
    expect(recent?.rows[0]?.statusLabel).toBe("Offline · last seen 2h ago");
  });
});

describe("inbox row provenance", () => {
  function rowsFor(environment: InboxEnvironment) {
    return buildInboxSections({
      projects: [project(environment.environmentId, "project-a", "Ryco")],
      worktrees: [],
      threads: [thread(environment.environmentId, "thread-a", "project-a")],
      environments: [environment],
    }).flatMap((section) => section.rows);
  }

  it("labels an unverified node in the runtime's own words", () => {
    const row = rowsFor({
      environmentId: NODE_A,
      label: "Work Mac",
      connectionState: "connected",
      trust: "unverified",
    })[0];

    expect(row?.trustLabel).toBe(NODE_TRUST_UNVERIFIED_LABEL);
    expect(row?.trustLabel).toBe("Not verified");
  });

  it("makes no trust claim for a verified node or for one with no evidence", () => {
    expect(
      rowsFor({
        environmentId: NODE_A,
        label: "Work Mac",
        connectionState: "connected",
        trust: "verified",
      })[0]?.trustLabel,
    ).toBeNull();
    expect(
      rowsFor({ environmentId: NODE_A, label: "Work Mac", connectionState: "connected" })[0]
        ?.trustLabel,
    ).toBeNull();
  });

  it("surfaces the role only when it changes what the user may do", () => {
    expect(
      rowsFor({
        environmentId: NODE_A,
        label: "Work Mac",
        connectionState: "read-only",
        role: "viewer",
      })[0]?.roleLabel,
    ).toBe("Viewer");
    for (const role of ["operator", "owner", "client"] as const) {
      expect(
        rowsFor({
          environmentId: NODE_A,
          label: "Work Mac",
          connectionState: "connected",
          role,
        })[0]?.roleLabel,
      ).toBeNull();
    }
    expect(
      rowsFor({ environmentId: NODE_A, label: "Work Mac", connectionState: "connected" })[0]
        ?.roleLabel,
    ).toBeNull();
  });

  it("composes provenance beside wave 2's staleness rather than replacing it", () => {
    // Staleness and trust are independent facts about the row: the status text
    // stays the presence-derived phrase, and the trust marker sits next to it.
    const row = rowsFor({
      environmentId: NODE_A,
      label: "Work Mac",
      connectionState: "offline",
      stale: true,
      staleDetail: "Offline · last seen 2h ago",
      role: "viewer",
      trust: "unverified",
    })[0];

    expect(row?.state).toBe("offline");
    expect(row?.statusLabel).toBe("Offline · last seen 2h ago");
    expect(row?.roleLabel).toBe("Viewer");
    expect(row?.trustLabel).toBe("Not verified");
  });
});
