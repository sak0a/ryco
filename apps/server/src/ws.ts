import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";

import { Cause, Duration, Effect, Layer, Option, Queue, Ref, Schema, Stream } from "effect";
import {
  type AuthAccessStreamEvent,
  AuthSessionId,
  CommandId,
  EventId,
  type GitCreateWorktreeForProjectInput,
  type GitRunStackedActionInput,
  type OrchestrationCommand,
  type GitActionProgressEvent,
  type GitManagerServiceError,
  OrchestrationDispatchCommandError,
  type OrchestrationEvent,
  type OrchestrationShellSnapshot,
  type OrchestrationShellStreamEvent,
  OrchestrationGetFullThreadDiffError,
  OrchestrationGetSnapshotError,
  OrchestrationGetTurnDiffError,
  ORCHESTRATION_WS_METHODS,
  GitManagerError,
  ProjectId,
  ProjectListEntriesError,
  ProjectReadFileError,
  ProjectSearchEntriesError,
  ProjectStageFileReferenceError,
  ProjectWriteFileError,
  OrchestrationReplayEventsError,
  OpinionatedPluginError,
  FilesystemBrowseError,
  TextGenerationError,
  ThreadId,
  type OrchestrationThreadDetailSnapshot,
  type TerminalEvent,
  WorktreeId,
  WS_METHODS,
  WsRpcGroup,
  SourceControlProviderError,
} from "@ryco/contracts";
import { buildTemporaryWorktreeBranchName } from "@ryco/shared/git";
import { clamp } from "effect/Number";
import { HttpRouter, HttpServerRequest } from "effect/unstable/http";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";

import { CheckpointDiffQuery } from "./checkpointing/Services/CheckpointDiffQuery.ts";
import { ServerConfig } from "./config.ts";
import { Keybindings } from "./keybindings.ts";
import { makeCodexMcpService } from "./mcp/CodexMcpService.ts";
import { Open, resolveAvailableEditors } from "./open.ts";
import {
  checkOpinionatedPlugins,
  installOpinionatedPlugin,
  listOpinionatedPlugins,
} from "./opinionatedPlugins.ts";
import { normalizeDispatchCommand } from "./orchestration/Normalizer.ts";
import { OrchestrationEngineService } from "./orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "./orchestration/Services/ProjectionSnapshotQuery.ts";
import {
  observeRpcEffect,
  observeRpcStream,
  observeRpcStreamEffect,
} from "./observability/RpcInstrumentation.ts";
import {
  isServerPerfProfileEnabled,
  recordServerPerfPayload,
} from "./observability/PerfInstrumentation.ts";
import { ProviderRegistry } from "./provider/Services/ProviderRegistry.ts";
import * as ProviderMaintenanceRunner from "./provider/providerMaintenanceRunner.ts";
import { ServerLifecycleEvents } from "./serverLifecycleEvents.ts";
import { ServerRuntimeStartup } from "./serverRuntimeStartup.ts";
import { redactServerSettingsForClient, ServerSettingsService } from "./serverSettings.ts";
import { TerminalManager } from "./terminal/Services/Manager.ts";
import { TextGeneration } from "./textGeneration/TextGeneration.ts";
import { WorkspaceEntries } from "./workspace/Services/WorkspaceEntries.ts";
import { WorkspaceFileSystem } from "./workspace/Services/WorkspaceFileSystem.ts";
import { WorkspacePathOutsideRootError } from "./workspace/Services/WorkspacePaths.ts";
import { VcsStatusBroadcaster } from "./vcs/VcsStatusBroadcaster.ts";
import { VcsProvisioningService } from "./vcs/VcsProvisioningService.ts";
import { GitWorkflowService } from "./git/GitWorkflowService.ts";
import { ProjectSetupScriptRunner } from "./project/Services/ProjectSetupScriptRunner.ts";
import { RepositoryIdentityResolver } from "./project/Services/RepositoryIdentityResolver.ts";
import { resolveProjectWorktreesDir } from "./project/projectMetadataPaths.ts";
import { resolveWorktreeCheckoutPath } from "./project/worktreeCheckoutPaths.ts";
import { ServerEnvironment } from "./environment/Services/ServerEnvironment.ts";
import { ServerAuth, type AuthenticatedSession } from "./auth/Services/ServerAuth.ts";
import { ServerSecretStoreLive } from "./auth/Layers/ServerSecretStore.ts";
import { AtlassianConnectionRepositoryLive } from "./persistence/Layers/AtlassianConnections.ts";
import { layerConfig as SqlitePersistenceLayerLive } from "./persistence/Layers/Sqlite.ts";
import { ProjectionWorktreeRepository } from "./persistence/Services/ProjectionWorktrees.ts";
import { refreshWorktreeSourceControlState } from "./sourceControl/refreshWorktreeSourceControlState.ts";
import * as SourceControlDiscoveryLayer from "./sourceControl/SourceControlDiscovery.ts";
import { SourceControlRepositoryService } from "./sourceControl/SourceControlRepositoryService.ts";
import type { SourceControlProviderShape } from "./sourceControl/SourceControlProvider.ts";
import * as AzureDevOpsCli from "./sourceControl/AzureDevOpsCli.ts";
import * as BitbucketApi from "./sourceControl/BitbucketApi.ts";
import * as ForgejoApi from "./sourceControl/ForgejoApi.ts";
import * as GitHubCli from "./sourceControl/GitHubCli.ts";
import * as GitLabCli from "./sourceControl/GitLabCli.ts";
import * as SourceControlProviderRegistry from "./sourceControl/SourceControlProviderRegistry.ts";
import * as GitVcsDriver from "./vcs/GitVcsDriver.ts";
import * as VcsDriverRegistry from "./vcs/VcsDriverRegistry.ts";
import * as VcsProjectConfig from "./vcs/VcsProjectConfig.ts";
import * as VcsProcess from "./vcs/VcsProcess.ts";
import {
  BootstrapCredentialService,
  type BootstrapCredentialChange,
} from "./auth/Services/BootstrapCredentialService.ts";
import {
  SessionCredentialService,
  type SessionCredentialChange,
} from "./auth/Services/SessionCredentialService.ts";
import { respondToAuthError } from "./auth/http.ts";
import { authorizeWsRpc, type WsRpcAccess } from "./auth/wsAuthorization.ts";
import { AtlassianConnectionService } from "./atlassian/AtlassianConnectionService.ts";
import { JiraWorkItemService } from "./atlassian/JiraWorkItemService.ts";
import { makeWsReplayMetrics } from "./wsReplayMetrics.ts";

function isThreadDetailEvent(event: OrchestrationEvent): event is Extract<
  OrchestrationEvent,
  {
    type:
      | "thread.message-sent"
      | "thread.proposed-plan-upserted"
      | "thread.activity-appended"
      | "thread.turn-diff-completed"
      | "thread.reverted"
      | "thread.session-set";
  }
> {
  return (
    event.type === "thread.message-sent" ||
    event.type === "thread.proposed-plan-upserted" ||
    event.type === "thread.activity-appended" ||
    event.type === "thread.turn-diff-completed" ||
    event.type === "thread.reverted" ||
    event.type === "thread.session-set"
  );
}

const PROVIDER_STATUS_DEBOUNCE_MS = 200;
const SOURCE_CONTROL_LINKED_REFRESH_DEBOUNCE_MS = 5_000;
const ORCHESTRATION_REPLAY_PAGE_MAX_LIMIT = 1_000;
const randomShortId = (length = 8) =>
  Array.from({ length }, () =>
    "abcdefghijklmnopqrstuvwxyz0123456789".charAt(Math.floor(Math.random() * 36)),
  ).join("");
const deterministicShortId = (input: string, length = 6): string =>
  createHash("sha256").update(input).digest("hex").slice(0, length);

const buildIssueBranchNameFallback = (number: number): string =>
  `issue/${number}-${deterministicShortId(String(number), 6)}`;

const branchSlug = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 48);

const buildWorkItemBranchNameFallback = (input: { key: string; title?: string }): string => {
  const key = input.key.trim().toUpperCase();
  const titleSlug = branchSlug(input.title ?? "");
  return titleSlug.length > 0 ? `${key}-${titleSlug}` : `${key}-${deterministicShortId(key, 6)}`;
};

const ensureWorkItemBranchNameIncludesKey = (input: {
  readonly branch: string;
  readonly fallback: string;
  readonly key: string;
}): string => {
  const branch = input.branch.trim();
  if (!branch) return input.fallback;
  const normalizedBranch = branch.toLowerCase();
  const normalizedKey = input.key.toLowerCase();
  return normalizedBranch.includes(normalizedKey) ? branch : `${input.key}-${branch}`;
};

const buildIssueBranchNameMessage = (input: {
  readonly number: number;
  readonly title?: string | undefined;
  readonly body?: string | undefined;
}): string => {
  const lines = [`Create a branch name for issue #${input.number}.`];
  const title = input.title?.trim();
  const body = input.body?.trim();
  if (title) {
    lines.push("", `Title: ${title}`);
  }
  if (body) {
    lines.push("", `Body: ${body}`);
  }
  return lines.join("\n");
};

const buildWorkItemBranchNameMessage = (input: {
  readonly key: string;
  readonly title?: string | undefined;
  readonly body?: string | undefined;
}): string => {
  const lines = [`Create a branch name for Jira work item ${input.key}.`];
  const title = input.title?.trim();
  const body = input.body?.trim();
  if (title) {
    lines.push("", `Title: ${title}`);
  }
  if (body) {
    lines.push("", `Body: ${body}`);
  }
  lines.push("", `The branch name should include the Jira key ${input.key}.`);
  return lines.join("\n");
};

function gitErrorText(error: GitManagerServiceError): string {
  const detail = "detail" in error ? error.detail : "";
  return `${error.message}\n${detail}`.toLowerCase();
}

function isAlreadyMissingGitResourceError(error: GitManagerServiceError): boolean {
  const text = gitErrorText(error);
  if (text.includes("command not found")) {
    return false;
  }
  return (
    text.includes("not found") ||
    text.includes("does not exist") ||
    text.includes("no such branch") ||
    text.includes("not a working tree") ||
    text.includes("is not a valid working tree")
  );
}

function toOpinionatedPluginRpcError(cause: unknown): OpinionatedPluginError {
  if (Schema.is(OpinionatedPluginError)(cause)) {
    return cause;
  }
  return new OpinionatedPluginError({
    detail: cause instanceof Error ? cause.message : "Opinionated plugin operation failed.",
    ...(cause !== undefined ? { cause } : {}),
  });
}

const ignoreAlreadyMissingGitResource = (
  effect: Effect.Effect<void, GitManagerServiceError>,
  context: {
    readonly operation: string;
    readonly action: "remove-worktree" | "delete-branch";
    readonly target: string;
  },
): Effect.Effect<void, GitManagerServiceError> =>
  effect.pipe(
    Effect.catch((error) =>
      isAlreadyMissingGitResourceError(error)
        ? Effect.logWarning("ignored missing git resource during worktree cleanup", {
            ...context,
            error: error.message,
          }).pipe(Effect.asVoid)
        : Effect.fail(error),
    ),
  );

function toAuthAccessStreamEvent(
  change: BootstrapCredentialChange | SessionCredentialChange,
  revision: number,
  currentSessionId: AuthSessionId,
): AuthAccessStreamEvent {
  switch (change.type) {
    case "pairingLinkUpserted":
      return {
        version: 1,
        revision,
        type: "pairingLinkUpserted",
        payload: change.pairingLink,
      };
    case "pairingLinkRemoved":
      return {
        version: 1,
        revision,
        type: "pairingLinkRemoved",
        payload: { id: change.id },
      };
    case "clientUpserted":
      return {
        version: 1,
        revision,
        type: "clientUpserted",
        payload: {
          ...change.clientSession,
          current: change.clientSession.sessionId === currentSessionId,
        },
      };
    case "clientRemoved":
      return {
        version: 1,
        revision,
        type: "clientRemoved",
        payload: { sessionId: change.sessionId },
      };
  }
}

