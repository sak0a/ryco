import type {
  CommandId,
  EnvironmentId,
  OrchestrationCommand,
  OrchestrationDispatchCommandError,
  OrchestrationShellSnapshot,
  PullRequestAssociation,
  PullRequestInboxSnapshot,
  PullRequestRepositoryCoverage,
} from "@ryco/contracts";
import { DateTime, Effect, Option } from "effect";

import type { ProjectionPullRequestRepositoryShape } from "../persistence/Services/ProjectionPullRequests.ts";
import type { PullRequestViewerKey } from "../persistence/Services/ProjectionPullRequests.ts";
import type { ProjectionSnapshotQueryShape } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import type { SourceControlProviderRegistryShape } from "./SourceControlProviderRegistry.ts";
import { normalizeProviderPullRequest } from "./PullRequestProviderNormalization.ts";

const REPOSITORY_CONCURRENCY = 4;
const PAGE_LIMIT = 100;

export interface PullRequestInboxSynchronizerDependencies {
  readonly environmentId: EnvironmentId;
  readonly projection: ProjectionPullRequestRepositoryShape;
  readonly snapshots: ProjectionSnapshotQueryShape;
  readonly sourceControl: SourceControlProviderRegistryShape;
  readonly coverageByRepository: Map<string, PullRequestRepositoryCoverage>;
  readonly viewerKey: PullRequestViewerKey;
  readonly dispatchCommand: (
    command: Extract<OrchestrationCommand, { type: `pull-request.${string}` }>,
  ) => Effect.Effect<unknown, OrchestrationDispatchCommandError>;
  readonly serverCommandId: (tag: string) => CommandId;
}

function dispatchAssociation(
  deps: Pick<PullRequestInboxSynchronizerDependencies, "dispatchCommand" | "serverCommandId">,
  association: PullRequestAssociation,
) {
  return deps.dispatchCommand({
    type: "pull-request.association.record",
    commandId: deps.serverCommandId("pull-request-association-record"),
    pullRequestId: association.pullRequestId,
    association,
    occurredAt: DateTime.formatIso(association.createdAt),
  });
}

function relationshipAt(
  pullRequestId: PullRequestAssociation["pullRequestId"],
  subject: PullRequestAssociation["subject"],
  relationship: PullRequestAssociation["relationship"],
  evidence: PullRequestAssociation["evidence"],
  now: DateTime.Utc,
): PullRequestAssociation {
  return {
    pullRequestId,
    subject,
    relationship,
    evidence,
    createdAt: now,
    endedAt: Option.none(),
  };
}

function recordKnownRelationships(input: {
  readonly shell: OrchestrationShellSnapshot;
  readonly projectId: string;
  readonly pullRequestId: PullRequestAssociation["pullRequestId"];
  readonly number: number;
  readonly headRefName: string;
  readonly now: DateTime.Utc;
  readonly dispatchCommand: PullRequestInboxSynchronizerDependencies["dispatchCommand"];
  readonly serverCommandId: PullRequestInboxSynchronizerDependencies["serverCommandId"];
}) {
  const worktrees = (input.shell.worktrees ?? []).filter(
    (worktree) => worktree.projectId === input.projectId && worktree.prNumber === input.number,
  );
  const branchWorktrees = (input.shell.worktrees ?? []).filter(
    (worktree) =>
      worktree.projectId === input.projectId &&
      worktree.archivedAt === null &&
      worktree.branch === input.headRefName,
  );
  const effects: Array<Effect.Effect<unknown, OrchestrationDispatchCommandError>> = [];
  for (const worktree of worktrees) {
    effects.push(
      dispatchAssociation(
        input,
        relationshipAt(
          input.pullRequestId,
          { kind: "worktree", worktreeId: worktree.worktreeId },
          "inspected",
          "verified-legacy-backfill",
          input.now,
        ),
      ),
    );
  }
  for (const worktree of branchWorktrees) {
    effects.push(
      dispatchAssociation(
        input,
        relationshipAt(
          input.pullRequestId,
          { kind: "worktree", worktreeId: worktree.worktreeId },
          "current-branch",
          "branch-reconciliation",
          input.now,
        ),
      ),
    );
  }
  for (const thread of input.shell.threads) {
    if (thread.projectId !== input.projectId || thread.archivedAt !== null) continue;
    const matchesKnownWorktree =
      thread.worktreeId !== null &&
      thread.worktreeId !== undefined &&
      worktrees.some((worktree) => worktree.worktreeId === thread.worktreeId);
    const matchesBranch = thread.branch === input.headRefName;
    if (matchesKnownWorktree) {
      effects.push(
        dispatchAssociation(
          input,
          relationshipAt(
            input.pullRequestId,
            { kind: "thread", threadId: thread.id },
            "inspected",
            "verified-legacy-backfill",
            input.now,
          ),
        ),
      );
    }
    if (matchesBranch) {
      effects.push(
        dispatchAssociation(
          input,
          relationshipAt(
            input.pullRequestId,
            { kind: "thread", threadId: thread.id },
            "current-branch",
            "branch-reconciliation",
            input.now,
          ),
        ),
      );
    }
  }
  return Effect.all(effects, { concurrency: 8, discard: true });
}

