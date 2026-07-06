import { Effect, Option } from "effect";
import { describe, expect, it } from "vite-plus/test";
import { ProjectId, WorktreeId } from "@ryco/contracts";

import { makeWorktreeOperations } from "./worktreeOperations.ts";

const PROJECT_ID = ProjectId.make("project-1");
const WORKSPACE_ROOT = "/tmp/resolve-action-workspace/project";
const WORKTREE_ID = WorktreeId.make("worktree-1");

const registeredWorktree: {
  worktreeId: WorktreeId;
  projectId: ProjectId;
  branch: string;
  worktreePath: string | null;
  origin: string;
  archivedAt: string | null;
} = {
  worktreeId: WORKTREE_ID,
  projectId: PROJECT_ID,
  branch: "feature/tokens",
  worktreePath: "/tmp/resolve-action-workspace/worktrees/feature-tokens__abcde",
  origin: "pr",
  archivedAt: null,
};

function makeOperations(overrides?: {
  findByOrigin?: WorktreeId | null;
  findByWorkItem?: WorktreeId | null;
  worktree?: Partial<typeof registeredWorktree> | null;
  headBranch?: string;
  refs?: ReadonlyArray<{
    name: string;
    isRemote?: boolean;
    current: boolean;
    worktreePath: string | null;
  }>;
}) {
  const worktreeRecord =
    overrides?.worktree === null ? null : { ...registeredWorktree, ...overrides?.worktree };
  const notCalled = (label: string) => () => {
    throw new Error(`${label} must not be called by resolveActionWorkspace`);
  };
  return makeWorktreeOperations({
    projectionSnapshotQuery: {
      getProjectShellById: () =>
        Effect.succeed(
          Option.some({
            id: PROJECT_ID,
            workspaceRoot: WORKSPACE_ROOT,
            projectMetadataDir: ".ryco",
            defaultModelSelection: null,
          }),
        ),
    } as never,
    projectionWorktrees: {
      findByOrigin: () => Effect.succeed(overrides?.findByOrigin ?? null),
      findByWorkItem: () => Effect.succeed(overrides?.findByWorkItem ?? null),
      getById: () =>
        Effect.succeed(worktreeRecord === null ? Option.none() : Option.some(worktreeRecord)),
    } as never,
    gitWorkflow: {
      resolvePullRequest: () =>
        Effect.succeed({
          pullRequest: {
            number: 42,
            title: "Add token usage attribution",
            url: "https://github.com/owner/repo/pull/42",
            baseBranch: "main",
            headBranch: overrides?.headBranch ?? "feature/tokens",
            state: "open",
          },
        }),
      listRefs: () =>
        Effect.succeed({
          refs: overrides?.refs ?? [],
          isRepo: true,
          hasPrimaryRemote: true,
          nextCursor: null,
          totalCount: overrides?.refs?.length ?? 0,
        }),
      createWorktree: notCalled("gitWorkflow.createWorktree"),
      preparePullRequestThread: notCalled("gitWorkflow.preparePullRequestThread"),
    } as never,
    vcsProvisioning: {} as never,
    config: { worktreesDir: "/tmp/resolve-action-workspace/app-worktrees" } as never,
    textGeneration: {} as never,
    projectSetupScriptRunner: {} as never,
    serverCommandId: (tag: string) => `cmd-${tag}` as never,
    dispatchNormalizedCommand: notCalled("dispatchNormalizedCommand") as never,
    refreshGitStatus: () => Effect.void,
    appendSetupScriptActivity: notCalled("appendSetupScriptActivity") as never,
  });
}

describe("resolveActionWorkspace", () => {
  it("reuses a registered worktree linked to the PR", async () => {
    const operations = makeOperations({ findByOrigin: WORKTREE_ID });
    const result = await Effect.runPromise(
      operations.resolveActionWorkspace({
        projectId: PROJECT_ID,
        intent: { kind: "pr", number: 42 },
      }),
    );
    expect(result.plan).toEqual({
      kind: "reuse-worktree",
      worktreeId: WORKTREE_ID,
      worktreePath: registeredWorktree.worktreePath,
      branch: registeredWorktree.branch,
    });
  });

  it("reuses a registered worktree linked to a work item", async () => {
    const operations = makeOperations({ findByWorkItem: WORKTREE_ID });
    const result = await Effect.runPromise(
      operations.resolveActionWorkspace({
        projectId: PROJECT_ID,
        intent: { kind: "workItem", provider: "jira", key: "RYC-231", title: "Ticket" },
      }),
    );
    expect(result.plan.kind).toBe("reuse-worktree");
  });

  it("falls through to create when the registered worktree is archived", async () => {
    const operations = makeOperations({
      findByOrigin: WORKTREE_ID,
      worktree: { archivedAt: "2026-07-01T00:00:00.000Z" },
      refs: [],
    });
    const result = await Effect.runPromise(
      operations.resolveActionWorkspace({
        projectId: PROJECT_ID,
        intent: { kind: "pr", number: 42 },
      }),
    );
    expect(result.plan).toEqual({ kind: "create-worktree", plannedBranch: "feature/tokens" });
  });

  it("plans a local main checkout when the PR head branch is checked out at the project root", async () => {
    const operations = makeOperations({
      refs: [
        {
          name: "feature/tokens",
          isRemote: false,
          current: true,
          worktreePath: WORKSPACE_ROOT,
        },
      ],
    });
    const result = await Effect.runPromise(
      operations.resolveActionWorkspace({
        projectId: PROJECT_ID,
        intent: { kind: "pr", number: 42 },
      }),
    );
    expect(result.plan).toEqual({ kind: "local-main-checkout", branch: "feature/tokens" });
  });

  it("plans a worktree creation with the PR head branch when nothing is checked out", async () => {
    const operations = makeOperations({
      refs: [{ name: "main", isRemote: false, current: true, worktreePath: WORKSPACE_ROOT }],
    });
    const result = await Effect.runPromise(
      operations.resolveActionWorkspace({
        projectId: PROJECT_ID,
        intent: { kind: "pr", number: 42 },
      }),
    );
    expect(result.plan).toEqual({ kind: "create-worktree", plannedBranch: "feature/tokens" });
  });

  it("ignores remote refs matching the head branch", async () => {
    const operations = makeOperations({
      refs: [
        { name: "feature/tokens", isRemote: true, current: false, worktreePath: null },
      ],
    });
    const result = await Effect.runPromise(
      operations.resolveActionWorkspace({
        projectId: PROJECT_ID,
        intent: { kind: "pr", number: 42 },
      }),
    );
    expect(result.plan.kind).toBe("create-worktree");
  });

  it("plans plain worktree creation for issues without a linked worktree", async () => {
    const operations = makeOperations({});
    const result = await Effect.runPromise(
      operations.resolveActionWorkspace({
        projectId: PROJECT_ID,
        intent: { kind: "issue", number: 17, title: "Fix login" },
      }),
    );
    expect(result.plan).toEqual({ kind: "create-worktree" });
  });
});
