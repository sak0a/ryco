import { existsSync } from "node:fs";
import path from "node:path";

import { Effect, Option } from "effect";
import {
  type CommandId,
  type GitCreateWorktreeForProjectInput,
  type GitManagerServiceError,
  type GitResolveActionWorkspaceInput,
  type OrchestrationCommand,
  type OrchestrationDispatchCommandError,
  type ProjectId,
  ThreadId,
  WorktreeId,
} from "@ryco/contracts";
import { buildTemporaryWorktreeBranchName } from "@ryco/shared/git";

import type { OrchestrationDispatchError } from "../../orchestration/Errors.ts";
import type { ServerConfigShape } from "../../config.ts";
import type { GitWorkflowServiceShape } from "../../git/GitWorkflowService.ts";
import type { ProjectionSnapshotQueryShape } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { resolveProjectWorktreesDir } from "../../project/projectMetadataPaths.ts";
import type { ProjectSetupScriptRunnerShape } from "../../project/Services/ProjectSetupScriptRunner.ts";
import { resolveWorktreeCheckoutPath } from "../../project/worktreeCheckoutPaths.ts";
import type { ProjectionWorktreeRepositoryShape } from "../../persistence/Services/ProjectionWorktrees.ts";
import { refreshWorktreeSourceControlState } from "../../sourceControl/refreshWorktreeSourceControlState.ts";
import type { TextGenerationShape } from "../../textGeneration/TextGeneration.ts";
import type { VcsProvisioningServiceShape } from "../../vcs/VcsProvisioningService.ts";
import {
  buildIssueBranchNameFallback,
  buildIssueBranchNameMessage,
  buildWorkItemBranchNameFallback,
  buildWorkItemBranchNameMessage,
  ensureWorkItemBranchNameIncludesKey,
  randomShortId,
} from "./branchNaming.ts";
import {
  failGitWorkflow,
  ignoreAlreadyMissingGitResource,
  toGitManagerError,
} from "./gitErrors.ts";

type AppendSetupScriptActivity = (input: {
  readonly threadId: ThreadId;
  readonly kind: "setup-script.requested" | "setup-script.started" | "setup-script.failed";
  readonly summary: string;
  readonly createdAt: string;
  readonly payload: Record<string, unknown>;
  readonly tone: "info" | "error";
}) => Effect.Effect<unknown, OrchestrationDispatchError>;