function reconcileCurrentBranchRelationships(input: {
  readonly shell: OrchestrationShellSnapshot;
  readonly repositoryCanonicalKey: string;
  readonly now: DateTime.Utc;
  readonly projection: ProjectionPullRequestRepositoryShape;
  readonly dispatchCommand: PullRequestInboxSynchronizerDependencies["dispatchCommand"];
  readonly serverCommandId: PullRequestInboxSynchronizerDependencies["serverCommandId"];
}) {
  const branchBySubject = new Map<string, string | null>();
  for (const worktree of input.shell.worktrees ?? []) {
    branchBySubject.set(
      `worktree:${worktree.worktreeId}`,
      worktree.archivedAt === null ? worktree.branch : null,
    );
  }
  for (const thread of input.shell.threads) {
    branchBySubject.set(`thread:${thread.id}`, thread.archivedAt === null ? thread.branch : null);
  }
  return input.projection.listAll().pipe(
    Effect.flatMap((records) =>
      Effect.forEach(
        records.filter((record) => record.repository.canonicalKey === input.repositoryCanonicalKey),
        (record) =>
          input.projection.listAssociations(record.identity.id).pipe(
            Effect.flatMap((associations) =>
              Effect.forEach(
                associations.filter(
                  (association) =>
                    association.relationship === "current-branch" &&
                    Option.isNone(association.endedAt),
                ),
                (association) => {
                  const subjectKey =
                    association.subject.kind === "thread"
                      ? `thread:${association.subject.threadId}`
                      : `worktree:${association.subject.worktreeId}`;
                  return branchBySubject.get(subjectKey) === record.headRefName
                    ? Effect.void
                    : input.dispatchCommand({
                        type: "pull-request.association.end",
                        commandId: input.serverCommandId("pull-request-association-end"),
                        pullRequestId: record.identity.id,
                        subject: association.subject,
                        relationship: "current-branch",
                        endedAt: input.now,
                        occurredAt: DateTime.formatIso(input.now),
                      });
                },
                { concurrency: 8, discard: true },
              ),
            ),
          ),
        { concurrency: 8, discard: true },
      ),
    ),
  );
}

