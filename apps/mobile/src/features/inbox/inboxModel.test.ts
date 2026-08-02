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
const NOW_MS = Date.parse("2026-07-26T12:00:00.000Z");

function environment(environmentId: EnvironmentId, label: string) {
  return {
    environmentId,
    label,
    connectionState: "connected" as const,
    threadSettlementSupported: true,
    mutationReady: true,
    shellCurrent: true,
  };
}

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
    settledOverride: null,
    settledAt: null,
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
  it("keeps idle work and attention blockers together in the Active queue", () => {
    const projects = [project(NODE_A, "project-a", "Ryco"), project(NODE_B, "project-b", "Hub")];
    const sections = buildInboxSections({
      projects,
      worktrees: [],
      environments: [environment(NODE_A, "Mac Studio"), environment(NODE_B, "Build node")],
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
      nowMs: NOW_MS,
    });

    expect(sections.map((section) => section.title)).toEqual(["Active"]);
    expect(sections[0]?.rows.map((row) => row.threadId)).toEqual([
      "idle",
      "working",
      "approval",
      "uncertain",
    ]);
  });

  it("builds the complete node, project, and worktree context and filters it", () => {
    const sections = buildInboxSections({
      projects: [project(NODE_A, "project-a", "Ryco")],
      worktrees: [worktree(NODE_A, "tree-a", "project-a", "feat/mobile")],
      environments: [environment(NODE_A, "Mac Studio")],
      threads: [
        thread(NODE_A, "thread-a", "project-a", {
          title: "Polish inbox",
          worktreeId: "tree-a",
        } as never),
      ],
      query: "feat/mobile",
      nowMs: NOW_MS,
    });

    expect(sections[0]?.rows[0]?.contextLabel).toBe("Mac Studio · Ryco · feat/mobile");
  });

  it("scopes by node and excludes archived tasks", () => {
    const sections = buildInboxSections({
      projects: [project(NODE_A, "a", "A"), project(NODE_B, "b", "B")],
      worktrees: [],
      environments: [environment(NODE_A, "A"), environment(NODE_B, "B")],
      threads: [
        thread(NODE_A, "visible", "a"),
        thread(NODE_B, "other", "b"),
        thread(NODE_A, "archived", "a", { archivedAt: "2026-07-26T09:00:00.000Z" }),
      ],
      nodeScope: NODE_A,
      nowMs: NOW_MS,
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
      environments: [environment(NODE_A, "Studio")],
      nowMs: NOW_MS,
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
      environments: [environment(NODE_A, "Studio")],
      nowMs: NOW_MS,
    });
    expect(sections.flatMap((section) => section.rows)[0]?.changeRequest).toBeNull();
  });

  it("partitions manual and merged-PR work into Settled", () => {
    const merged = {
      ...worktree(NODE_A, "tree-a", "project-a", "feat/mobile"),
      prNumber: 42,
      prState: "merged" as const,
      updatedAt: "2026-07-26T10:00:00.000Z",
    };
    const sections = buildInboxSections({
      projects: [project(NODE_A, "project-a", "Ryco")],
      worktrees: [merged],
      threads: [
        thread(NODE_A, "manual", "project-a", {
          settledOverride: "settled",
          settledAt: "2026-07-26T11:00:00.000Z",
        }),
        thread(NODE_A, "merged", "project-a", { worktreeId: "tree-a" } as never),
        thread(NODE_A, "kept-active", "project-a", {
          worktreeId: "tree-a",
          settledOverride: "active",
        } as never),
      ],
      environments: [environment(NODE_A, "Studio")],
      nowMs: NOW_MS,
    });

    expect(sections.map((section) => section.title)).toEqual(["Active", "Settled"]);
    expect(sections[0]?.rows.map((row) => row.threadId)).toEqual(["kept-active"]);
    expect(sections[1]?.rows.map((row) => row.threadId)).toEqual(["manual", "merged"]);
  });

  it("keeps persisted outbox work active and non-settleable", () => {
    const sections = buildInboxSections({
      projects: [project(NODE_A, "project-a", "Ryco")],
      worktrees: [],
      threads: [
        thread(NODE_A, "queued", "project-a", {
          settledOverride: "settled",
          settledAt: "2026-07-26T11:00:00.000Z",
        }),
      ],
      environments: [environment(NODE_A, "Studio")],
      localQueuedThreadIds: new Set(["node-a:queued"]),
      nowMs: NOW_MS,
    });

    expect(sections[0]?.key).toBe("active");
    expect(sections[0]?.rows[0]).toMatchObject({
      threadId: "queued",
      canSettle: false,
      settlementBlocker: "local-queue",
    });
  });
});