const makeWsRpcLayer = (session: AuthenticatedSession) =>
  WsRpcGroup.toLayer(
    Effect.gen(function* () {
      const currentSessionId = session.sessionId;
      const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
      const orchestrationEngine = yield* OrchestrationEngineService;
      const checkpointDiffQuery = yield* CheckpointDiffQuery;
      const keybindings = yield* Keybindings;
      const open = yield* Open;
      const gitWorkflow = yield* GitWorkflowService;
      const vcsProvisioning = yield* VcsProvisioningService;
      const vcsStatusBroadcaster = yield* VcsStatusBroadcaster;
      const terminalManager = yield* TerminalManager;
      const providerRegistry = yield* ProviderRegistry;
      const providerMaintenanceRunner = yield* ProviderMaintenanceRunner.ProviderMaintenanceRunner;
      const config = yield* ServerConfig;
      const lifecycleEvents = yield* ServerLifecycleEvents;
      const serverSettings = yield* ServerSettingsService;
      const codexMcp = yield* makeCodexMcpService;
      const startup = yield* ServerRuntimeStartup;
      const workspaceEntries = yield* WorkspaceEntries;
      const workspaceFileSystem = yield* WorkspaceFileSystem;
      const projectSetupScriptRunner = yield* ProjectSetupScriptRunner;
      const repositoryIdentityResolver = yield* RepositoryIdentityResolver;
      const serverEnvironment = yield* ServerEnvironment;
      const serverAuth = yield* ServerAuth;
      const sourceControlDiscovery = yield* SourceControlDiscoveryLayer.SourceControlDiscovery;
      const sourceControlRepositories = yield* SourceControlRepositoryService;
      const sourceControlRegistry =
        yield* SourceControlProviderRegistry.SourceControlProviderRegistry;
      const textGeneration = yield* TextGeneration;
      const bootstrapCredentials = yield* BootstrapCredentialService;
      const sessions = yield* SessionCredentialService;
      const projectionWorktrees = yield* ProjectionWorktreeRepository;
      const atlassian = yield* AtlassianConnectionService;
      const workItems = yield* JiraWorkItemService;
      const serverCommandId = (tag: string) =>
        CommandId.make(`server:${tag}:${crypto.randomUUID()}`);
      const linkedSourceControlRefreshAtByProject = new Map<string, number>();

      const authorize = (access: WsRpcAccess, method: string) =>
        authorizeWsRpc(session, access, method);

      const withAccess = <A, E, R>(
        access: WsRpcAccess,
        method: string,
        effect: Effect.Effect<A, E, R>,
      ) => authorize(access, method).pipe(Effect.andThen(effect));

      const ownerEffect = <A, E, R>(method: string, effect: Effect.Effect<A, E, R>) =>
        withAccess("owner", method, effect);

      const refreshLinkedWorktreeSourceControlStates = (input: {
        readonly cwd: string;
        readonly reason: string;
      }) =>
        Effect.gen(function* () {
          const projectOpt = yield* projectionSnapshotQuery
            .getActiveProjectByWorkspaceRoot(input.cwd)
            .pipe(Effect.catch(() => Effect.succeed(Option.none())));
          if (Option.isNone(projectOpt)) return;

          const project = projectOpt.value;
          const key = `${project.id}:${input.cwd}`;
          const now = Date.now();
          const lastRefreshAt = linkedSourceControlRefreshAtByProject.get(key) ?? 0;
          if (now - lastRefreshAt < SOURCE_CONTROL_LINKED_REFRESH_DEBOUNCE_MS) {
            return;
          }
          linkedSourceControlRefreshAtByProject.set(key, now);

          const worktrees = yield* projectionWorktrees
            .listByProjectId({ projectId: project.id })
            .pipe(Effect.catch(() => Effect.succeed([])));
          for (const worktree of worktrees) {
            if (worktree.archivedAt !== null) continue;
            if (worktree.prNumber === null && worktree.issueNumber === null) continue;
            yield* refreshWorktreeSourceControlState({ worktreeId: worktree.worktreeId }).pipe(
              Effect.ignoreCause({ log: true }),
              Effect.forkDetach,
            );
          }
        }).pipe(Effect.ignoreCause({ log: true }), Effect.asVoid);

      const refreshStateForLinkedReference = (input: {
        readonly cwd: string;
        readonly kind: "pr" | "issue";
        readonly reference: string;
      }) =>
        Effect.gen(function* () {
          const parsed = Number.parseInt(input.reference, 10);
          if (!Number.isInteger(parsed) || parsed <= 0) return;
          const projectOpt = yield* projectionSnapshotQuery
            .getActiveProjectByWorkspaceRoot(input.cwd)
            .pipe(Effect.catch(() => Effect.succeed(Option.none())));
          if (Option.isNone(projectOpt)) return;
          const linked = yield* projectionWorktrees.findActiveByLinkedNumber({
            projectId: projectOpt.value.id,
            kind: input.kind,
            number: parsed,
          });
          for (const worktreeId of linked) {
            yield* refreshWorktreeSourceControlState({ worktreeId }).pipe(
              Effect.ignoreCause({ log: true }),
              Effect.forkDetach,
            );
          }
        }).pipe(Effect.ignoreCause({ log: true }), Effect.asVoid);

      const attachLinkedIssuesToPrAction = (
        input: GitRunStackedActionInput,
      ): Effect.Effect<GitRunStackedActionInput> => {
        if (
          input.worktreeId === undefined ||
          (input.action !== "create_pr" && input.action !== "commit_push_pr")
        ) {
          return Effect.succeed(input);
        }

        return projectionWorktrees.getById({ worktreeId: input.worktreeId }).pipe(
          Effect.map((worktreeOpt) => {
            if (Option.isNone(worktreeOpt)) return input;
            const issueNumber = worktreeOpt.value.issueNumber;
            if (issueNumber === null) return input;
            return {
              ...input,
              linkedIssueNumbers: [...new Set([...(input.linkedIssueNumbers ?? []), issueNumber])],
            };
          }),
          Effect.catch(() => Effect.succeed(input)),
        );
      };

      const ownerStreamEffect = <A, E, R>(
        method: string,
        effect: Effect.Effect<Stream.Stream<A, E, R>, E, R>,
      ) => withAccess("owner", method, effect);

      const ownerStream = <A, E, R>(method: string, stream: Stream.Stream<A, E, R>) =>
        Stream.unwrap(authorize("owner", method).pipe(Effect.as(stream)));

      const loadAuthAccessSnapshot = () =>
        Effect.all({
          pairingLinks: serverAuth.listPairingLinks().pipe(Effect.orDie),
          clientSessions: serverAuth.listClientSessions(currentSessionId).pipe(Effect.orDie),
        });

      const appendSetupScriptActivity = (input: {
        readonly threadId: ThreadId;
        readonly kind: "setup-script.requested" | "setup-script.started" | "setup-script.failed";
        readonly summary: string;
        readonly createdAt: string;
        readonly payload: Record<string, unknown>;
        readonly tone: "info" | "error";
      }) =>
        orchestrationEngine.dispatch({
          type: "thread.activity.append",
          commandId: serverCommandId("setup-script-activity"),
          threadId: input.threadId,
          activity: {
            id: EventId.make(crypto.randomUUID()),
            tone: input.tone,
            kind: input.kind,
            summary: input.summary,
            payload: input.payload,
            turnId: null,
            createdAt: input.createdAt,
          },
          createdAt: input.createdAt,
        });

      const toDispatchCommandError = (cause: unknown, fallbackMessage: string) =>
        Schema.is(OrchestrationDispatchCommandError)(cause)
          ? cause
          : new OrchestrationDispatchCommandError({
              message: cause instanceof Error ? cause.message : fallbackMessage,
              cause,
            });

      const toBootstrapDispatchCommandCauseError = (cause: Cause.Cause<unknown>) => {
        const error = Cause.squash(cause);
        return Schema.is(OrchestrationDispatchCommandError)(error)
          ? error
          : new OrchestrationDispatchCommandError({
              message:
                error instanceof Error ? error.message : "Failed to bootstrap thread turn start.",
              cause,
            });
      };

      const enrichProjectEvent = (
        event: OrchestrationEvent,
      ): Effect.Effect<OrchestrationEvent, never, never> => {
        switch (event.type) {
          case "project.created":
            return repositoryIdentityResolver.resolve(event.payload.workspaceRoot).pipe(
              Effect.map((repositoryIdentity) => ({
                ...event,
                payload: {
                  ...event.payload,
                  repositoryIdentity,
                },
              })),
            );
          case "project.meta-updated":
            return Effect.gen(function* () {
              const workspaceRoot =
                event.payload.workspaceRoot ??
                Option.match(
                  yield* projectionSnapshotQuery.getProjectShellById(event.payload.projectId),
                  {
                    onNone: () => null,
                    onSome: (project) => project.workspaceRoot,
                  },
                ) ??
                null;
              if (workspaceRoot === null) {
                return event;
              }

              const repositoryIdentity = yield* repositoryIdentityResolver.resolve(workspaceRoot);
              return {
                ...event,
                payload: {
                  ...event.payload,
                  repositoryIdentity,
                },
              } satisfies OrchestrationEvent;
            }).pipe(Effect.catch(() => Effect.succeed(event)));
          default:
            return Effect.succeed(event);
        }
      };

      const enrichOrchestrationEvents = (events: ReadonlyArray<OrchestrationEvent>) =>
        Effect.forEach(events, enrichProjectEvent, { concurrency: 4 });

      const toShellStreamEvent = (
        event: OrchestrationEvent,
      ): Effect.Effect<Option.Option<OrchestrationShellStreamEvent>, never, never> => {
        switch (event.type) {
          case "project.created":
          case "project.meta-updated":
            return projectionSnapshotQuery.getProjectShellById(event.payload.projectId).pipe(
              Effect.map((project) =>
                Option.map(project, (nextProject) => ({
                  kind: "project-upserted" as const,
                  sequence: event.sequence,
                  project: nextProject,
                })),
              ),
              Effect.catch(() => Effect.succeed(Option.none())),
            );
          case "project.deleted":
            return Effect.succeed(
              Option.some({
                kind: "project-removed" as const,
                sequence: event.sequence,
                projectId: event.payload.projectId,
              }),
            );
          case "thread.deleted":
            return Effect.succeed(
              Option.some({
                kind: "thread-removed" as const,
                sequence: event.sequence,
                threadId: event.payload.threadId,
              }),
            );
          case "worktree.created":
          case "worktree.archived":
          case "worktree.metaUpdated":
          case "worktree.restored": {
            const getWorktreeShellById = projectionSnapshotQuery.getWorktreeShellById;
            if (getWorktreeShellById === undefined) {
              return Effect.succeed(Option.none());
            }
            return getWorktreeShellById(WorktreeId.make(event.payload.worktreeId)).pipe(
              Effect.map((worktree) =>
                Option.map(worktree, (nextWorktree) => ({
                  kind: "worktree-upserted" as const,
                  sequence: event.sequence,
                  worktree: nextWorktree,
                })),
              ),
              Effect.catch(() => Effect.succeed(Option.none())),
            );
          }
          case "worktree.deleted":
            return Effect.succeed(
              Option.some({
                kind: "worktree-removed" as const,
                sequence: event.sequence,
                worktreeId: event.payload.worktreeId,
              }),
            );
          default:
            if (event.aggregateKind !== "thread") {
              return Effect.succeed(Option.none());
            }
            return projectionSnapshotQuery
              .getThreadShellById(ThreadId.make(event.aggregateId))
              .pipe(
                Effect.map((thread) =>
                  Option.map(thread, (nextThread) => ({
                    kind: "thread-upserted" as const,
                    sequence: event.sequence,
                    thread: nextThread,
                  })),
                ),
                Effect.catch(() => Effect.succeed(Option.none())),
              );
        }
      };

      const dedupeBySequence =
        <A>(getSequence: (item: A) => number, sequenceRef: Ref.Ref<number>) =>
        <E, R>(stream: Stream.Stream<A, E, R>): Stream.Stream<A, E, R> =>
          stream.pipe(
            Stream.filterEffect((item) =>
              Ref.modify(sequenceRef, (lastSequence) => {
                const nextSequence = getSequence(item);
                if (nextSequence <= lastSequence) {
                  return [false, lastSequence] as const;
                }
                return [true, nextSequence] as const;
              }),
            ),
          );

      const makeReplayBoundaryTracker = (snapshotSequence: number) =>
        Effect.gen(function* () {
          const latestLiveSequence = yield* Ref.make(snapshotSequence);
          const replayUpperBound = yield* Ref.make<Option.Option<number>>(Option.none());

          const captureReplayUpperBound = Effect.gen(function* () {
            const existingUpperBound = yield* Ref.get(replayUpperBound);
            if (Option.isSome(existingUpperBound)) {
              return existingUpperBound;
            }

            const latestSequence = yield* Ref.get(latestLiveSequence);
            if (latestSequence <= snapshotSequence) {
              return Option.none<number>();
            }

            const upperBound = Option.some(latestSequence);
            yield* Ref.set(replayUpperBound, upperBound);
            return upperBound;
          });

          return {
            recordLiveSequence: (sequence: number) =>
              Ref.update(latestLiveSequence, (current) => Math.max(current, sequence)),
            captureReplayUpperBound,
          };
        });

      const makeBoundedReplayStream = (input: {
        readonly snapshotSequence: number;
        readonly captureReplayUpperBound: Effect.Effect<Option.Option<number>>;
        readonly errorMessage: string;
      }): Stream.Stream<OrchestrationEvent, OrchestrationGetSnapshotError> => {
        const readPage = (
          fromSequenceExclusive: number,
        ): Stream.Stream<OrchestrationEvent, OrchestrationGetSnapshotError> =>
          Stream.unwrap(
            Effect.gen(function* () {
              const upperBoundBeforeRead = yield* input.captureReplayUpperBound;
              if (
                Option.isSome(upperBoundBeforeRead) &&
                fromSequenceExclusive >= upperBoundBeforeRead.value
              ) {
                return Stream.empty;
              }

              const page = yield* orchestrationEngine
                .readEventsPage(fromSequenceExclusive, ORCHESTRATION_REPLAY_PAGE_MAX_LIMIT)
                .pipe(
                  Effect.mapError(
                    (cause) =>
                      new OrchestrationGetSnapshotError({
                        message: input.errorMessage,
                        cause,
                      }),
                  ),
                );
              const upperBound = Option.isSome(upperBoundBeforeRead)
                ? upperBoundBeforeRead
                : yield* input.captureReplayUpperBound;
              const replayEvents = Option.isSome(upperBound)
                ? page.events.filter((event) => event.sequence <= upperBound.value)
                : page.events;

              if (replayEvents.length === 0) {
                return Stream.empty;
              }

              const nextSequence =
                replayEvents[replayEvents.length - 1]?.sequence ?? page.nextSequence;
              const reachedUpperBound =
                Option.isSome(upperBound) && nextSequence >= upperBound.value;
              const reachedReplayEnd = !page.hasMore || page.nextSequence <= fromSequenceExclusive;
              const currentPageStream = Stream.fromIterable(replayEvents);
              return reachedUpperBound || reachedReplayEnd
                ? currentPageStream
                : Stream.concat(currentPageStream, readPage(page.nextSequence));
            }),
          );

        return readPage(input.snapshotSequence);
      };

      const shellEventsFromDomainEvents = <E, R>(
        stream: Stream.Stream<OrchestrationEvent, E, R>,
      ): Stream.Stream<OrchestrationShellStreamEvent, E, R> =>
        stream.pipe(
          Stream.mapEffect(toShellStreamEvent),
          Stream.flatMap((event) =>
            Option.isSome(event) ? Stream.succeed(event.value) : Stream.empty,
          ),
        );

      const makeReplayableShellStream = (
        snapshot: Effect.Effect<OrchestrationShellSnapshot, OrchestrationGetSnapshotError>,
      ) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const loadedSnapshot = yield* snapshot;
            const snapshotSequence = loadedSnapshot.snapshotSequence;
            const liveSubscription = yield* orchestrationEngine.subscribeDomainEvents;
            const liveQueue = yield* Queue.unbounded<OrchestrationEvent>();
            const lastSequenceRef = yield* Ref.make(snapshotSequence);
            const replayBoundary = yield* makeReplayBoundaryTracker(snapshotSequence);
            const replayMetrics = yield* makeWsReplayMetrics({
              stream: "shell",
              subscriptionId: randomShortId(),
              snapshotSequence,
            });

            yield* Stream.fromSubscription(liveSubscription).pipe(
              Stream.runForEach((event) =>
                Effect.gen(function* () {
                  yield* replayBoundary.recordLiveSequence(event.sequence);
                  yield* Queue.offer(liveQueue, event);
                  yield* replayMetrics.recordLiveEnqueued(event.sequence);
                }),
              ),
              Effect.ensuring(Queue.shutdown(liveQueue)),
              Effect.ignoreCause({ log: true }),
              Effect.forkScoped,
            );

            const replayStream = makeBoundedReplayStream({
              snapshotSequence,
              captureReplayUpperBound: replayBoundary.captureReplayUpperBound,
              errorMessage: "Failed to replay orchestration shell events",
            }).pipe(Stream.tap((event) => replayMetrics.recordReplayEvent(event.sequence)));
            const liveStream = Stream.fromQueue(liveQueue).pipe(
              Stream.tap((event) => replayMetrics.recordLiveDequeued(event.sequence)),
            );

            const eventStream = Stream.concat(
              shellEventsFromDomainEvents(replayStream),
              shellEventsFromDomainEvents(liveStream),
            ).pipe(dedupeBySequence((event) => event.sequence, lastSequenceRef));

            return Stream.concat(
              Stream.make({
                kind: "snapshot" as const,
                snapshot: loadedSnapshot,
              }),
              eventStream,
            ).pipe(Stream.ensuring(replayMetrics.reset));
          }),
        );

      const makeReplayableThreadStream = (
        snapshot: Effect.Effect<OrchestrationThreadDetailSnapshot, OrchestrationGetSnapshotError>,
        threadId: ThreadId,
      ) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const loadedSnapshot = yield* snapshot;
            const snapshotSequence = loadedSnapshot.snapshotSequence;
            const liveSubscription = yield* orchestrationEngine.subscribeDomainEvents;
            const liveQueue = yield* Queue.unbounded<OrchestrationEvent>();
            const lastSequenceRef = yield* Ref.make(snapshotSequence);
            const replayBoundary = yield* makeReplayBoundaryTracker(snapshotSequence);
            const replayMetrics = yield* makeWsReplayMetrics({
              stream: "thread",
              subscriptionId: randomShortId(),
              snapshotSequence,
            });

            const threadEvents = <E, R>(stream: Stream.Stream<OrchestrationEvent, E, R>) =>
              stream.pipe(
                Stream.filter(
                  (event) =>
                    event.aggregateKind === "thread" &&
                    event.aggregateId === threadId &&
                    isThreadDetailEvent(event),
                ),
                Stream.map((event) => ({
                  kind: "event" as const,
                  event,
                })),
              );

            yield* Stream.fromSubscription(liveSubscription).pipe(
              Stream.runForEach((event) =>
                Effect.gen(function* () {
                  yield* replayBoundary.recordLiveSequence(event.sequence);
                  yield* Queue.offer(liveQueue, event);
                  yield* replayMetrics.recordLiveEnqueued(event.sequence);
                }),
              ),
              Effect.ensuring(Queue.shutdown(liveQueue)),
              Effect.ignoreCause({ log: true }),
              Effect.forkScoped,
            );

            const replayStream = makeBoundedReplayStream({
              snapshotSequence,
              captureReplayUpperBound: replayBoundary.captureReplayUpperBound,
              errorMessage: "Failed to replay orchestration thread events",
            }).pipe(Stream.tap((event) => replayMetrics.recordReplayEvent(event.sequence)));
            const liveStream = Stream.fromQueue(liveQueue).pipe(
              Stream.tap((event) => replayMetrics.recordLiveDequeued(event.sequence)),
            );

            const eventStream = Stream.concat(
              threadEvents(replayStream),
              threadEvents(liveStream),
            ).pipe(dedupeBySequence((item) => item.event.sequence, lastSequenceRef));

            return Stream.concat(
              Stream.make({
                kind: "snapshot" as const,
                snapshot: loadedSnapshot,
              }),
              eventStream,
            ).pipe(Stream.ensuring(replayMetrics.reset));
          }),
        );

      const dispatchBootstrapTurnStart = (
        command: Extract<OrchestrationCommand, { type: "thread.turn.start" }>,
      ): Effect.Effect<{ readonly sequence: number }, OrchestrationDispatchCommandError> =>
        Effect.gen(function* () {
          const bootstrap = command.bootstrap;
          const { bootstrap: _bootstrap, ...finalTurnStartCommand } = command;
          let createdThread = false;
          let targetProjectId = bootstrap?.createThread?.projectId;
          let targetProjectCwd = bootstrap?.prepareWorktree?.projectCwd;
          let targetWorktreePath = bootstrap?.createThread?.worktreePath ?? null;

          const cleanupCreatedThread = () =>
            createdThread
              ? orchestrationEngine
                  .dispatch({
                    type: "thread.delete",
                    commandId: serverCommandId("bootstrap-thread-delete"),
                    threadId: command.threadId,
                  })
                  .pipe(Effect.ignoreCause({ log: true }))
              : Effect.void;

          const recordSetupScriptLaunchFailure = (input: {
            readonly error: unknown;
            readonly requestedAt: string;
            readonly worktreePath: string;
          }) => {
            const detail =
              input.error instanceof Error ? input.error.message : "Unknown setup failure.";
            return appendSetupScriptActivity({
              threadId: command.threadId,
              kind: "setup-script.failed",
              summary: "Setup script failed to start",
              createdAt: input.requestedAt,
              payload: {
                detail,
                worktreePath: input.worktreePath,
              },
              tone: "error",
            }).pipe(
              Effect.ignoreCause({ log: false }),
              Effect.flatMap(() =>
                Effect.logWarning("bootstrap turn start failed to launch setup script", {
                  threadId: command.threadId,
                  worktreePath: input.worktreePath,
                  detail,
                }),
              ),
            );
          };

          const recordSetupScriptStarted = (input: {
            readonly requestedAt: string;
            readonly worktreePath: string;
            readonly scriptId: string;
            readonly scriptName: string;
            readonly terminalId: string;
          }) => {
            const payload = {
              scriptId: input.scriptId,
              scriptName: input.scriptName,
              terminalId: input.terminalId,
              worktreePath: input.worktreePath,
            };
            return Effect.all([
              appendSetupScriptActivity({
                threadId: command.threadId,
                kind: "setup-script.requested",
                summary: "Starting setup script",
                createdAt: input.requestedAt,
                payload,
                tone: "info",
              }),
              appendSetupScriptActivity({
                threadId: command.threadId,
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
                  "bootstrap turn start launched setup script but failed to record setup activity",
                  {
                    threadId: command.threadId,
                    worktreePath: input.worktreePath,
                    scriptId: input.scriptId,
                    terminalId: input.terminalId,
                    detail: error.message,
                  },
                ),
              ),
            );
          };

          const runSetupProgram = () =>
            bootstrap?.runSetupScript && targetWorktreePath
              ? (() => {
                  const worktreePath = targetWorktreePath;
                  const requestedAt = new Date().toISOString();
                  return projectSetupScriptRunner
                    .runForThread({
                      threadId: command.threadId,
                      ...(targetProjectId ? { projectId: targetProjectId } : {}),
                      ...(targetProjectCwd ? { projectCwd: targetProjectCwd } : {}),
                      worktreePath,
                    })
                    .pipe(
                      Effect.matchEffect({
                        onFailure: (error) =>
                          recordSetupScriptLaunchFailure({
                            error,
                            requestedAt,
                            worktreePath,
                          }),
                        onSuccess: (setupResult) => {
                          if (setupResult.status !== "started") {
                            return Effect.void;
                          }
                          return recordSetupScriptStarted({
                            requestedAt,
                            worktreePath,
                            scriptId: setupResult.scriptId,
                            scriptName: setupResult.scriptName,
                            terminalId: setupResult.terminalId,
                          });
                        },
                      }),
                    );
                })()
              : Effect.void;

          const bootstrapProgram = Effect.gen(function* () {
            if (bootstrap?.createThread) {
              yield* orchestrationEngine.dispatch({
                type: "thread.create",
                commandId: serverCommandId("bootstrap-thread-create"),
                threadId: command.threadId,
                projectId: bootstrap.createThread.projectId,
                title: bootstrap.createThread.title,
                modelSelection: bootstrap.createThread.modelSelection,
                runtimeMode: bootstrap.createThread.runtimeMode,
                interactionMode: bootstrap.createThread.interactionMode,
                branch: bootstrap.createThread.branch,
                worktreePath: bootstrap.createThread.worktreePath,
                createdAt: bootstrap.createThread.createdAt,
              });
              createdThread = true;
            }

            if (bootstrap?.prepareWorktree) {
              const bootstrapProject = yield* projectionSnapshotQuery
                .getActiveProjectByWorkspaceRoot(bootstrap.prepareWorktree.projectCwd)
                .pipe(
                  Effect.map(Option.getOrNull),
                  Effect.mapError((cause) =>
                    toGitManagerError(
                      "git.bootstrapPrepareWorktree",
                      "Failed to load project for bootstrap worktree.",
                      cause,
                    ),
                  ),
                );
              const worktree = yield* gitWorkflow.createWorktree({
                cwd: bootstrap.prepareWorktree.projectCwd,
                refName: bootstrap.prepareWorktree.baseBranch,
                newRefName: bootstrap.prepareWorktree.branch,
                path: resolveWorktreeCheckoutPath({
                  location: undefined,
                  appWorktreesRoot: config.worktreesDir,
                  projectId:
                    targetProjectId ?? bootstrapProject?.id ?? ProjectId.make("project-unknown"),
                  workspaceRoot: bootstrap.prepareWorktree.projectCwd,
                  projectMetadataDir: bootstrapProject?.projectMetadataDir,
                  branchName:
                    bootstrap.prepareWorktree.branch ?? bootstrap.prepareWorktree.baseBranch,
                }),
              });
              targetWorktreePath = worktree.worktree.path;
              yield* orchestrationEngine.dispatch({
                type: "thread.meta.update",
                commandId: serverCommandId("bootstrap-thread-meta-update"),
                threadId: command.threadId,
                branch: worktree.worktree.refName,
                worktreePath: targetWorktreePath,
              });
              yield* refreshGitStatus(targetWorktreePath);
            }

            yield* runSetupProgram();

            return yield* orchestrationEngine.dispatch(finalTurnStartCommand);
          });

          return yield* bootstrapProgram.pipe(
            Effect.catchCause((cause) => {
              const dispatchError = toBootstrapDispatchCommandCauseError(cause);
              if (Cause.hasInterruptsOnly(cause)) {
                return Effect.fail(dispatchError);
              }
              return cleanupCreatedThread().pipe(Effect.flatMap(() => Effect.fail(dispatchError)));
            }),
          );
        });

      const dispatchNormalizedCommand = (
        normalizedCommand: OrchestrationCommand,
      ): Effect.Effect<{ readonly sequence: number }, OrchestrationDispatchCommandError> => {
        const dispatchEffect =
          normalizedCommand.type === "thread.turn.start" && normalizedCommand.bootstrap
            ? dispatchBootstrapTurnStart(normalizedCommand)
            : orchestrationEngine
                .dispatch(normalizedCommand)
                .pipe(
                  Effect.mapError((cause) =>
                    toDispatchCommandError(cause, "Failed to dispatch orchestration command"),
                  ),
                );

        return startup
          .enqueueCommand(dispatchEffect)
          .pipe(
            Effect.mapError((cause) =>
              toDispatchCommandError(cause, "Failed to dispatch orchestration command"),
            ),
          );
      };

      const loadServerConfig = Effect.gen(function* () {
        const keybindingsConfig = yield* keybindings.loadConfigState;
        const providers = yield* providerRegistry.getProviders;
        const settings = redactServerSettingsForClient(yield* serverSettings.getSettings);
        const environment = yield* serverEnvironment.getDescriptor;
        const auth = yield* serverAuth.getDescriptor();

        return {
          environment,
          auth,
          cwd: config.cwd,
          keybindingsConfigPath: config.keybindingsConfigPath,
          keybindings: keybindingsConfig.keybindings,
          issues: keybindingsConfig.issues,
          providers,
          availableEditors: resolveAvailableEditors(),
          observability: {
            logsDirectoryPath: config.logsDir,
            localTracingEnabled: true,
            ...(config.otlpTracesUrl !== undefined ? { otlpTracesUrl: config.otlpTracesUrl } : {}),
            otlpTracesEnabled: config.otlpTracesUrl !== undefined,
            ...(config.otlpMetricsUrl !== undefined
              ? { otlpMetricsUrl: config.otlpMetricsUrl }
              : {}),
            otlpMetricsEnabled: config.otlpMetricsUrl !== undefined,
          },
          settings,
        };
      });

      const refreshGitStatus = (cwd: string) =>
        vcsStatusBroadcaster
          .refreshStatus(cwd)
          .pipe(Effect.ignoreCause({ log: true }), Effect.forkDetach, Effect.asVoid);

      const toGitManagerError = (operation: string, detail: string, cause?: unknown) =>
        new GitManagerError({
          operation,
          detail,
          ...(cause !== undefined ? { cause } : {}),
        });

      const failGitWorkflow = (operation: string, detail: string, cause?: unknown) =>
        Effect.fail(toGitManagerError(operation, detail, cause));

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

      const createWorktreeForProject = (input: GitCreateWorktreeForProjectInput) =>
        Effect.gen(function* () {
          const operation = "git.createWorktreeForProject";
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
              const project = yield* loadProjectForGitWorkflow(operation, input.projectId);
              const modelSelection = project.defaultModelSelection;
              if (modelSelection === null) {
                return yield* failGitWorkflow(
                  operation,
                  `Project ${input.projectId} has no default model selection.`,
                );
              }
              const now = new Date().toISOString();
              const threadId = ThreadId.make(`thread-${crypto.randomUUID()}`);
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
          if (modelSelection === null) {
            return yield* failGitWorkflow(
              operation,
              `Project ${input.projectId} has no default model selection.`,
            );
          }

          const now = new Date().toISOString();
          const worktreeId = WorktreeId.make(`worktree-${crypto.randomUUID()}`);
          const threadId = ThreadId.make(`thread-${crypto.randomUUID()}`);
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
                (yield* textGeneration
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
                  (yield* textGeneration
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

          const worktreePath =
            preparedWorktreePath ??
            (yield* gitWorkflow.createWorktree({
              cwd: project.workspaceRoot,
              refName,
              ...(newRefName !== undefined ? { newRefName } : {}),
              path: resolveWorktreeCheckoutPath({
                location: input.worktreeLocation,
                appWorktreesRoot: config.worktreesDir,
                projectId: input.projectId,
                workspaceRoot: project.workspaceRoot,
                projectMetadataDir: project.projectMetadataDir,
                branchName: branch,
              }),
            })).worktree.path;

          if (preparedWorktreePath === null) {
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

      const workflowProviderUnavailableDetail = {
        listWorkflowRuns:
          "Workflow runs are only available for source control providers that expose CI status.",
        getWorkflowRunJobs:
          "Workflow jobs are only available for source control providers that expose CI status.",
        getWorkflowJobLog:
          "Workflow logs are only available for source control providers that expose CI status.",
        rerunWorkflow:
          "Workflow reruns are only available for source control providers that expose CI rerun actions.",
      } as const;

      type SourceControlWorkflowOperation = keyof typeof workflowProviderUnavailableDetail;

      const callSourceControlWorkflowMethod = <A>(input: {
        readonly cwd: string;
        readonly operation: SourceControlWorkflowOperation;
        readonly invoke: (
          provider: SourceControlProviderShape,
        ) => Effect.Effect<A, SourceControlProviderError> | undefined;
      }) =>
        sourceControlRegistry.resolve({ cwd: input.cwd }).pipe(
          Effect.flatMap((provider) => {
            const effect = input.invoke(provider);
            if (effect) return effect;
            return Effect.fail(
              new SourceControlProviderError({
                provider: provider.kind,
                operation: input.operation,
                detail: workflowProviderUnavailableDetail[input.operation],
              }),
            );
          }),
        );

      return WsRpcGroup.of({
        [ORCHESTRATION_WS_METHODS.dispatchCommand]: (command) =>
          observeRpcEffect(
            ORCHESTRATION_WS_METHODS.dispatchCommand,
            withAccess(
              "authenticated",
              ORCHESTRATION_WS_METHODS.dispatchCommand,
              Effect.gen(function* () {
                const normalizedCommand = yield* normalizeDispatchCommand(command);
                const shouldStopSessionAfterArchive =
                  normalizedCommand.type === "thread.archive"
                    ? yield* projectionSnapshotQuery
                        .getThreadShellById(normalizedCommand.threadId)
                        .pipe(
                          Effect.map(
                            Option.match({
                              onNone: () => false,
                              onSome: (thread) =>
                                thread.session !== null && thread.session.status !== "stopped",
                            }),
                          ),
                          Effect.catch(() => Effect.succeed(false)),
                        )
                    : false;
                const result = yield* dispatchNormalizedCommand(normalizedCommand);
                if (normalizedCommand.type === "thread.archive") {
                  if (shouldStopSessionAfterArchive) {
                    yield* Effect.gen(function* () {
                      const stopCommand = yield* normalizeDispatchCommand({
                        type: "thread.session.stop",
                        commandId: CommandId.make(
                          `session-stop-for-archive:${normalizedCommand.commandId}`,
                        ),
                        threadId: normalizedCommand.threadId,
                        createdAt: new Date().toISOString(),
                      });

                      yield* dispatchNormalizedCommand(stopCommand);
                    }).pipe(
                      Effect.catchCause((cause) =>
                        Effect.logWarning("failed to stop provider session during archive", {
                          threadId: normalizedCommand.threadId,
                          cause,
                        }),
                      ),
                    );
                  }

                  yield* terminalManager.close({ threadId: normalizedCommand.threadId }).pipe(
                    Effect.catch((error) =>
                      Effect.logWarning("failed to close thread terminals after archive", {
                        threadId: normalizedCommand.threadId,
                        error: error.message,
                      }),
                    ),
                  );
                }
                return result;
              }).pipe(
                Effect.mapError((cause) =>
                  Schema.is(OrchestrationDispatchCommandError)(cause)
                    ? cause
                    : new OrchestrationDispatchCommandError({
                        message: "Failed to dispatch orchestration command",
                        cause,
                      }),
                ),
              ),
            ),
            { "rpc.aggregate": "orchestration" },
          ),
        [ORCHESTRATION_WS_METHODS.getTurnDiff]: (input) =>
          observeRpcEffect(
            ORCHESTRATION_WS_METHODS.getTurnDiff,
            checkpointDiffQuery.getTurnDiff(input).pipe(
              Effect.mapError(
                (cause) =>
                  new OrchestrationGetTurnDiffError({
                    message: "Failed to load turn diff",
                    cause,
                  }),
              ),
            ),
            { "rpc.aggregate": "orchestration" },
          ),
        [ORCHESTRATION_WS_METHODS.getFullThreadDiff]: (input) =>
          observeRpcEffect(
            ORCHESTRATION_WS_METHODS.getFullThreadDiff,
            checkpointDiffQuery.getFullThreadDiff(input).pipe(
              Effect.mapError(
                (cause) =>
                  new OrchestrationGetFullThreadDiffError({
                    message: "Failed to load full thread diff",
                    cause,
                  }),
              ),
            ),
            { "rpc.aggregate": "orchestration" },
          ),
        [ORCHESTRATION_WS_METHODS.replayEvents]: (input) =>
          observeRpcEffect(
            ORCHESTRATION_WS_METHODS.replayEvents,
            Stream.runCollect(
              orchestrationEngine.readEvents(
                clamp(input.fromSequenceExclusive, {
                  maximum: Number.MAX_SAFE_INTEGER,
                  minimum: 0,
                }),
              ),
            ).pipe(
              Effect.map((events) => Array.from(events)),
              Effect.flatMap(enrichOrchestrationEvents),
              Effect.mapError(
                (cause) =>
                  new OrchestrationReplayEventsError({
                    message: "Failed to replay orchestration events",
                    cause,
                  }),
              ),
            ),
            { "rpc.aggregate": "orchestration" },
          ),
        [ORCHESTRATION_WS_METHODS.replayEventsPage]: (input) =>
          observeRpcEffect(
            ORCHESTRATION_WS_METHODS.replayEventsPage,
            orchestrationEngine
              .readEventsPage(
                clamp(input.fromSequenceExclusive, {
                  maximum: Number.MAX_SAFE_INTEGER,
                  minimum: 0,
                }),
                clamp(input.limit, {
                  maximum: ORCHESTRATION_REPLAY_PAGE_MAX_LIMIT,
                  minimum: 1,
                }),
              )
              .pipe(
                Effect.flatMap((page) =>
                  enrichOrchestrationEvents(page.events).pipe(
                    Effect.map((events) => ({
                      events,
                      nextSequence: page.nextSequence,
                      hasMore: page.hasMore,
                    })),
                  ),
                ),
                Effect.mapError(
                  (cause) =>
                    new OrchestrationReplayEventsError({
                      message: "Failed to replay orchestration events page",
                      cause,
                    }),
                ),
              ),
            { "rpc.aggregate": "orchestration" },
          ),
        [ORCHESTRATION_WS_METHODS.subscribeShell]: (_input) =>
          observeRpcStreamEffect(
            ORCHESTRATION_WS_METHODS.subscribeShell,
            Effect.succeed(
              makeReplayableShellStream(
                projectionSnapshotQuery.getShellSnapshot().pipe(
                  Effect.tapError((cause) =>
                    Effect.logError("orchestration shell snapshot load failed", { cause }),
                  ),
                  Effect.mapError(
                    (cause) =>
                      new OrchestrationGetSnapshotError({
                        message: "Failed to load orchestration shell snapshot",
                        cause,
                      }),
                  ),
                ),
              ).pipe(
                Stream.tap((item) =>
                  Effect.sync(() =>
                    recordServerPerfPayload("server.ws.orchestration.subscribeShell", item),
                  ),
                ),
              ),
            ),
            { "rpc.aggregate": "orchestration" },
          ),
        [ORCHESTRATION_WS_METHODS.subscribeThread]: (input) =>
          observeRpcStreamEffect(
            ORCHESTRATION_WS_METHODS.subscribeThread,
            Effect.succeed(
              makeReplayableThreadStream(
                Effect.gen(function* () {
                  const perfEnabled = isServerPerfProfileEnabled();
                  const startedAtMs = perfEnabled ? Date.now() : 0;
                  const [threadDetail, snapshotSequence] = yield* Effect.all([
                    projectionSnapshotQuery.getThreadDetailById(input.threadId).pipe(
                      Effect.mapError(
                        (cause) =>
                          new OrchestrationGetSnapshotError({
                            message: `Failed to load thread ${input.threadId}`,
                            cause,
                          }),
                      ),
                    ),
                    projectionSnapshotQuery.getSnapshotSequence().pipe(
                      Effect.map(({ snapshotSequence }) => snapshotSequence),
                      Effect.mapError(
                        (cause) =>
                          new OrchestrationGetSnapshotError({
                            message: "Failed to load orchestration snapshot sequence",
                            cause,
                          }),
                      ),
                    ),
                  ]);

                  if (Option.isNone(threadDetail)) {
                    return yield* new OrchestrationGetSnapshotError({
                      message: `Thread ${input.threadId} was not found`,
                      cause: input.threadId,
                    });
                  }

                  const snapshot = {
                    snapshotSequence,
                    thread: threadDetail.value,
                  };
                  if (perfEnabled) {
                    yield* Effect.sync(() =>
                      recordServerPerfPayload(
                        "server.ws.orchestration.subscribeThread.snapshot",
                        snapshot,
                        { durationMs: Math.max(0, Date.now() - startedAtMs) },
                      ),
                    );
                  }
                  return snapshot;
                }),
                input.threadId,
              ).pipe(
                Stream.tap((item) =>
                  Effect.sync(() =>
                    recordServerPerfPayload("server.ws.orchestration.subscribeThread", item),
                  ),
                ),
              ),
            ),
            { "rpc.aggregate": "orchestration" },
          ),
        [WS_METHODS.serverGetConfig]: (_input) =>
          observeRpcEffect(WS_METHODS.serverGetConfig, loadServerConfig, {
            "rpc.aggregate": "server",
          }),
        [WS_METHODS.serverRefreshProviders]: (input) =>
          observeRpcEffect(
            WS_METHODS.serverRefreshProviders,
            ownerEffect(
              WS_METHODS.serverRefreshProviders,
              (input.instanceId !== undefined
                ? providerRegistry.refreshInstance(input.instanceId)
                : providerRegistry.refresh()
              ).pipe(Effect.map((providers) => ({ providers }))),
            ),
            { "rpc.aggregate": "server" },
          ),
        [WS_METHODS.serverUpdateProvider]: (input) =>
          observeRpcEffect(
            WS_METHODS.serverUpdateProvider,
            providerMaintenanceRunner.updateProvider(input),
            {
              "rpc.aggregate": "server",
            },
          ),
        [WS_METHODS.serverUpsertKeybinding]: (rule) =>
          observeRpcEffect(
            WS_METHODS.serverUpsertKeybinding,
            ownerEffect(
              WS_METHODS.serverUpsertKeybinding,
              Effect.gen(function* () {
                const keybindingsConfig = yield* keybindings.upsertKeybindingRule(rule);
                return { keybindings: keybindingsConfig, issues: [] };
              }),
            ),
            { "rpc.aggregate": "server" },
          ),
        [WS_METHODS.keybindingsReplaceCustom]: ({ rules }) =>
          observeRpcEffect(
            WS_METHODS.keybindingsReplaceCustom,
            ownerEffect(
              WS_METHODS.keybindingsReplaceCustom,
              Effect.gen(function* () {
                const keybindingsConfig = yield* keybindings.replaceCustomKeybindings(rules);
                return { keybindings: keybindingsConfig, issues: [] };
              }),
            ),
            { "rpc.aggregate": "server" },
          ),
        [WS_METHODS.serverGetSettings]: (_input) =>
          observeRpcEffect(
            WS_METHODS.serverGetSettings,
            serverSettings.getSettings.pipe(Effect.map(redactServerSettingsForClient)),
            {
              "rpc.aggregate": "server",
            },
          ),
        [WS_METHODS.serverUpdateSettings]: ({ patch }) =>
          observeRpcEffect(
            WS_METHODS.serverUpdateSettings,
            ownerEffect(
              WS_METHODS.serverUpdateSettings,
              serverSettings.updateSettings(patch).pipe(Effect.map(redactServerSettingsForClient)),
            ),
            {
              "rpc.aggregate": "server",
            },
          ),
        [WS_METHODS.serverDiscoverSourceControl]: (_input) =>
          observeRpcEffect(
            WS_METHODS.serverDiscoverSourceControl,
            ownerEffect(WS_METHODS.serverDiscoverSourceControl, sourceControlDiscovery.refresh),
            {
              "rpc.aggregate": "server",
            },
          ),
        [WS_METHODS.serverListOpinionatedPlugins]: (_input) =>
          observeRpcEffect(
            WS_METHODS.serverListOpinionatedPlugins,
            Effect.sync(() => listOpinionatedPlugins()),
            {
              "rpc.aggregate": "server",
            },
          ),
        [WS_METHODS.serverCheckOpinionatedPlugins]: (input) =>
          observeRpcEffect(
            WS_METHODS.serverCheckOpinionatedPlugins,
            Effect.gen(function* () {
              const settings = yield* serverSettings.getSettings.pipe(
                Effect.mapError(toOpinionatedPluginRpcError),
              );
              const providers = yield* providerRegistry.getProviders;
              return yield* Effect.tryPromise({
                try: () =>
                  checkOpinionatedPlugins({
                    settings,
                    providers,
                    ...(input.pluginId ? { pluginId: input.pluginId } : {}),
                  }),
                catch: toOpinionatedPluginRpcError,
              });
            }),
            {
              "rpc.aggregate": "server",
            },
          ),
        [WS_METHODS.serverInstallOpinionatedPlugin]: (input) =>
          observeRpcEffect(
            WS_METHODS.serverInstallOpinionatedPlugin,
            Effect.gen(function* () {
              const settings = yield* serverSettings.getSettings.pipe(
                Effect.mapError(toOpinionatedPluginRpcError),
              );
              const providers = yield* providerRegistry.getProviders;
              const result = yield* Effect.tryPromise({
                try: () =>
                  installOpinionatedPlugin({
                    request: input,
                    settings,
                    providers,
                    cwd: config.cwd,
                  }),
                catch: toOpinionatedPluginRpcError,
              });
              yield* providerRegistry.refresh().pipe(Effect.ignore);
              return result;
            }),
            {
              "rpc.aggregate": "server",
            },
          ),
        [WS_METHODS.mcpListWorkspaces]: (_input) =>
          observeRpcEffect(WS_METHODS.mcpListWorkspaces, codexMcp.listWorkspaces, {
            "rpc.aggregate": "mcp",
          }),
        [WS_METHODS.mcpListServers]: (input) =>
          observeRpcEffect(WS_METHODS.mcpListServers, codexMcp.listServers(input), {
            "rpc.aggregate": "mcp",
          }),
        [WS_METHODS.mcpUpsertServer]: (input) =>
          observeRpcEffect(WS_METHODS.mcpUpsertServer, codexMcp.upsertServer(input), {
            "rpc.aggregate": "mcp",
          }),
        [WS_METHODS.mcpSetServerEnabled]: (input) =>
          observeRpcEffect(WS_METHODS.mcpSetServerEnabled, codexMcp.setServerEnabled(input), {
            "rpc.aggregate": "mcp",
          }),
        [WS_METHODS.mcpRemoveServer]: (input) =>
          observeRpcEffect(WS_METHODS.mcpRemoveServer, codexMcp.removeServer(input), {
            "rpc.aggregate": "mcp",
          }),
        [WS_METHODS.mcpReloadServers]: (input) =>
          observeRpcEffect(WS_METHODS.mcpReloadServers, codexMcp.reloadServers(input), {
            "rpc.aggregate": "mcp",
          }),
        [WS_METHODS.mcpStartOauthLogin]: (input) =>
          observeRpcEffect(WS_METHODS.mcpStartOauthLogin, codexMcp.startOauthLogin(input), {
            "rpc.aggregate": "mcp",
          }),
        [WS_METHODS.sourceControlLookupRepository]: (input) =>
          observeRpcEffect(
            WS_METHODS.sourceControlLookupRepository,
            ownerEffect(
              WS_METHODS.sourceControlLookupRepository,
              sourceControlRepositories.lookupRepository(input),
            ),
            {
              "rpc.aggregate": "source-control",
            },
          ),
        [WS_METHODS.sourceControlSearchRepositories]: (input) =>
          observeRpcEffect(
            WS_METHODS.sourceControlSearchRepositories,
            ownerEffect(
              WS_METHODS.sourceControlSearchRepositories,
              sourceControlRepositories.searchRepositories(input),
            ),
            {
              "rpc.aggregate": "source-control",
            },
          ),
        [WS_METHODS.sourceControlCloneRepository]: (input) =>
          observeRpcEffect(
            WS_METHODS.sourceControlCloneRepository,
            ownerEffect(
              WS_METHODS.sourceControlCloneRepository,
              sourceControlRepositories.cloneRepository(input),
            ),
            {
              "rpc.aggregate": "source-control",
            },
          ),
        [WS_METHODS.sourceControlPublishRepository]: (input) =>
          observeRpcEffect(
            WS_METHODS.sourceControlPublishRepository,
            ownerEffect(
              WS_METHODS.sourceControlPublishRepository,
              sourceControlRepositories
                .publishRepository(input)
                .pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
            ),
            {
              "rpc.aggregate": "source-control",
            },
          ),
        [WS_METHODS.sourceControlListIssues]: ({ cwd, state, limit }) =>
          observeRpcEffect(
            WS_METHODS.sourceControlListIssues,
            ownerEffect(
              WS_METHODS.sourceControlListIssues,
              sourceControlRegistry.resolve({ cwd }).pipe(
                Effect.flatMap((provider) =>
                  provider.listIssues({
                    cwd,
                    state,
                    ...(limit !== undefined ? { limit } : {}),
                  }),
                ),
                Effect.tap(() =>
                  refreshLinkedWorktreeSourceControlStates({
                    cwd,
                    reason: "sourceControl.listIssues",
                  }),
                ),
              ),
            ),
            {
              "rpc.aggregate": "source-control",
            },
          ),
        [WS_METHODS.sourceControlGetIssue]: ({ cwd, reference, fullContent }) =>
          observeRpcEffect(
            WS_METHODS.sourceControlGetIssue,
            ownerEffect(
              WS_METHODS.sourceControlGetIssue,
              sourceControlRegistry.resolve({ cwd }).pipe(
                Effect.flatMap((provider) =>
                  provider.getIssue({
                    cwd,
                    reference,
                    ...(fullContent !== undefined ? { fullContent } : {}),
                  }),
                ),
                Effect.tap(() => refreshStateForLinkedReference({ cwd, kind: "issue", reference })),
              ),
            ),
            {
              "rpc.aggregate": "source-control",
            },
          ),
        [WS_METHODS.sourceControlAddIssueComment]: ({ cwd, reference, body, clientMutationId }) =>
          observeRpcEffect(
            WS_METHODS.sourceControlAddIssueComment,
            ownerEffect(
              WS_METHODS.sourceControlAddIssueComment,
              sourceControlRegistry.resolve({ cwd }).pipe(
                Effect.flatMap((provider) =>
                  provider.addIssueComment({
                    cwd,
                    reference,
                    body,
                    ...(clientMutationId !== undefined ? { clientMutationId } : {}),
                  }),
                ),
                Effect.map((detail) => ({ detail })),
                Effect.tap(() => refreshStateForLinkedReference({ cwd, kind: "issue", reference })),
              ),
            ),
            {
              "rpc.aggregate": "source-control",
            },
          ),
        [WS_METHODS.sourceControlAddIssueCommentReaction]: ({
          cwd,
          reference,
          commentId,
          content,
        }) =>
          observeRpcEffect(
            WS_METHODS.sourceControlAddIssueCommentReaction,
            ownerEffect(
              WS_METHODS.sourceControlAddIssueCommentReaction,
              sourceControlRegistry.resolve({ cwd }).pipe(
                Effect.flatMap((provider) =>
                  provider.addIssueCommentReaction({
                    cwd,
                    reference,
                    commentId,
                    content,
                  }),
                ),
                Effect.map((detail) => ({ detail })),
                Effect.tap(() => refreshStateForLinkedReference({ cwd, kind: "issue", reference })),
              ),
            ),
            {
              "rpc.aggregate": "source-control",
            },
          ),
        [WS_METHODS.sourceControlSearchIssues]: ({ cwd, query, limit }) =>
          observeRpcEffect(
            WS_METHODS.sourceControlSearchIssues,
            ownerEffect(
              WS_METHODS.sourceControlSearchIssues,
              sourceControlRegistry.resolve({ cwd }).pipe(
                Effect.flatMap((provider) =>
                  provider.searchIssues({
                    cwd,
                    query,
                    ...(limit !== undefined ? { limit } : {}),
                  }),
                ),
                Effect.tap(() =>
                  refreshLinkedWorktreeSourceControlStates({
                    cwd,
                    reason: "sourceControl.searchIssues",
                  }),
                ),
              ),
            ),
            {
              "rpc.aggregate": "source-control",
            },
          ),
        [WS_METHODS.sourceControlListChangeRequests]: ({ cwd, state, limit, query }) =>
          observeRpcEffect(
            WS_METHODS.sourceControlListChangeRequests,
            sourceControlRegistry.resolve({ cwd }).pipe(
              Effect.flatMap((provider) => {
                const trimmedQuery = query?.trim() ?? "";
                if (trimmedQuery.length > 0) {
                  return provider.searchChangeRequests({
                    cwd,
                    query: trimmedQuery,
                    ...(limit !== undefined ? { limit } : {}),
                  });
                }
                return provider.listChangeRequests({
                  cwd,
                  headSelector: "",
                  state,
                  ...(limit !== undefined ? { limit } : {}),
                });
              }),
              Effect.tap(() =>
                refreshLinkedWorktreeSourceControlStates({
                  cwd,
                  reason: "sourceControl.listChangeRequests",
                }),
              ),
            ),
            {
              "rpc.aggregate": "source-control",
            },
          ),
        [WS_METHODS.sourceControlSearchChangeRequests]: ({ cwd, query, limit }) =>
          observeRpcEffect(
            WS_METHODS.sourceControlSearchChangeRequests,
            ownerEffect(
              WS_METHODS.sourceControlSearchChangeRequests,
              sourceControlRegistry.resolve({ cwd }).pipe(
                Effect.flatMap((provider) =>
                  provider.searchChangeRequests({
                    cwd,
                    query,
                    ...(limit !== undefined ? { limit } : {}),
                  }),
                ),
                Effect.tap(() =>
                  refreshLinkedWorktreeSourceControlStates({
                    cwd,
                    reason: "sourceControl.searchChangeRequests",
                  }),
                ),
              ),
            ),
            {
              "rpc.aggregate": "source-control",
            },
          ),
        [WS_METHODS.sourceControlGetChangeRequestDetail]: ({ cwd, reference, fullContent }) =>
          observeRpcEffect(
            WS_METHODS.sourceControlGetChangeRequestDetail,
            ownerEffect(
              WS_METHODS.sourceControlGetChangeRequestDetail,
              sourceControlRegistry.resolve({ cwd }).pipe(
                Effect.flatMap((provider) =>
                  provider.getChangeRequestDetail({
                    cwd,
                    reference,
                    ...(fullContent !== undefined ? { fullContent } : {}),
                  }),
                ),
                Effect.tap(() => refreshStateForLinkedReference({ cwd, kind: "pr", reference })),
              ),
            ),
            {
              "rpc.aggregate": "source-control",
            },
          ),
        [WS_METHODS.sourceControlAddChangeRequestComment]: ({
          cwd,
          reference,
          body,
          clientMutationId,
        }) =>
          observeRpcEffect(
            WS_METHODS.sourceControlAddChangeRequestComment,
            ownerEffect(
              WS_METHODS.sourceControlAddChangeRequestComment,
              sourceControlRegistry.resolve({ cwd }).pipe(
                Effect.flatMap((provider) =>
                  provider.addChangeRequestComment({
                    cwd,
                    reference,
                    body,
                    ...(clientMutationId !== undefined ? { clientMutationId } : {}),
                  }),
                ),
                Effect.map((detail) => ({ detail })),
                Effect.tap(() => refreshStateForLinkedReference({ cwd, kind: "pr", reference })),
              ),
            ),
            {
              "rpc.aggregate": "source-control",
            },
          ),
        [WS_METHODS.sourceControlAddChangeRequestCommentReaction]: ({
          cwd,
          reference,
          commentId,
          content,
        }) =>
          observeRpcEffect(
            WS_METHODS.sourceControlAddChangeRequestCommentReaction,
            ownerEffect(
              WS_METHODS.sourceControlAddChangeRequestCommentReaction,
              sourceControlRegistry.resolve({ cwd }).pipe(
                Effect.flatMap((provider) =>
                  provider.addChangeRequestCommentReaction({
                    cwd,
                    reference,
                    commentId,
                    content,
                  }),
                ),
                Effect.map((detail) => ({ detail })),
                Effect.tap(() => refreshStateForLinkedReference({ cwd, kind: "pr", reference })),
              ),
            ),
            {
              "rpc.aggregate": "source-control",
            },
          ),
        [WS_METHODS.sourceControlGetChangeRequestDiff]: ({ cwd, reference }) =>
          observeRpcEffect(
            WS_METHODS.sourceControlGetChangeRequestDiff,
            ownerEffect(
              WS_METHODS.sourceControlGetChangeRequestDiff,
              sourceControlRegistry
                .resolve({ cwd })
                .pipe(
                  Effect.flatMap((provider) => provider.getChangeRequestDiff({ cwd, reference })),
                ),
            ),
            {
              "rpc.aggregate": "source-control",
            },
          ),
        [WS_METHODS.sourceControlCreateIssue]: (input) =>
          observeRpcEffect(
            WS_METHODS.sourceControlCreateIssue,
            ownerEffect(
              WS_METHODS.sourceControlCreateIssue,
              Effect.gen(function* () {
                const provider = yield* sourceControlRegistry.resolve({ cwd: input.cwd });
                const issue = yield* provider.createIssue({
                  cwd: input.cwd,
                  title: input.title,
                  body: input.body,
                  ...(input.labels ? { labels: input.labels } : {}),
                  ...(input.assignees ? { assignees: input.assignees } : {}),
                });

                if (!input.worktree?.enabled) {
                  return { issue } as {
                    readonly issue: typeof issue;
                    readonly worktree?: undefined;
                    readonly worktreeError?: undefined;
                  };
                }

                const projectOpt = yield* projectionSnapshotQuery
                  .getActiveProjectByWorkspaceRoot(input.cwd)
                  .pipe(
                    Effect.mapError((cause) =>
                      toGitManagerError(
                        WS_METHODS.sourceControlCreateIssue,
                        "Failed to resolve project for worktree creation.",
                        cause,
                      ),
                    ),
                  );
                if (Option.isNone(projectOpt)) {
                  return {
                    issue,
                    worktreeError: `No project registered for workspace root '${input.cwd}'.`,
                  };
                }
                const projectId = projectOpt.value.id;
                const worktreeBranchName = input.worktree.branchName;
                return yield* createWorktreeForProject({
                  projectId,
                  intent: {
                    kind: "issue",
                    number: issue.number,
                    branchName: worktreeBranchName,
                  },
                }).pipe(
                  Effect.matchEffect({
                    onSuccess: (worktree) => Effect.succeed({ issue, worktree }),
                    onFailure: (error) =>
                      Effect.succeed({
                        issue,
                        worktreeError: error.message ?? "Failed to create worktree for issue.",
                      }),
                  }),
                );
              }),
            ),
            {
              "rpc.aggregate": "source-control",
            },
          ),
        [WS_METHODS.sourceControlListIssueLabels]: ({ cwd }) =>
          observeRpcEffect(
            WS_METHODS.sourceControlListIssueLabels,
            ownerEffect(
              WS_METHODS.sourceControlListIssueLabels,
              sourceControlRegistry
                .resolve({ cwd })
                .pipe(Effect.flatMap((provider) => provider.listLabels({ cwd }))),
            ),
            {
              "rpc.aggregate": "source-control",
            },
          ),
        [WS_METHODS.sourceControlListIssueAssignees]: ({ cwd }) =>
          observeRpcEffect(
            WS_METHODS.sourceControlListIssueAssignees,
            ownerEffect(
              WS_METHODS.sourceControlListIssueAssignees,
              sourceControlRegistry
                .resolve({ cwd })
                .pipe(Effect.flatMap((provider) => provider.listAssignees({ cwd }))),
            ),
            {
              "rpc.aggregate": "source-control",
            },
          ),
        [WS_METHODS.sourceControlListWorkflowRuns]: ({
          cwd,
          pullRequestNumber,
          commitSha,
          limit,
        }) =>
          observeRpcEffect(
            WS_METHODS.sourceControlListWorkflowRuns,
            ownerEffect(
              WS_METHODS.sourceControlListWorkflowRuns,
              callSourceControlWorkflowMethod({
                cwd,
                operation: "listWorkflowRuns",
                invoke: (provider) => {
                  const method = provider.listWorkflowRuns;
                  return method?.({
                    cwd,
                    ...(pullRequestNumber !== undefined ? { pullRequestNumber } : {}),
                    ...(commitSha !== undefined ? { commitSha } : {}),
                    ...(limit !== undefined ? { limit } : {}),
                  });
                },
              }),
            ),
            {
              "rpc.aggregate": "source-control",
            },
          ),
        [WS_METHODS.sourceControlGetWorkflowRunJobs]: ({ cwd, runId }) =>
          observeRpcEffect(
            WS_METHODS.sourceControlGetWorkflowRunJobs,
            ownerEffect(
              WS_METHODS.sourceControlGetWorkflowRunJobs,
              callSourceControlWorkflowMethod({
                cwd,
                operation: "getWorkflowRunJobs",
                invoke: (provider) => {
                  const method = provider.getWorkflowRunJobs;
                  return method?.({ cwd, runId });
                },
              }),
            ),
            {
              "rpc.aggregate": "source-control",
            },
          ),
        [WS_METHODS.sourceControlGetWorkflowJobLog]: ({ cwd, runId, jobId }) =>
          observeRpcEffect(
            WS_METHODS.sourceControlGetWorkflowJobLog,
            ownerEffect(
              WS_METHODS.sourceControlGetWorkflowJobLog,
              callSourceControlWorkflowMethod({
                cwd,
                operation: "getWorkflowJobLog",
                invoke: (provider) => {
                  const method = provider.getWorkflowJobLog;
                  return method?.({ cwd, runId, jobId });
                },
              }),
            ),
            {
              "rpc.aggregate": "source-control",
            },
          ),
        [WS_METHODS.sourceControlRerunWorkflow]: (input) =>
          observeRpcEffect(
            WS_METHODS.sourceControlRerunWorkflow,
            ownerEffect(
              WS_METHODS.sourceControlRerunWorkflow,
              callSourceControlWorkflowMethod({
                cwd: input.cwd,
                operation: "rerunWorkflow",
                invoke: (provider) => {
                  const method = provider.rerunWorkflow;
                  return method?.(input);
                },
              }),
            ),
            {
              "rpc.aggregate": "source-control",
            },
          ),
        [WS_METHODS.textGenerationGenerateIssueContent]: (input) =>
          observeRpcEffect(
            WS_METHODS.textGenerationGenerateIssueContent,
            ownerEffect(
              WS_METHODS.textGenerationGenerateIssueContent,
              Effect.gen(function* () {
                const settings = yield* serverSettings.getSettings.pipe(
                  Effect.mapError(
                    (cause) =>
                      new TextGenerationError({
                        operation: "generateIssueContent",
                        detail: "Failed to load server settings for text generation model.",
                        cause,
                      }),
                  ),
                );
                return yield* textGeneration.generateIssueContent(
                  input.mode === "polish"
                    ? {
                        cwd: input.cwd,
                        mode: "polish",
                        rough: input.rough ?? input.body ?? "",
                        ...(input.currentTitle !== undefined
                          ? { currentTitle: input.currentTitle }
                          : {}),
                        ...(input.customInstructions !== undefined
                          ? { customInstructions: input.customInstructions }
                          : {}),
                        modelSelection: settings.textGenerationModelSelection,
                      }
                    : {
                        cwd: input.cwd,
                        mode: "title",
                        body: input.body ?? input.rough ?? "",
                        modelSelection: settings.textGenerationModelSelection,
                      },
                );
              }),
            ),
            {
              "rpc.aggregate": "text-generation",
            },
          ),
        [WS_METHODS.textGenerationGenerateBranchName]: (input) =>
          observeRpcEffect(
            WS_METHODS.textGenerationGenerateBranchName,
            ownerEffect(
              WS_METHODS.textGenerationGenerateBranchName,
              Effect.gen(function* () {
                const settings = yield* serverSettings.getSettings.pipe(
                  Effect.mapError(
                    (cause) =>
                      new TextGenerationError({
                        operation: "generateBranchName",
                        detail: "Failed to load server settings for text generation model.",
                        cause,
                      }),
                  ),
                );
                const { branch } = yield* textGeneration.generateBranchName({
                  cwd: input.cwd,
                  message: input.message,
                  modelSelection: settings.textGenerationModelSelection,
                });
                return { branch };
              }),
            ),
            {
              "rpc.aggregate": "text-generation",
            },
          ),
        [WS_METHODS.atlassianListConnections]: (_input) =>
          observeRpcEffect(WS_METHODS.atlassianListConnections, atlassian.listConnections, {
            "rpc.aggregate": "atlassian",
          }),
        [WS_METHODS.atlassianStartOAuth]: (input) =>
          observeRpcEffect(WS_METHODS.atlassianStartOAuth, atlassian.startOAuth(input), {
            "rpc.aggregate": "atlassian",
          }),
        [WS_METHODS.atlassianDisconnect]: (input) =>
          observeRpcEffect(
            WS_METHODS.atlassianDisconnect,
            atlassian.disconnect(input).pipe(Effect.as({})),
            {
              "rpc.aggregate": "atlassian",
            },
          ),
        [WS_METHODS.atlassianRefresh]: (input) =>
          observeRpcEffect(WS_METHODS.atlassianRefresh, atlassian.refresh(input), {
            "rpc.aggregate": "atlassian",
          }),
        [WS_METHODS.atlassianListResources]: (input) =>
          observeRpcEffect(WS_METHODS.atlassianListResources, atlassian.listResources(input), {
            "rpc.aggregate": "atlassian",
          }),
        [WS_METHODS.atlassianGetProjectLink]: (input) =>
          observeRpcEffect(WS_METHODS.atlassianGetProjectLink, atlassian.getProjectLink(input), {
            "rpc.aggregate": "atlassian",
          }),
        [WS_METHODS.atlassianSaveProjectLink]: (input) =>
          observeRpcEffect(WS_METHODS.atlassianSaveProjectLink, atlassian.saveProjectLink(input), {
            "rpc.aggregate": "atlassian",
          }),
        [WS_METHODS.atlassianSaveManualBitbucketToken]: (input) =>
          observeRpcEffect(
            WS_METHODS.atlassianSaveManualBitbucketToken,
            atlassian.saveManualBitbucketToken(input),
            {
              "rpc.aggregate": "atlassian",
            },
          ),
        [WS_METHODS.atlassianSaveManualJiraToken]: (input) =>
          observeRpcEffect(
            WS_METHODS.atlassianSaveManualJiraToken,
            atlassian.saveManualJiraToken(input),
            {
              "rpc.aggregate": "atlassian",
            },
          ),
        [WS_METHODS.workItemsListProjects]: (input) =>
          observeRpcEffect(WS_METHODS.workItemsListProjects, workItems.listProjects(input), {
            "rpc.aggregate": "work-items",
          }),
        [WS_METHODS.workItemsList]: (input) =>
          observeRpcEffect(WS_METHODS.workItemsList, workItems.list(input), {
            "rpc.aggregate": "work-items",
          }),
        [WS_METHODS.workItemsSearch]: (input) =>
          observeRpcEffect(WS_METHODS.workItemsSearch, workItems.search(input), {
            "rpc.aggregate": "work-items",
          }),
        [WS_METHODS.workItemsGet]: (input) =>
          observeRpcEffect(WS_METHODS.workItemsGet, workItems.get(input), {
            "rpc.aggregate": "work-items",
          }),
        [WS_METHODS.workItemsAddComment]: (input) =>
          observeRpcEffect(WS_METHODS.workItemsAddComment, workItems.addComment(input), {
            "rpc.aggregate": "work-items",
          }),
        [WS_METHODS.workItemsEditComment]: (input) =>
          observeRpcEffect(WS_METHODS.workItemsEditComment, workItems.editComment(input), {
            "rpc.aggregate": "work-items",
          }),
        [WS_METHODS.workItemsUpdate]: (input) =>
          observeRpcEffect(WS_METHODS.workItemsUpdate, workItems.update(input), {
            "rpc.aggregate": "work-items",
          }),
        [WS_METHODS.workItemsListTransitions]: (input) =>
          observeRpcEffect(WS_METHODS.workItemsListTransitions, workItems.listTransitions(input), {
            "rpc.aggregate": "work-items",
          }),
        [WS_METHODS.workItemsTransition]: (input) =>
          observeRpcEffect(WS_METHODS.workItemsTransition, workItems.transition(input), {
            "rpc.aggregate": "work-items",
          }),
        [WS_METHODS.projectsSearchEntries]: (input) =>
          observeRpcEffect(
            WS_METHODS.projectsSearchEntries,
            ownerEffect(
              WS_METHODS.projectsSearchEntries,
              workspaceEntries.search(input).pipe(
                Effect.mapError(
                  (cause) =>
                    new ProjectSearchEntriesError({
                      message: `Failed to search workspace entries: ${cause.detail}`,
                      cause,
                    }),
                ),
              ),
            ),
            { "rpc.aggregate": "workspace" },
          ),
        [WS_METHODS.projectsListEntries]: (input) =>
          observeRpcEffect(
            WS_METHODS.projectsListEntries,
            ownerEffect(
              WS_METHODS.projectsListEntries,
              workspaceEntries.listEntries(input).pipe(
                Effect.mapError(
                  (cause) =>
                    new ProjectListEntriesError({
                      message: `Failed to list workspace entries: ${cause.detail}`,
                      cause,
                    }),
                ),
              ),
            ),
            { "rpc.aggregate": "workspace" },
          ),
        [WS_METHODS.projectsReadFile]: (input) =>
          observeRpcEffect(
            WS_METHODS.projectsReadFile,
            ownerEffect(
              WS_METHODS.projectsReadFile,
              workspaceFileSystem.readFile(input).pipe(
                Effect.mapError((cause) => {
                  const message = Schema.is(WorkspacePathOutsideRootError)(cause)
                    ? "Workspace file path must stay within the project root."
                    : cause.detail;
                  return new ProjectReadFileError({
                    message,
                    cause,
                  });
                }),
              ),
            ),
            { "rpc.aggregate": "workspace" },
          ),
        [WS_METHODS.projectsWriteFile]: (input) =>
          observeRpcEffect(
            WS_METHODS.projectsWriteFile,
            ownerEffect(
              WS_METHODS.projectsWriteFile,
              workspaceFileSystem.writeFile(input).pipe(
                Effect.mapError((cause) => {
                  const message = Schema.is(WorkspacePathOutsideRootError)(cause)
                    ? "Workspace file path must stay within the project root."
                    : "Failed to write workspace file";
                  return new ProjectWriteFileError({
                    message,
                    cause,
                  });
                }),
              ),
            ),
            { "rpc.aggregate": "workspace" },
          ),
        [WS_METHODS.projectsStageFileReference]: (input) =>
          observeRpcEffect(
            WS_METHODS.projectsStageFileReference,
            ownerEffect(
              WS_METHODS.projectsStageFileReference,
              workspaceFileSystem.stageFileReference(input).pipe(
                Effect.mapError((cause) => {
                  const message = Schema.is(WorkspacePathOutsideRootError)(cause)
                    ? "Workspace file path must stay within the project root."
                    : cause.detail;
                  return new ProjectStageFileReferenceError({
                    message,
                    cause,
                  });
                }),
              ),
            ),
            { "rpc.aggregate": "workspace" },
          ),
        [WS_METHODS.shellOpenInEditor]: (input) =>
          observeRpcEffect(
            WS_METHODS.shellOpenInEditor,
            ownerEffect(WS_METHODS.shellOpenInEditor, open.openInEditor(input)),
            {
              "rpc.aggregate": "workspace",
            },
          ),
        [WS_METHODS.filesystemBrowse]: (input) =>
          observeRpcEffect(
            WS_METHODS.filesystemBrowse,
            ownerEffect(
              WS_METHODS.filesystemBrowse,
              workspaceEntries.browse(input).pipe(
                Effect.mapError(
                  (cause) =>
                    new FilesystemBrowseError({
                      message: cause.detail,
                      cause,
                    }),
                ),
              ),
            ),
            { "rpc.aggregate": "workspace" },
          ),
        [WS_METHODS.subscribeVcsStatus]: (input) =>
          observeRpcStream(
            WS_METHODS.subscribeVcsStatus,
            ownerStream(
              WS_METHODS.subscribeVcsStatus,
              vcsStatusBroadcaster.streamStatus(input, {
                automaticRemoteRefreshInterval: Effect.succeed(
                  Duration.millis(input.automaticRemoteRefreshIntervalMs ?? 0),
                ),
              }),
            ),
            {
              "rpc.aggregate": "vcs",
            },
          ),
        [WS_METHODS.vcsRefreshStatus]: (input) =>
          observeRpcEffect(
            WS_METHODS.vcsRefreshStatus,
            ownerEffect(WS_METHODS.vcsRefreshStatus, vcsStatusBroadcaster.refreshStatus(input.cwd)),
            {
              "rpc.aggregate": "vcs",
            },
          ),
        [WS_METHODS.vcsPull]: (input) =>
          observeRpcEffect(
            WS_METHODS.vcsPull,
            ownerEffect(
              WS_METHODS.vcsPull,
              gitWorkflow.pullCurrentBranch(input.cwd).pipe(
                Effect.matchCauseEffect({
                  onFailure: (cause) => Effect.failCause(cause),
                  onSuccess: (result) =>
                    refreshGitStatus(input.cwd).pipe(
                      Effect.ignore({ log: true }),
                      Effect.as(result),
                    ),
                }),
              ),
            ),
            { "rpc.aggregate": "git" },
          ),
        [WS_METHODS.gitRunStackedAction]: (input) =>
          observeRpcStream(
            WS_METHODS.gitRunStackedAction,
            ownerStream(
              WS_METHODS.gitRunStackedAction,
              Stream.callback<GitActionProgressEvent, GitManagerServiceError>((queue) =>
                attachLinkedIssuesToPrAction(input).pipe(
                  Effect.flatMap((runInput) =>
                    gitWorkflow.runStackedAction(runInput, {
                      actionId: input.actionId,
                      progressReporter: {
                        publish: (event) => Queue.offer(queue, event).pipe(Effect.asVoid),
                      },
                    }),
                  ),
                  Effect.matchCauseEffect({
                    onFailure: (cause) => Queue.failCause(queue, cause),
                    onSuccess: (result) =>
                      Effect.gen(function* () {
                        if (
                          input.worktreeId !== undefined &&
                          result.pr.number !== undefined &&
                          (result.pr.status === "created" || result.pr.status === "opened_existing")
                        ) {
                          const existing = yield* projectionWorktrees
                            .getById({
                              worktreeId: input.worktreeId,
                            })
                            .pipe(
                              Effect.mapError((cause) =>
                                toGitManagerError(
                                  WS_METHODS.gitRunStackedAction,
                                  "Failed to load worktree for pull request link update.",
                                  cause,
                                ),
                              ),
                            );
                          if (Option.isSome(existing)) {
                            yield* dispatchWorktreeCommand(
                              {
                                type: "worktree.source-control-state.update",
                                commandId: serverCommandId("worktree-pr-link"),
                                worktreeId: input.worktreeId,
                                prNumber: result.pr.number,
                                prTitle: result.pr.title ?? existing.value.prTitle,
                                prState: "open",
                                prIsDraft: false,
                                issueState: existing.value.issueState ?? null,
                                updatedAt: new Date().toISOString(),
                              },
                              WS_METHODS.gitRunStackedAction,
                            );
                          }
                        }
                        yield* refreshGitStatus(input.cwd);
                        yield* Queue.end(queue).pipe(Effect.asVoid);
                      }),
                  }),
                ),
              ),
            ),
            { "rpc.aggregate": "vcs" },
          ),
        [WS_METHODS.gitResolvePullRequest]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitResolvePullRequest,
            ownerEffect(WS_METHODS.gitResolvePullRequest, gitWorkflow.resolvePullRequest(input)),
            {
              "rpc.aggregate": "git",
            },
          ),
        [WS_METHODS.gitPreparePullRequestThread]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitPreparePullRequestThread,
            ownerEffect(
              WS_METHODS.gitPreparePullRequestThread,
              (input.projectId
                ? projectionSnapshotQuery.getProjectShellById(input.projectId).pipe(
                    Effect.mapError((cause) =>
                      toGitManagerError(
                        "git.preparePullRequestThread",
                        `Failed to load project ${input.projectId}.`,
                        cause,
                      ),
                    ),
                    Effect.map(Option.getOrNull),
                    Effect.map((project) => ({
                      ...input,
                      worktreesDir:
                        input.worktreeLocation === "projectMetadata"
                          ? resolveProjectWorktreesDir(input.cwd, project?.projectMetadataDir)
                          : path.join(
                              config.worktreesDir,
                              project?.id ?? input.projectId ?? ProjectId.make("project-unknown"),
                            ),
                    })),
                    Effect.flatMap((normalizedInput) =>
                      gitWorkflow.preparePullRequestThread(normalizedInput),
                    ),
                  )
                : gitWorkflow.preparePullRequestThread(input)
              ).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
            ),
            { "rpc.aggregate": "git" },
          ),
        [WS_METHODS.gitCreateWorktreeForProject]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitCreateWorktreeForProject,
            ownerEffect(WS_METHODS.gitCreateWorktreeForProject, createWorktreeForProject(input)),
            { "rpc.aggregate": "git" },
          ),
        [WS_METHODS.gitFindWorktreeForOrigin]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitFindWorktreeForOrigin,
            ownerEffect(
              WS_METHODS.gitFindWorktreeForOrigin,
              (input.kind === "workItem"
                ? projectionWorktrees.findByWorkItem(input)
                : projectionWorktrees.findByOrigin(input)
              ).pipe(
                Effect.mapError((cause) =>
                  toGitManagerError(
                    "git.findWorktreeForOrigin",
                    "Failed to find worktree for origin.",
                    cause,
                  ),
                ),
              ),
            ),
            { "rpc.aggregate": "git" },
          ),
        [WS_METHODS.gitArchiveWorktree]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitArchiveWorktree,
            ownerEffect(WS_METHODS.gitArchiveWorktree, archiveWorktree(input)),
            {
              "rpc.aggregate": "git",
            },
          ),
        [WS_METHODS.gitRestoreWorktree]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitRestoreWorktree,
            ownerEffect(WS_METHODS.gitRestoreWorktree, restoreWorktree(input.worktreeId)),
            {
              "rpc.aggregate": "git",
            },
          ),
        [WS_METHODS.gitDeleteWorktree]: (input) =>
          observeRpcEffect(
            WS_METHODS.gitDeleteWorktree,
            ownerEffect(WS_METHODS.gitDeleteWorktree, deleteWorktree(input)),
            {
              "rpc.aggregate": "git",
            },
          ),
        [WS_METHODS.threadsSetManualBucket]: (input) =>
          observeRpcEffect(
            WS_METHODS.threadsSetManualBucket,
            ownerEffect(
              WS_METHODS.threadsSetManualBucket,
              dispatchWorktreeCommand(
                {
                  type: "thread.status-bucket.override",
                  commandId: serverCommandId("thread-status-bucket-override"),
                  threadId: input.threadId,
                  bucket: input.bucket,
                  changedAt: new Date().toISOString(),
                },
                "threads.setManualBucket",
              ).pipe(Effect.as({})),
            ),
            { "rpc.aggregate": "orchestration" },
          ),
        [WS_METHODS.threadsSetManualPosition]: (input) =>
          observeRpcEffect(
            WS_METHODS.threadsSetManualPosition,
            ownerEffect(
              WS_METHODS.threadsSetManualPosition,
              dispatchWorktreeCommand(
                {
                  type: "thread.manual-position.set",
                  commandId: serverCommandId("thread-manual-position-set"),
                  threadId: input.threadId,
                  position: input.position,
                  changedAt: new Date().toISOString(),
                },
                "threads.setManualPosition",
              ).pipe(Effect.as({})),
            ),
            { "rpc.aggregate": "orchestration" },
          ),
        [WS_METHODS.worktreesSetManualPosition]: (input) =>
          observeRpcEffect(
            WS_METHODS.worktreesSetManualPosition,
            ownerEffect(
              WS_METHODS.worktreesSetManualPosition,
              dispatchWorktreeCommand(
                {
                  type: "worktree.manual-position.set",
                  commandId: serverCommandId("worktree-manual-position-set"),
                  worktreeId: input.worktreeId,
                  position: input.position,
                  changedAt: new Date().toISOString(),
                },
                "worktrees.setManualPosition",
              ).pipe(Effect.as({})),
            ),
            { "rpc.aggregate": "git" },
          ),
        [WS_METHODS.projectsInitializeGit]: (input) =>
          observeRpcEffect(
            WS_METHODS.projectsInitializeGit,
            ownerEffect(WS_METHODS.projectsInitializeGit, initializeGitForProject(input.projectId)),
            { "rpc.aggregate": "git" },
          ),
        [WS_METHODS.vcsListRefs]: (input) =>
          observeRpcEffect(
            WS_METHODS.vcsListRefs,
            ownerEffect(WS_METHODS.vcsListRefs, gitWorkflow.listRefs(input)),
            {
              "rpc.aggregate": "vcs",
            },
          ),
        [WS_METHODS.vcsCreateWorktree]: (input) =>
          observeRpcEffect(
            WS_METHODS.vcsCreateWorktree,
            ownerEffect(
              WS_METHODS.vcsCreateWorktree,
              gitWorkflow.createWorktree(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
            ),
            { "rpc.aggregate": "vcs" },
          ),
        [WS_METHODS.vcsRemoveWorktree]: (input) =>
          observeRpcEffect(
            WS_METHODS.vcsRemoveWorktree,
            ownerEffect(
              WS_METHODS.vcsRemoveWorktree,
              gitWorkflow.removeWorktree(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
            ),
            { "rpc.aggregate": "vcs" },
          ),
        [WS_METHODS.vcsCreateRef]: (input) =>
          observeRpcEffect(
            WS_METHODS.vcsCreateRef,
            ownerEffect(
              WS_METHODS.vcsCreateRef,
              gitWorkflow.createRef(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
            ),
            { "rpc.aggregate": "vcs" },
          ),
        [WS_METHODS.vcsSwitchRef]: (input) =>
          observeRpcEffect(
            WS_METHODS.vcsSwitchRef,
            ownerEffect(
              WS_METHODS.vcsSwitchRef,
              gitWorkflow.switchRef(input).pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
            ),
            { "rpc.aggregate": "vcs" },
          ),
        [WS_METHODS.vcsInit]: (input) =>
          observeRpcEffect(
            WS_METHODS.vcsInit,
            ownerEffect(
              WS_METHODS.vcsInit,
              vcsProvisioning
                .initRepository(input)
                .pipe(Effect.tap(() => refreshGitStatus(input.cwd))),
            ),
            { "rpc.aggregate": "vcs" },
          ),
        [WS_METHODS.terminalOpen]: (input) =>
          observeRpcEffect(
            WS_METHODS.terminalOpen,
            ownerEffect(WS_METHODS.terminalOpen, terminalManager.open(input)),
            {
              "rpc.aggregate": "terminal",
            },
          ),
        [WS_METHODS.terminalWrite]: (input) =>
          observeRpcEffect(
            WS_METHODS.terminalWrite,
            ownerEffect(WS_METHODS.terminalWrite, terminalManager.write(input)),
            {
              "rpc.aggregate": "terminal",
            },
          ),
        [WS_METHODS.terminalResize]: (input) =>
          observeRpcEffect(
            WS_METHODS.terminalResize,
            ownerEffect(WS_METHODS.terminalResize, terminalManager.resize(input)),
            {
              "rpc.aggregate": "terminal",
            },
          ),
        [WS_METHODS.terminalClear]: (input) =>
          observeRpcEffect(
            WS_METHODS.terminalClear,
            ownerEffect(WS_METHODS.terminalClear, terminalManager.clear(input)),
            {
              "rpc.aggregate": "terminal",
            },
          ),
        [WS_METHODS.terminalRestart]: (input) =>
          observeRpcEffect(
            WS_METHODS.terminalRestart,
            ownerEffect(WS_METHODS.terminalRestart, terminalManager.restart(input)),
            {
              "rpc.aggregate": "terminal",
            },
          ),
        [WS_METHODS.terminalClose]: (input) =>
          observeRpcEffect(
            WS_METHODS.terminalClose,
            ownerEffect(WS_METHODS.terminalClose, terminalManager.close(input)),
            {
              "rpc.aggregate": "terminal",
            },
          ),
        [WS_METHODS.subscribeTerminalEvents]: (_input) =>
          observeRpcStream(
            WS_METHODS.subscribeTerminalEvents,
            ownerStream(
              WS_METHODS.subscribeTerminalEvents,
              Stream.callback<TerminalEvent>((queue) =>
                Effect.acquireRelease(
                  terminalManager.subscribe((event) =>
                    Effect.gen(function* () {
                      recordServerPerfPayload("server.ws.terminal.events", event);
                      yield* Queue.offer(queue, event);
                    }),
                  ),
                  (unsubscribe) => Effect.sync(unsubscribe),
                ),
              ),
            ),
            { "rpc.aggregate": "terminal" },
          ),
        [WS_METHODS.subscribeServerConfig]: (_input) =>
          observeRpcStreamEffect(
            WS_METHODS.subscribeServerConfig,
            Effect.gen(function* () {
              const keybindingsUpdates = keybindings.streamChanges.pipe(
                Stream.map((event) => ({
                  version: 1 as const,
                  type: "keybindingsUpdated" as const,
                  payload: {
                    keybindings: event.keybindings,
                    issues: event.issues,
                  },
                })),
              );
              const providerStatuses = providerRegistry.streamChanges.pipe(
                Stream.map((providers) => ({
                  version: 1 as const,
                  type: "providerStatuses" as const,
                  payload: { providers },
                })),
                Stream.debounce(Duration.millis(PROVIDER_STATUS_DEBOUNCE_MS)),
              );
              const settingsUpdates = serverSettings.streamChanges.pipe(
                Stream.map((settings) => redactServerSettingsForClient(settings)),
                Stream.map((settings) => ({
                  version: 1 as const,
                  type: "settingsUpdated" as const,
                  payload: { settings },
                })),
              );

              yield* providerRegistry
                .refresh()
                .pipe(Effect.ignoreCause({ log: true }), Effect.forkScoped);

              const liveUpdates = Stream.merge(
                keybindingsUpdates,
                Stream.merge(providerStatuses, settingsUpdates),
              );

              return Stream.concat(
                Stream.make({
                  version: 1 as const,
                  type: "snapshot" as const,
                  config: yield* loadServerConfig,
                }),
                liveUpdates,
              );
            }),
            { "rpc.aggregate": "server" },
          ),
        [WS_METHODS.subscribeServerLifecycle]: (_input) =>
          observeRpcStreamEffect(
            WS_METHODS.subscribeServerLifecycle,
            Effect.gen(function* () {
              const snapshot = yield* lifecycleEvents.snapshot;
              const snapshotEvents = Array.from(snapshot.events).toSorted(
                (left, right) => left.sequence - right.sequence,
              );
              const liveEvents = lifecycleEvents.stream.pipe(
                Stream.filter((event) => event.sequence > snapshot.sequence),
              );
              return Stream.concat(Stream.fromIterable(snapshotEvents), liveEvents);
            }),
            { "rpc.aggregate": "server" },
          ),
        [WS_METHODS.subscribeAuthAccess]: (_input) =>
          observeRpcStreamEffect(
            WS_METHODS.subscribeAuthAccess,
            ownerStreamEffect(
              WS_METHODS.subscribeAuthAccess,
              Effect.gen(function* () {
                const initialSnapshot = yield* loadAuthAccessSnapshot();
                const revisionRef = yield* Ref.make(1);
                const accessChanges: Stream.Stream<
                  BootstrapCredentialChange | SessionCredentialChange
                > = Stream.merge(bootstrapCredentials.streamChanges, sessions.streamChanges);

                const liveEvents: Stream.Stream<AuthAccessStreamEvent> = accessChanges.pipe(
                  Stream.mapEffect((change) =>
                    Ref.updateAndGet(revisionRef, (revision) => revision + 1).pipe(
                      Effect.map((revision) =>
                        toAuthAccessStreamEvent(change, revision, currentSessionId),
                      ),
                    ),
                  ),
                );

                return Stream.concat(
                  Stream.make({
                    version: 1 as const,
                    revision: 1,
                    type: "snapshot" as const,
                    payload: initialSnapshot,
                  }),
                  liveEvents,
                );
              }),
            ),
            { "rpc.aggregate": "auth" },
          ),
      });
    }),
  );