export const makeWorktreeOperations = (deps: {
  readonly projectionSnapshotQuery: ProjectionSnapshotQueryShape;
  readonly projectionWorktrees: ProjectionWorktreeRepositoryShape;
  readonly gitWorkflow: GitWorkflowServiceShape;
  readonly vcsProvisioning: VcsProvisioningServiceShape;
  readonly config: ServerConfigShape;
  readonly textGeneration: TextGenerationShape;
  readonly projectSetupScriptRunner: ProjectSetupScriptRunnerShape;
  readonly serverCommandId: (tag: string) => CommandId;
  readonly dispatchNormalizedCommand: (
    command: OrchestrationCommand,
  ) => Effect.Effect<{ readonly sequence: number }, OrchestrationDispatchCommandError>;
  readonly refreshGitStatus: (cwd: string) => Effect.Effect<void>;
  readonly appendSetupScriptActivity: AppendSetupScriptActivity;
}) => {
  const {
    projectionSnapshotQuery,
    projectionWorktrees,
    gitWorkflow,
    vcsProvisioning,
    config,
    textGeneration,
    projectSetupScriptRunner,
    serverCommandId,
    dispatchNormalizedCommand,
    refreshGitStatus,
    appendSetupScriptActivity,
  } = deps;

  const loadProjectForGitWorkflow = (operation: string, projectId: ProjectId) =>
    projectionSnapshotQuery.getProjectShellById(projectId).pipe(
      Effect.mapError((cause) =>
        toGitManagerError(operation, `Failed to load project ${projectId}.`, cause),
      ),
      Effect.flatMap(
        Option.match({
          onNone: () => failGitWorkflow(operation, `Project ${projectId} not found.`),
          onSome: Effect.succeed,
        }),
      ),
    );

  const loadWorktreeForGitWorkflow = (operation: string, worktreeId: WorktreeId) =>
    projectionWorktrees.getById({ worktreeId }).pipe(
      Effect.mapError((cause) =>
        toGitManagerError(operation, `Failed to load worktree ${worktreeId}.`, cause),
      ),
      Effect.flatMap(
        Option.match({
          onNone: () => failGitWorkflow(operation, `Worktree ${worktreeId} not found.`),
          onSome: Effect.succeed,
        }),
      ),
    );

  const isProjectRootPath = (candidate: string, projectRoot: string): boolean => {
    const normalize = (value: string) => {
      const resolved = path.resolve(value).replace(/[\\/]+$/g, "");
      return process.platform === "win32" || process.platform === "darwin"
        ? resolved.toLowerCase()
        : resolved;
    };
    return normalize(candidate) === normalize(projectRoot);
  };

  const dispatchWorktreeCommand = (
    command: OrchestrationCommand,
    operation: string,
  ): Effect.Effect<void, GitManagerServiceError> =>
    dispatchNormalizedCommand(command).pipe(
      Effect.mapError((cause) =>
        toGitManagerError(operation, "Failed to dispatch orchestration command.", cause),
      ),
      Effect.asVoid,
    );

  const launchSetupScriptForWorktreeInBackground = (input: {
    readonly threadId: ThreadId;
    readonly projectId: ProjectId;
    readonly projectCwd: string;
    readonly worktreePath: string;
  }) =>
    Effect.gen(function* () {
      const requestedAt = new Date().toISOString();
      yield* projectSetupScriptRunner
        .runForThread({
          threadId: input.threadId,
          projectId: input.projectId,
          projectCwd: input.projectCwd,
          worktreePath: input.worktreePath,
        })
        .pipe(
          Effect.matchEffect({
            onFailure: (error) => {
              const detail = error instanceof Error ? error.message : "Unknown setup failure.";
              return appendSetupScriptActivity({
                threadId: input.threadId,
                kind: "setup-script.failed",
                summary: "Setup script failed to start",
                createdAt: requestedAt,
                payload: {
                  detail,
                  worktreePath: input.worktreePath,
                },
                tone: "error",
              }).pipe(
                Effect.ignoreCause({ log: false }),
                Effect.flatMap(() =>
                  Effect.logWarning("worktree setup script failed to start", {
                    threadId: input.threadId,
                    worktreePath: input.worktreePath,
                    detail,
                  }),
                ),
              );
            },
            onSuccess: (setupResult) => {
              if (setupResult.status !== "started") {
                return Effect.void;
              }
              const payload = {
                scriptId: setupResult.scriptId,
                scriptName: setupResult.scriptName,
                terminalId: setupResult.terminalId,
                worktreePath: input.worktreePath,
              };
              return Effect.all([
                appendSetupScriptActivity({
                  threadId: input.threadId,
                  kind: "setup-script.requested",
                  summary: "Starting setup script",
                  createdAt: requestedAt,
                  payload,
                  tone: "info",
                }),
                appendSetupScriptActivity({
                  threadId: input.threadId,
                  kind: "setup-script.started",
                  summary: "Setup script started",
                  createdAt: new Date().toISOString(),
                  payload,
                  tone: "info",
                }),
              ]).pipe(
                Effect.asVoid,
                Effect.catch((error) =>
                  Effect.logWarning(
                    "worktree setup script started but setup activity recording failed",
                    {
                      threadId: input.threadId,
                      worktreePath: input.worktreePath,
                      detail: error.message,
                    },
                  ),
                ),
              );
            },
          }),
        );
    }).pipe(Effect.ignoreCause({ log: true }), Effect.forkDetach, Effect.asVoid);

  const createWorktreeForProject = (
    input: GitCreateWorktreeForProjectInput,
    options?: {
      /**
       * Attach this pre-existing thread (created by the send bootstrap)
       * instead of creating a new one: `thread.create` dispatches become
       * `thread.meta.update` on the given thread.
       */
      readonly existingThreadId?: ThreadId;
    },
  ) =>
    Effect.gen(function* () {
      const operation = "git.createWorktreeForProject";
      const existingThreadId = options?.existingThreadId;
      if (
        input.intent.kind === "pr" ||
        input.intent.kind === "issue" ||
        input.intent.kind === "workItem"
      ) {
        const existing =
          input.intent.kind === "workItem"
            ? yield* projectionWorktrees
                .findByWorkItem({
                  projectId: input.projectId,
                  provider: input.intent.provider,
                  key: input.intent.key,
                })
                .pipe(
                  Effect.mapError((cause) =>
                    toGitManagerError(operation, "Failed to find existing worktree.", cause),
                  ),
                )
            : yield* projectionWorktrees
                .findByOrigin({
                  projectId: input.projectId,
                  kind: input.intent.kind,
                  number: input.intent.number ?? 0,
                })
                .pipe(
                  Effect.mapError((cause) =>
                    toGitManagerError(operation, "Failed to find existing worktree.", cause),
                  ),
                );
        if (existing !== null) {
          const existingWorktree = yield* loadWorktreeForGitWorkflow(operation, existing);
          const now = new Date().toISOString();
          let threadId: ThreadId;
          if (existingThreadId !== undefined) {
            threadId = existingThreadId;
            yield* dispatchWorktreeCommand(
              {
                type: "thread.meta.update",
                commandId: serverCommandId("worktree-thread-meta-update"),
                threadId,
                branch: existingWorktree.branch,
                worktreePath: existingWorktree.worktreePath,
              },
              operation,
            );
          } else {
            const project = yield* loadProjectForGitWorkflow(operation, input.projectId);
            const modelSelection = project.defaultModelSelection;
            if (modelSelection === null) {
              return yield* failGitWorkflow(
                operation,
                `Project ${input.projectId} has no default model selection.`,
              );
            }
            threadId = ThreadId.make(`thread-${crypto.randomUUID()}`);
            yield* dispatchWorktreeCommand(
              {
                type: "thread.create",
                commandId: serverCommandId("worktree-thread-create"),
                threadId,
                projectId: input.projectId,
                title:
                  existingWorktree.workItemTitle ??
                  existingWorktree.prTitle ??
                  existingWorktree.issueTitle ??
                  existingWorktree.branch,
                modelSelection,
                runtimeMode: "full-access",
                interactionMode: "default",
                branch: existingWorktree.branch,
                worktreePath: existingWorktree.worktreePath,
                createdAt: now,
              },
              operation,
            );
          }
          yield* dispatchWorktreeCommand(
            {
              type: "thread.attach-to-worktree",
              commandId: serverCommandId("worktree-thread-attach"),
              threadId,
              worktreeId: existing,
              attachedAt: now,
            },
            operation,
          );
          return { worktreeId: existing, sessionId: threadId };
        }
      }

      const project = yield* loadProjectForGitWorkflow(operation, input.projectId);
      const modelSelection = project.defaultModelSelection;
      // With an existing thread the model selection is only needed for AI
      // branch-name generation, which degrades to deterministic fallbacks.
      if (modelSelection === null && existingThreadId === undefined) {
        return yield* failGitWorkflow(
          operation,
          `Project ${input.projectId} has no default model selection.`,
        );
      }

      const now = new Date().toISOString();
      const worktreeId = WorktreeId.make(`worktree-${crypto.randomUUID()}`);
      const threadId = existingThreadId ?? ThreadId.make(`thread-${crypto.randomUUID()}`);
      let branch: string;
      let refName: string;
      let newRefName: string | undefined;
      let title: string;
      let origin: "branch" | "pr" | "issue" | "manual" = "branch";
      let prNumber: number | null = null;
      let issueNumber: number | null = null;
      let prTitle: string | null = null;
      let issueTitle: string | null = null;
      let workItemProvider: "jira" | null = null;
      let workItemKey: string | null = null;
      let workItemTitle: string | null = null;
      let workItemState: "open" | "in_progress" | "done" | "closed" | "unknown" | null = null;
      let workItemStateName: string | null = null;
      let workItemUrl: string | null = null;
      let preparedWorktreePath: string | null = null;
      let ownedWorktreePath: string | null = null;
      let ownedBranchName: string | null = null;

      switch (input.intent.kind) {
        case "branch":
          refName = input.intent.branchName;
          branch = buildTemporaryWorktreeBranchName();
          newRefName = branch;
          title = refName;
          break;
        case "newBranch":
          branch = input.intent.branchName ?? `task/${randomShortId(6)}`;
          refName = input.intent.baseBranch ?? "HEAD";
          newRefName = branch;
          title = branch;
          break;
        case "pr": {
          const number = input.intent.number ?? 0;
          const [existingWorktreePaths, existingBranchNames] = yield* Effect.all(
            [
              gitWorkflow.listWorktreePaths(project.workspaceRoot),
              gitWorkflow.listLocalBranchNames(project.workspaceRoot),
            ],
            { concurrency: 2 },
          );
          const prepared = yield* gitWorkflow.preparePullRequestThread({
            cwd: project.workspaceRoot,
            reference: String(number),
            mode: "worktree",
            projectId: input.projectId,
            worktreeLocation: input.worktreeLocation,
            worktreesDir:
              input.worktreeLocation === "projectMetadata"
                ? resolveProjectWorktreesDir(project.workspaceRoot, project.projectMetadataDir)
                : path.join(config.worktreesDir, input.projectId),
          });
          if (prepared.worktreePath === null) {
            return yield* failGitWorkflow(
              operation,
              `Failed to create worktree for PR #${number}.`,
            );
          }
          preparedWorktreePath = prepared.worktreePath;
          branch = prepared.branch;
          if (!existingWorktreePaths.includes(prepared.worktreePath)) {
            ownedWorktreePath = prepared.worktreePath;
          }
          if (!existingBranchNames.includes(prepared.branch)) {
            ownedBranchName = prepared.branch;
          }
          refName = branch;
          title = prepared.pullRequest.title;
          origin = "pr";
          prNumber = prepared.pullRequest.number;
          prTitle = prepared.pullRequest.title;
          break;
        }
        case "issue": {
          const number = input.intent.number ?? 0;
          const generatedBranchFallback = buildIssueBranchNameFallback(number);
          branch =
            input.intent.branchName ??
            (modelSelection === null
              ? generatedBranchFallback
              : yield* textGeneration
                  .generateBranchName({
                    cwd: project.workspaceRoot,
                    message: buildIssueBranchNameMessage({
                      number,
                      title: input.intent.title,
                      body: input.intent.body,
                    }),
                    modelSelection,
                  })
                  .pipe(
                    Effect.map(({ branch: generatedBranch }) => {
                      const trimmedBranch = generatedBranch.trim();
                      return trimmedBranch.length > 0 ? trimmedBranch : generatedBranchFallback;
                    }),
                    Effect.catch(() => Effect.succeed(generatedBranchFallback)),
                  ));
          refName = input.intent.baseBranch ?? "HEAD";
          newRefName = branch;
          title = input.intent.title?.trim() || `Issue #${number}`;
          origin = "issue";
          issueNumber = number;
          issueTitle = title;
          break;
        }
        case "workItem": {
          const key = input.intent.key.trim().toUpperCase();
          const generatedBranchFallback = buildWorkItemBranchNameFallback({
            key,
            title: input.intent.title,
          });
          if (input.intent.branchSource === "existing") {
            const existingBranch = input.intent.branchName?.trim();
            if (!existingBranch) {
              return yield* failGitWorkflow(
                operation,
                `Select an existing branch for Jira work item ${key}.`,
              );
            }
            branch = existingBranch;
            refName = existingBranch;
          } else {
            const requestedBranch =
              input.intent.branchName ??
              (modelSelection === null
                ? generatedBranchFallback
                : yield* textGeneration
                    .generateBranchName({
                      cwd: project.workspaceRoot,
                      message: buildWorkItemBranchNameMessage({
                        key,
                        title: input.intent.title,
                        body: input.intent.body,
                      }),
                      modelSelection,
                    })
                    .pipe(
                      Effect.map(({ branch: generatedBranch }) => generatedBranch),
                      Effect.catch(() => Effect.succeed(generatedBranchFallback)),
                    ));
            branch = ensureWorkItemBranchNameIncludesKey({
              branch: requestedBranch,
              fallback: generatedBranchFallback,
              key,
            });
            refName = input.intent.baseBranch ?? "HEAD";
            newRefName = branch;
          }
          title = input.intent.title.trim();
          origin = "issue";
          workItemProvider = input.intent.provider;
          workItemKey = key;
          workItemTitle = title;
          workItemState = input.intent.state ?? null;
          workItemStateName = input.intent.stateName ?? null;
          workItemUrl = input.intent.url ?? null;
          break;
        }
      }

      let worktreePath: string;
      if (preparedWorktreePath !== null) {
        if (isProjectRootPath(preparedWorktreePath, project.workspaceRoot)) {
          return yield* failGitWorkflow(operation, "Cannot create a worktree at the project root.");
        }
        worktreePath = preparedWorktreePath;
      } else {
        const targetPath = resolveWorktreeCheckoutPath({
          location: input.worktreeLocation,
          appWorktreesRoot: config.worktreesDir,
          projectId: input.projectId,
          workspaceRoot: project.workspaceRoot,
          projectMetadataDir: project.projectMetadataDir,
          branchName: branch,
        });
        if (isProjectRootPath(targetPath, project.workspaceRoot)) {
          return yield* failGitWorkflow(operation, "Cannot create a worktree at the project root.");
        }
        worktreePath = (yield* gitWorkflow.createWorktree({
          cwd: project.workspaceRoot,
          refName,
          ...(newRefName !== undefined ? { newRefName } : {}),
          path: targetPath,
        })).worktree.path;
        if (isProjectRootPath(worktreePath, project.workspaceRoot)) {
          return yield* failGitWorkflow(
            operation,
            "Refusing to register a worktree that resolved to the project root.",
          );
        }
        ownedWorktreePath = worktreePath;
        if (newRefName !== undefined) {
          ownedBranchName = newRefName;
        }
      }

      const cleanupOwnedCheckout = Effect.gen(function* () {
        if (ownedWorktreePath !== null) {
          yield* ignoreAlreadyMissingGitResource(
            gitWorkflow.removeWorktree({
              cwd: project.workspaceRoot,
              path: ownedWorktreePath,
              force: true,
            }),
            {
              operation,
              action: "remove-worktree",
              target: ownedWorktreePath,
            },
          );
        }
        if (ownedBranchName !== null) {
          yield* ignoreAlreadyMissingGitResource(
            gitWorkflow.deleteBranch({
              cwd: project.workspaceRoot,
              refName: ownedBranchName,
              force: true,
            }),
            {
              operation,
              action: "delete-branch",
              target: ownedBranchName,
            },
          );
        }
      }).pipe(
        Effect.catch((cleanupError) =>
          Effect.logWarning("failed to clean up worktree creation after dispatch failure", {
            operation,
            worktreePath: ownedWorktreePath,
            branch: ownedBranchName,
            detail: cleanupError.message,
          }).pipe(Effect.asVoid),
        ),
      );

      yield* Effect.gen(function* () {
        yield* dispatchWorktreeCommand(
          {
            type: "worktree.create",
            commandId: serverCommandId("worktree-create"),
            worktreeId,
            projectId: input.projectId,
            branch,
            worktreePath,
            origin,
            prNumber,
            issueNumber,
            prTitle,
            issueTitle,
            workItemProvider,
            workItemKey,
            workItemTitle,
            workItemState,
            workItemStateName,
            workItemUrl,
            createdAt: now,
          },
          operation,
        );

        if (origin === "pr" || issueNumber !== null) {
          yield* refreshWorktreeSourceControlState({ worktreeId }).pipe(
            Effect.ignoreCause({ log: true }),
            Effect.forkDetach,
            Effect.asVoid,
          );
        }

        if (existingThreadId !== undefined) {
          yield* dispatchWorktreeCommand(
            {
              type: "thread.meta.update",
              commandId: serverCommandId("worktree-thread-meta-update"),
              threadId,
              branch,
              worktreePath,
            },
            operation,
          );
        } else {
          if (modelSelection === null) {
            return yield* failGitWorkflow(
              operation,
              `Project ${input.projectId} has no default model selection.`,
            );
          }
          yield* dispatchWorktreeCommand(
            {
              type: "thread.create",
              commandId: serverCommandId("worktree-thread-create"),
              threadId,
              projectId: input.projectId,
              title,
              modelSelection,
              runtimeMode: "full-access",
              interactionMode: "default",
              branch,
              worktreePath,
              createdAt: now,
            },
            operation,
          );
        }

        yield* dispatchWorktreeCommand(
          {
            type: "thread.attach-to-worktree",
            commandId: serverCommandId("worktree-thread-attach"),
            threadId,
            worktreeId,
            attachedAt: now,
          },
          operation,
        );

        yield* launchSetupScriptForWorktreeInBackground({
          threadId,
          projectId: input.projectId,
          projectCwd: project.workspaceRoot,
          worktreePath,
        });
        yield* refreshGitStatus(worktreePath);
      }).pipe(
        Effect.catch((error) => cleanupOwnedCheckout.pipe(Effect.andThen(Effect.fail(error)))),
      );
      return { worktreeId, sessionId: threadId };
    });

  /**
   * Read-only resolution of the workspace an item action would run in.
   * Mirrors the send-time decision tree without any git mutations:
   * registered worktree → reuse; PR head branch at the project root →
   * local main checkout; otherwise → create.
   */
  const resolveActionWorkspace = (input: GitResolveActionWorkspaceInput) =>
    Effect.gen(function* () {
      const operation = "git.resolveActionWorkspace";
      const intent = input.intent;

      if (intent.kind === "pr" || intent.kind === "issue" || intent.kind === "workItem") {
        const existing =
          intent.kind === "workItem"
            ? yield* projectionWorktrees
                .findByWorkItem({
                  projectId: input.projectId,
                  provider: intent.provider,
                  key: intent.key,
                })
                .pipe(
                  Effect.mapError((cause) =>
                    toGitManagerError(operation, "Failed to find existing worktree.", cause),
                  ),
                )
            : yield* projectionWorktrees
                .findByOrigin({
                  projectId: input.projectId,
                  kind: intent.kind,
                  number: intent.number ?? 0,
                })
                .pipe(
                  Effect.mapError((cause) =>
                    toGitManagerError(operation, "Failed to find existing worktree.", cause),
                  ),
                );
        if (existing !== null) {
          const existingWorktree = yield* loadWorktreeForGitWorkflow(operation, existing);
          if (existingWorktree.worktreePath !== null && existingWorktree.archivedAt === null) {
            return {
              plan: {
                kind: "reuse-worktree" as const,
                worktreeId: existing,
                worktreePath: existingWorktree.worktreePath,
                branch: existingWorktree.branch,
              },
            };
          }
        }
      }

      if (intent.kind === "pr") {
        const project = yield* loadProjectForGitWorkflow(operation, input.projectId);
        const resolved = yield* gitWorkflow.resolvePullRequest({
          cwd: project.workspaceRoot,
          reference: String(intent.number ?? 0),
        });
        const headBranch = resolved.pullRequest.headBranch;
        const refs = yield* gitWorkflow
          .listRefs({ cwd: project.workspaceRoot, query: headBranch })
          .pipe(
            Effect.mapError((cause) =>
              toGitManagerError(operation, "Failed to list local refs.", cause),
            ),
          );
        const localHead = refs.refs.find((ref) => !ref.isRemote && ref.name === headBranch);
        const checkedOutAtRoot =
          localHead !== undefined &&
          (localHead.worktreePath !== null
            ? isProjectRootPath(localHead.worktreePath, project.workspaceRoot)
            : localHead.current);
        if (checkedOutAtRoot) {
          return {
            plan: { kind: "local-main-checkout" as const, branch: headBranch },
          };
        }
        return {
          plan: { kind: "create-worktree" as const, plannedBranch: headBranch },
        };
      }

      return { plan: { kind: "create-worktree" as const } };
    });

  const archiveWorktree = (input: {
    readonly worktreeId: WorktreeId;
    readonly deleteBranch: boolean;
  }) =>
    Effect.gen(function* () {
      const operation = "git.archiveWorktree";
      const worktree = yield* loadWorktreeForGitWorkflow(operation, input.worktreeId);
      if (worktree.origin === "main") {
        return yield* failGitWorkflow(operation, "Cannot archive the main worktree.");
      }
      const project = yield* loadProjectForGitWorkflow(operation, worktree.projectId);
      if (worktree.worktreePath !== null) {
        yield* ignoreAlreadyMissingGitResource(
          gitWorkflow.removeWorktree({
            cwd: project.workspaceRoot,
            path: worktree.worktreePath,
            force: true,
          }),
          {
            operation,
            action: "remove-worktree",
            target: worktree.worktreePath,
          },
        );
      }
      if (input.deleteBranch) {
        yield* ignoreAlreadyMissingGitResource(
          gitWorkflow.deleteBranch({
            cwd: project.workspaceRoot,
            refName: worktree.branch,
            force: true,
          }),
          {
            operation,
            action: "delete-branch",
            target: worktree.branch,
          },
        );
      }
      yield* dispatchWorktreeCommand(
        {
          type: "worktree.archive",
          commandId: serverCommandId("worktree-archive"),
          worktreeId: input.worktreeId,
          archivedAt: new Date().toISOString(),
          deletedBranch: input.deleteBranch,
        },
        operation,
      );
      yield* refreshGitStatus(project.workspaceRoot);
      return {};
    });

  const restoreWorktree = (worktreeId: WorktreeId) =>
    Effect.gen(function* () {
      const operation = "git.restoreWorktree";
      const worktree = yield* loadWorktreeForGitWorkflow(operation, worktreeId);
      const project = yield* loadProjectForGitWorkflow(operation, worktree.projectId);
      const created =
        worktree.origin === "main"
          ? null
          : yield* gitWorkflow.createWorktree({
              cwd: project.workspaceRoot,
              refName: worktree.branch,
              path: worktree.worktreePath,
            });
      const restoredPath = created?.worktree.path ?? worktree.worktreePath;
      yield* dispatchWorktreeCommand(
        {
          type: "worktree.restore",
          commandId: serverCommandId("worktree-restore"),
          worktreeId,
          worktreePath: restoredPath,
          restoredAt: new Date().toISOString(),
        },
        operation,
      );
      yield* refreshGitStatus(restoredPath ?? project.workspaceRoot);
      return {};
    });

  const deleteWorktree = (input: {
    readonly worktreeId: WorktreeId;
    readonly deleteBranch: boolean;
    readonly force?: boolean | undefined;
  }) =>
    Effect.gen(function* () {
      const operation = "git.deleteWorktree";
      const worktree = yield* loadWorktreeForGitWorkflow(operation, input.worktreeId);
      if (worktree.origin === "main") {
        return yield* failGitWorkflow(operation, "Cannot delete the main worktree.");
      }
      const project = yield* loadProjectForGitWorkflow(operation, worktree.projectId);
      if (
        worktree.worktreePath !== null &&
        isProjectRootPath(worktree.worktreePath, project.workspaceRoot)
      ) {
        return yield* failGitWorkflow(
          operation,
          "Cannot delete a worktree that points at the project root.",
        );
      }
      if (input.force) {
        if (worktree.worktreePath !== null) {
          if (existsSync(worktree.worktreePath)) {
            return yield* failGitWorkflow(
              operation,
              "Cannot force delete: the worktree path still exists on disk. Use a regular delete instead.",
            );
          }
          const registeredPaths = yield* gitWorkflow
            .listWorktreePaths(project.workspaceRoot)
            .pipe(
              Effect.mapError((cause) =>
                toGitManagerError(operation, "Failed to inspect git worktrees.", cause),
              ),
            );
          if (registeredPaths.includes(worktree.worktreePath)) {
            return yield* failGitWorkflow(
              operation,
              "Cannot force delete: git still tracks this worktree. Use a regular delete instead.",
            );
          }
        }
      } else if (worktree.worktreePath !== null) {
        if (existsSync(worktree.worktreePath)) {
          yield* ignoreAlreadyMissingGitResource(
            gitWorkflow.removeWorktree({
              cwd: project.workspaceRoot,
              path: worktree.worktreePath,
              force: true,
            }),
            {
              operation,
              action: "remove-worktree",
              target: worktree.worktreePath,
            },
          );
        }
      }
      if (input.deleteBranch) {
        yield* ignoreAlreadyMissingGitResource(
          gitWorkflow.deleteBranch({
            cwd: project.workspaceRoot,
            refName: worktree.branch,
            force: true,
          }),
          {
            operation,
            action: "delete-branch",
            target: worktree.branch,
          },
        );
      }
      yield* dispatchWorktreeCommand(
        {
          type: "worktree.delete",
          commandId: serverCommandId("worktree-delete"),
          worktreeId: input.worktreeId,
          deletedAt: new Date().toISOString(),
          deletedBranch: input.deleteBranch,
        },
        operation,
      );
      yield* refreshGitStatus(project.workspaceRoot);
      return {};
    });

  const initializeGitForProject = (projectId: ProjectId) =>
    Effect.gen(function* () {
      const operation = "projects.initializeGit";
      const project = yield* loadProjectForGitWorkflow(operation, projectId);
      yield* vcsProvisioning
        .initRepository({ cwd: project.workspaceRoot, kind: "git" })
        .pipe(
          Effect.mapError((cause) =>
            toGitManagerError(operation, "Failed to initialize git repository.", cause),
          ),
        );
      const status = yield* gitWorkflow.localStatus({ cwd: project.workspaceRoot });
      const branch = status.refName ?? "main";
      const worktreeId = WorktreeId.make(`worktree-${projectId}-main`);
      const now = new Date().toISOString();
      yield* dispatchWorktreeCommand(
        {
          type: "worktree.create",
          commandId: serverCommandId("project-main-worktree-create"),
          worktreeId,
          projectId,
          branch,
          worktreePath: null,
          origin: "main",
          prNumber: null,
          issueNumber: null,
          prTitle: null,
          issueTitle: null,
          createdAt: now,
        },
        operation,
      );
      const snapshot = yield* projectionSnapshotQuery
        .getShellSnapshot()
        .pipe(
          Effect.mapError((cause) =>
            toGitManagerError(operation, "Failed to load project threads.", cause),
          ),
        );
      for (const thread of snapshot.threads) {
        if (thread.projectId !== projectId) continue;
        yield* dispatchWorktreeCommand(
          {
            type: "thread.attach-to-worktree",
            commandId: serverCommandId("project-main-thread-attach"),
            threadId: thread.id,
            worktreeId,
            attachedAt: now,
          },
          operation,
        );
      }
      yield* refreshGitStatus(project.workspaceRoot);
      return {};
    });

  return {
    dispatchWorktreeCommand,
    createWorktreeForProject,
    resolveActionWorkspace,
    archiveWorktree,
    restoreWorktree,
    deleteWorktree,
    initializeGitForProject,
  };
};