export function refreshPullRequestInbox(deps: PullRequestInboxSynchronizerDependencies) {
  return Effect.gen(function* () {
    const shell = yield* deps.snapshots.getShellSnapshot();
    const now = yield* DateTime.now;
    const generation = DateTime.toEpochMillis(now);
    const projectsByRepository = new Map<string, (typeof shell.projects)[number][]>();
    for (const project of shell.projects) {
      if (!project.repositoryIdentity) continue;
      const projects = projectsByRepository.get(project.repositoryIdentity.canonicalKey) ?? [];
      projects.push(project);
      projectsByRepository.set(project.repositoryIdentity.canonicalKey, projects);
    }

    yield* Effect.forEach(
      [...projectsByRepository.values()],
      (projects) => {
        const project = projects[0]!;
        const identity = project.repositoryIdentity!;
        const [host = "unknown", ...pathParts] = identity.canonicalKey.split("/");
        const repository = {
          canonicalKey: identity.canonicalKey,
          host,
          path: pathParts.join("/"),
          displayName: identity.displayName ?? pathParts.join("/"),
        };
        return deps.sourceControl.resolveHandle({ cwd: project.workspaceRoot }).pipe(
          Effect.flatMap(({ provider, context }) =>
            provider
              .listChangeRequests({
                cwd: project.workspaceRoot,
                ...(context ? { context } : {}),
                headSelector: "",
                state: "all",
                limit: PAGE_LIMIT,
              })
              .pipe(
                Effect.flatMap((changeRequests) =>
                  Effect.forEach(
                    changeRequests,
                    (changeRequest) =>
                      Effect.forEach(
                        projects,
                        (member) => {
                          const normalized = normalizeProviderPullRequest({
                            environmentId: deps.environmentId,
                            projectId: member.id,
                            cwd: member.workspaceRoot,
                            repositoryIdentity: member.repositoryIdentity!,
                            provider: provider.kind,
                            changeRequest,
                            observedAt: now,
                            refreshGeneration: generation,
                          });
                          return Effect.all(
                            [
                              deps.dispatchCommand({
                                type: "pull-request.observe",
                                commandId: deps.serverCommandId("pull-request-observe"),
                                pullRequestId: normalized.record.identity.id,
                                record: normalized.record,
                                accessTarget: normalized.accessTarget,
                                occurredAt: DateTime.formatIso(now),
                              }),
                              recordKnownRelationships({
                                shell,
                                projectId: member.id,
                                pullRequestId: normalized.record.identity.id,
                                number: normalized.record.identity.number,
                                headRefName: normalized.record.headRefName,
                                now,
                                dispatchCommand: deps.dispatchCommand,
                                serverCommandId: deps.serverCommandId,
                              }),
                            ],
                            { discard: true },
                          );
                        },
                        { concurrency: 4, discard: true },
                      ),
                    { concurrency: 8, discard: true },
                  ).pipe(
                    Effect.andThen(
                      reconcileCurrentBranchRelationships({
                        shell,
                        repositoryCanonicalKey: identity.canonicalKey,
                        now,
                        projection: deps.projection,
                        dispatchCommand: deps.dispatchCommand,
                        serverCommandId: deps.serverCommandId,
                      }),
                    ),
                    Effect.tap(() =>
                      Effect.sync(() => {
                        deps.coverageByRepository.set(identity.canonicalKey, {
                          environmentId: deps.environmentId,
                          repository,
                          state: changeRequests.length >= PAGE_LIMIT ? "partial" : "complete",
                          fetched: changeRequests.length,
                          capped: changeRequests.length >= PAGE_LIMIT,
                          lastSuccessAt: Option.some(now),
                          ...(changeRequests.length >= PAGE_LIMIT
                            ? { message: `Showing the first ${PAGE_LIMIT} pull requests.` }
                            : {}),
                        });
                      }),
                    ),
                  ),
                ),
              ),
          ),
          Effect.catch((error) =>
            Effect.sync(() => {
              const detail =
                typeof error === "object" && error !== null && "detail" in error
                  ? String(error.detail)
                  : "Repository refresh failed.";
              deps.coverageByRepository.set(identity.canonicalKey, {
                environmentId: deps.environmentId,
                repository,
                state: "failed",
                fetched: 0,
                capped: false,
                lastSuccessAt: Option.none(),
                message: detail,
              });
            }),
          ),
        );
      },
      { concurrency: REPOSITORY_CONCURRENCY, discard: true },
    );
    const snapshot = yield* deps.projection.listInbox(deps.viewerKey);
    return {
      ...snapshot,
      generation,
      coverage: [...deps.coverageByRepository.values()],
      lastSuccessAt: Option.some(now),
    } satisfies PullRequestInboxSnapshot;
  });
}
