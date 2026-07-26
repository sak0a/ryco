import { describe, expect, it } from "vite-plus/test";

import type {
  Project,
  SidebarThreadSummary,
  SidebarWorktreeSummary,
} from "@ryco/client-runtime/state/threads";
import type { EnvironmentId } from "@ryco/contracts";

import { buildInboxSections, resolveInboxEmptyState } from "./inboxModel";

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