export const websocketRpcRouteLayer = Layer.unwrap(
  Effect.succeed(
    HttpRouter.add(
      "GET",
      "/ws",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const serverAuth = yield* ServerAuth;
        const sessions = yield* SessionCredentialService;
        const session = yield* serverAuth.authenticateWebSocketUpgrade(request);
        const rpcWebSocketHttpEffect = yield* RpcServer.toHttpEffectWebsocket(WsRpcGroup, {
          spanPrefix: "ws.rpc",
          spanAttributes: {
            "rpc.transport": "websocket",
            "rpc.system": "effect-rpc",
          },
        }).pipe(
          Effect.provide(
            makeWsRpcLayer(session).pipe(
              Layer.provideMerge(RpcSerialization.layerJson),
              Layer.provide(ProviderMaintenanceRunner.layer),
              Layer.provide(
                SourceControlDiscoveryLayer.layer.pipe(
                  Layer.provide(
                    SourceControlProviderRegistry.layer.pipe(
                      Layer.provide(
                        Layer.mergeAll(
                          AzureDevOpsCli.layer,
                          BitbucketApi.layer,
                          ForgejoApi.layer,
                          GitHubCli.layer,
                          GitLabCli.layer,
                        ),
                      ),
                      Layer.provideMerge(AtlassianConnectionRepositoryLive),
                      Layer.provideMerge(SqlitePersistenceLayerLive),
                      Layer.provide(ServerSecretStoreLive),
                      Layer.provideMerge(GitVcsDriver.layer),
                      Layer.provide(
                        VcsDriverRegistry.layer.pipe(Layer.provide(VcsProjectConfig.layer)),
                      ),
                    ),
                  ),
                  Layer.provide(VcsProcess.layer),
                ),
              ),
            ),
          ),
        );
        return yield* Effect.acquireUseRelease(
          sessions.markConnected(session.sessionId),
          () => rpcWebSocketHttpEffect,
          () => sessions.markDisconnected(session.sessionId),
        );
      }).pipe(Effect.catchTag("AuthError", respondToAuthError)),
    ),
  ),
);
