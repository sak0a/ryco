import type { Project, SidebarWorktreeSummary, Thread } from "@ryco/client-runtime/state/threads";
import type { EnvironmentId, ProjectId, WorktreeId } from "@ryco/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildThreadHeaderModel, findThreadWorktree } from "./threadHeaderModel";

const ENVIRONMENT_ID = "node-a" as EnvironmentId;
const PROJECT_ID = "project-a" as ProjectId;

function thread(
  overrides: Partial<
    Pick<
      Thread,
      | "title"
      | "archivedAt"
      | "latestTurn"
      | "session"
      | "turnDiffSummaries"
      | "branch"
      | "worktreePath"
    >
  > = {},
) {
  return {
    title: "Fix mobile navigation",
    archivedAt: null,
    latestTurn: null,
    session: null,
    turnDiffSummaries: [],
    branch: "feat/mobile",
    worktreePath: "/repo/.worktrees/mobile",
    ...overrides,
  } as Pick<
    Thread,
    | "title"
    | "archivedAt"
    | "latestTurn"
    | "session"
    | "turnDiffSummaries"
    | "branch"
    | "worktreePath"
  >;
}

describe("buildThreadHeaderModel", () => {
  it("makes the node, project, and worktree hierarchy explicit", () => {
    const model = buildThreadHeaderModel({
      thread: thread(),
      project: { name: "Ryco" } as Project,
      worktree: { title: "Mobile redesign", branch: "feat/mobile" } as SidebarWorktreeSummary,
      nodeLabel: "Mac Studio",
      hasPendingApproval: false,
      hasPendingUserInput: false,
    });

    expect(model).toMatchObject({
      title: "Fix mobile navigation",
      nodeLabel: "Mac Studio",
      projectLabel: "Ryco",
      worktreeLabel: "Mobile redesign",
      statusLabel: "Ready",
      reviewVisible: false,
      moreActions: ["rename", "archive", "details"],
    });
    expect(model.contextAccessibilityLabel).toContain(
      "node Mac Studio, project Ryco, worktree Mobile redesign",
    );
  });

  it("prioritizes attention states and exposes stop/review while a turn is running", () => {
    const model = buildThreadHeaderModel({
      thread: thread({
        latestTurn: { state: "running" } as Thread["latestTurn"],
        turnDiffSummaries: [{ files: [{ path: "app.ts" }] } as never],
      }),
      project: { name: "Ryco" } as Project,
      worktree: null,
      nodeLabel: "MacBook",
      hasPendingApproval: true,
      hasPendingUserInput: false,
    });

    expect(model.statusLabel).toBe("Needs approval");
    expect(model.reviewVisible).toBe(true);
    expect(model.moreActions).toEqual(["rename", "stop", "archive", "details"]);
  });

  it("offers unarchive and falls back to understandable context names", () => {
    const model = buildThreadHeaderModel({
      thread: thread({
        title: " ",
        archivedAt: "2026-07-26T00:00:00.000Z",
        branch: null,
        worktreePath: "/repo/.worktrees/recovery",
      }),
      project: null,
      worktree: null,
      nodeLabel: null,
      hasPendingApproval: false,
      hasPendingUserInput: false,
    });

    expect(model).toMatchObject({
      title: "Untitled task",
      nodeLabel: "Node",
      projectLabel: "Project",
      worktreeLabel: "recovery",
      statusLabel: "Archived",
      moreActions: ["rename", "unarchive", "details"],
    });
  });
});

describe("findThreadWorktree", () => {
  const worktrees = [
    {
      id: "worktree-a" as WorktreeId,
      environmentId: ENVIRONMENT_ID,
      projectId: PROJECT_ID,
      branch: "feat/mobile",
      worktreePath: "/repo/.worktrees/mobile",
    } as SidebarWorktreeSummary,
  ];

  it("matches by id, then path, then branch within the same node and project", () => {
    expect(
      findThreadWorktree(
        {
          environmentId: ENVIRONMENT_ID,
          projectId: PROJECT_ID,
          worktreeId: "worktree-a",
          worktreePath: null,
          branch: null,
        } as Pick<Thread, "environmentId" | "projectId" | "worktreeId" | "worktreePath" | "branch">,
        worktrees,
      )?.id,
    ).toBe("worktree-a");

    expect(
      findThreadWorktree(
        {
          environmentId: ENVIRONMENT_ID,
          projectId: PROJECT_ID,
          worktreeId: null,
          worktreePath: null,
          branch: "feat/mobile",
        } as Pick<Thread, "environmentId" | "projectId" | "worktreeId" | "worktreePath" | "branch">,
        worktrees,
      )?.id,
    ).toBe("worktree-a");
  });
});
