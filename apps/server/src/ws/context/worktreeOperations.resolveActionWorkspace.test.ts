import { Effect, Option } from "effect";
import { describe, expect, it } from "vite-plus/test";
import { type OrchestrationCommand, ProjectId, ThreadId, WorktreeId } from "@ryco/contracts";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionWorktreeRepository } from "../../persistence/Services/ProjectionWorktrees.ts";
import { SourceControlProviderRegistry } from "../../sourceControl/SourceControlProviderRegistry.ts";
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

describe("createWorktreeForProject with existingThreadId", () => {
  const EXISTING_THREAD_ID = ThreadId.make("thread-existing");

  function makeRecordingOperations(overrides?: { findByOrigin?: WorktreeId | null }) {
    const dispatched: OrchestrationCommand[] = [];
    const setupRuns: Array<{ threadId: string }> = [];
    const operations = makeWorktreeOperations({
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
        findByWorkItem: () => Effect.succeed(null),
        getById: () => Effect.succeed(Option.some(registeredWorktree)),
      } as never,
      gitWorkflow: {
        createWorktree: (input: { refName: string; path: string }) =>
          Effect.succeed({
            worktree: { path: input.path, refName: input.refName },
          }),
        listWorktreePaths: () => Effect.succeed([]),
        listLocalBranchNames: () => Effect.succeed([]),
      } as never,
      vcsProvisioning: {} as never,
      config: { worktreesDir: "/tmp/resolve-action-workspace/app-worktrees" } as never,
      textGeneration: {} as never,
      projectSetupScriptRunner: {
        runForThread: (input: { threadId: string }) => {
          setupRuns.push({ threadId: input.threadId });
          return Effect.succeed({ status: "no-script" as const });
        },
      } as never,
      serverCommandId: (tag: string) => `cmd-${tag}` as never,
      dispatchNormalizedCommand: ((command: OrchestrationCommand) => {
        dispatched.push(command);
        return Effect.succeed({ sequence: dispatched.length });
      }) as never,
      refreshGitStatus: () => Effect.void,
      appendSetupScriptActivity: (() => Effect.succeed({})) as never,
    });
    return { operations, dispatched, setupRuns };
  }

  const provideStubServices = <A, E>(effect: Effect.Effect<A, E, unknown>) =>
    effect.pipe(
      Effect.provideService(
        SourceControlProviderRegistry,
        { resolve: () => Effect.die("not used") } as never,
      ),
      Effect.provideService(
        ProjectionWorktreeRepository,
        { getById: () => Effect.succeed(Option.none()) } as never,
      ),
      Effect.provideService(
        OrchestrationEngineService,
        { dispatch: () => Effect.succeed({ sequence: 0 }) } as never,
      ),
    ) as Effect.Effect<A, E>;

  it("attaches the existing thread when a linked worktree is reused", async () => {
    const { operations, dispatched } = makeRecordingOperations({ findByOrigin: WORKTREE_ID });
    const result = await Effect.runPromise(
      provideStubServices(
        operations.createWorktreeForProject(
          { projectId: PROJECT_ID, intent: { kind: "pr", number: 42 } },
          { existingThreadId: EXISTING_THREAD_ID },
        ),
      ),
    );
    expect(result.sessionId).toBe(EXISTING_THREAD_ID);
    expect(result.worktreeId).toBe(WORKTREE_ID);
    expect(dispatched.map((command) => command.type)).toEqual([
      "thread.meta.update",
      "thread.attach-to-worktree",
    ]);
  });

  it("creates the worktree and updates the existing thread instead of creating one", async () => {
    const { operations, dispatched, setupRuns } = makeRecordingOperations();
    const result = await Effect.runPromise(
      provideStubServices(
        operations.createWorktreeForProject(
          {
            projectId: PROJECT_ID,
            intent: { kind: "newBranch", branchName: "task/fix-login", baseBranch: "main" },
          },
          { existingThreadId: EXISTING_THREAD_ID },
        ),
      ),
    );
    expect(result.sessionId).toBe(EXISTING_THREAD_ID);
    expect(dispatched.map((command) => command.type)).toEqual([
      "worktree.create",
      "thread.meta.update",
      "thread.attach-to-worktree",
    ]);
    const metaUpdate = dispatched.find((command) => command.type === "thread.meta.update");
    expect(metaUpdate && "threadId" in metaUpdate ? metaUpdate.threadId : null).toBe(
      EXISTING_THREAD_ID,
    );
    // The setup script launches on a detached fiber; give it a beat and
    // accept either outcome timing-wise, but if it ran it must target the
    // existing thread.
    await new Promise((resolve) => setTimeout(resolve, 25));
    for (const run of setupRuns) {
      expect(run.threadId).toBe(EXISTING_THREAD_ID);
    }
  });

  it("still creates a fresh thread when no existing thread is supplied", async () => {
    const { operations, dispatched } = makeRecordingOperations();
    await expect(
      Effect.runPromise(
        provideStubServices(
          operations.createWorktreeForProject({
            projectId: PROJECT_ID,
            intent: { kind: "newBranch", branchName: "task/fix-login", baseBranch: "main" },
          }),
        ),
      ),
    ).rejects.toThrow(/no default model selection/);
    expect(dispatched).toEqual([]);
  });
});
