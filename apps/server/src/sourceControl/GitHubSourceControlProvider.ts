import { createHash } from "node:crypto";

import { DateTime, Effect, FileSystem, Layer, Option, Result, Schema } from "effect";
import {
  SourceControlProviderError,
  SOURCE_CONTROL_WORKFLOW_LOG_MAX_BYTES,
  truncateSourceControlDetailContent,
  type ChangeRequest,
  type ChangeRequestState,
  type SourceControlChangeRequestDetail,
  type SourceControlIssueComment,
  type SourceControlIssueDetail,
  type SourceControlIssueSummary,
  type SourceControlWorkflowJob,
  type SourceControlWorkflowJobLogResult,
  type SourceControlWorkflowRerunResult,
  type SourceControlWorkflowRun,
  type SourceControlWorkflowRunJobsResult,
  type SourceControlWorkflowRunListResult,
  type SourceControlWorkflowStep,
} from "@ryco/contracts";
import {
  classifySourceControlCommentAuthorRole,
  parseGitHubRepositoryOwnerFromUrl,
} from "@ryco/shared/sourceControl";

import * as GitHubCli from "./GitHubCli.ts";
import * as GitHubIssues from "./gitHubIssues.ts";
import * as GitHubPullRequests from "./gitHubPullRequests.ts";
import * as SourceControlProvider from "./SourceControlProvider.ts";
export { githubDiscovery as discovery } from "./SourceControlProviderDiscoveryCatalog.ts";

function providerError(
  operation: string,
  cause: GitHubCli.GitHubCliError,
): SourceControlProviderError {
  return new SourceControlProviderError({
    provider: "github",
    operation,
    detail: cause.detail,
    cause,
  });
}

const RYCO_COMMENT_MARKER_PATTERN = /\n{0,2}<!-- ryco-comment-id:[a-f0-9]{64} -->\s*$/u;

function commentMutationMarker(clientMutationId: string): string {
  const hashed = createHash("sha256").update(clientMutationId).digest("hex");
  return `<!-- ryco-comment-id:${hashed} -->`;
}

function appendCommentMutationMarker(body: string, clientMutationId: string | undefined): string {
  if (clientMutationId === undefined) return body;
  return `${body.trimEnd()}\n\n${commentMutationMarker(clientMutationId)}`;
}

function stripCommentMutationMarker(body: string): string {
  return body.replace(RYCO_COMMENT_MARKER_PATTERN, "").trimEnd();
}

function hasCommentMutationMarker(
  comments: ReadonlyArray<{ readonly body: string }>,
  clientMutationId: string | undefined,
): boolean {
  if (clientMutationId === undefined) return false;
  const marker = commentMutationMarker(clientMutationId);
  return comments.some((comment) => comment.body.includes(marker));
}

function toChangeRequest(summary: GitHubCli.GitHubPullRequestSummary): ChangeRequest {
  return {
    provider: "github",
    number: summary.number,
    title: summary.title,
    url: summary.url,
    baseRefName: summary.baseRefName,
    headRefName: summary.headRefName,
    state: summary.state ?? "open",
    updatedAt: Option.none(),
    ...(summary.isCrossRepository !== undefined
      ? { isCrossRepository: summary.isCrossRepository }
      : {}),
    ...(summary.isDraft !== undefined ? { isDraft: summary.isDraft } : {}),
    ...(summary.author ? { author: summary.author } : {}),
    ...(summary.assignees && summary.assignees.length > 0 ? { assignees: summary.assignees } : {}),
    ...(summary.labels && summary.labels.length > 0 ? { labels: summary.labels } : {}),
    ...(typeof summary.commentsCount === "number" ? { commentsCount: summary.commentsCount } : {}),
    ...(summary.headRepositoryNameWithOwner !== undefined
      ? { headRepositoryNameWithOwner: summary.headRepositoryNameWithOwner }
      : {}),
    ...(summary.headRepositoryOwnerLogin !== undefined
      ? { headRepositoryOwnerLogin: summary.headRepositoryOwnerLogin }
      : {}),
    ...(summary.headSha ? { headSha: summary.headSha } : {}),
    ...(summary.mergeability ? { mergeability: summary.mergeability } : {}),
    ...(summary.checkRollup ? { checkRollup: summary.checkRollup } : {}),
  };
}

function toIssueSummary(raw: GitHubIssues.NormalizedGitHubIssueRecord): SourceControlIssueSummary {
  return {
    provider: "github",
    number: raw.number,
    title: raw.title,
    url: raw.url,
    state: raw.state,
    ...(raw.author ? { author: raw.author } : {}),
    updatedAt: raw.updatedAt.pipe(Option.map((s) => DateTime.fromDateUnsafe(new Date(s)))),
    labels: raw.labels,
    ...(raw.assignees.length > 0 ? { assignees: raw.assignees } : {}),
    ...(typeof raw.commentsCount === "number" ? { commentsCount: raw.commentsCount } : {}),
  };
}

function toSourceControlComment(
  raw: {
    readonly id?: string;
    readonly author: string;
    readonly body: string;
    readonly createdAt: string;
    readonly authorAssociation?: string;
    readonly reviewState?: SourceControlIssueComment["reviewState"];
    readonly reactions?: SourceControlIssueComment["reactions"];
  },
  context: {
    readonly itemAuthor: string | null | undefined;
    readonly repositoryOwner: string | null;
  },
): SourceControlIssueComment {
  return {
    ...(raw.id ? { id: raw.id } : {}),
    author: raw.author,
    body: stripCommentMutationMarker(raw.body),
    createdAt: DateTime.fromDateUnsafe(new Date(raw.createdAt)),
    ...(raw.authorAssociation ? { authorAssociation: raw.authorAssociation } : {}),
    authorRole: classifySourceControlCommentAuthorRole({
      commentAuthor: raw.author,
      itemAuthor: context.itemAuthor,
      repositoryOwner: context.repositoryOwner,
      authorAssociation: raw.authorAssociation,
    }),
    ...(raw.reviewState ? { reviewState: raw.reviewState } : {}),
    ...(raw.reactions && raw.reactions.length > 0 ? { reactions: raw.reactions } : {}),
  };
}

function toIssueDetail(
  raw: GitHubIssues.NormalizedGitHubIssueDetail,
  options: { readonly fullContent: boolean },
): SourceControlIssueDetail {
  const comments = raw.comments.map((comment) => ({
    ...comment,
    body: stripCommentMutationMarker(comment.body),
  }));
  const content = options.fullContent
    ? { body: raw.body, comments, truncated: false }
    : truncateSourceControlDetailContent({ body: raw.body, comments });
  const repositoryOwner = parseGitHubRepositoryOwnerFromUrl(raw.url);
  return {
    ...toIssueSummary(raw),
    body: content.body,
    comments: content.comments.map((c) =>
      toSourceControlComment(c, { itemAuthor: raw.author, repositoryOwner }),
    ),
    truncated: content.truncated,
  };
}

function toChangeRequestDetail(
  raw: GitHubCli.GitHubPullRequestDetail,
  options: { readonly fullContent: boolean },
): SourceControlChangeRequestDetail {
  const comments = raw.comments.map((comment) => ({
    ...comment,
    body: stripCommentMutationMarker(comment.body),
  }));
  const content = options.fullContent
    ? { body: raw.body, comments, truncated: false }
    : truncateSourceControlDetailContent({ body: raw.body, comments });
  const repositoryOwner = parseGitHubRepositoryOwnerFromUrl(raw.url);
  return {
    ...toChangeRequest(raw),
    body: content.body,
    comments: content.comments.map((c) =>
      toSourceControlComment(c, { itemAuthor: raw.author, repositoryOwner }),
    ),
    truncated: content.truncated,
    ...(raw.linkedIssueNumbers.length > 0 ? { linkedIssueNumbers: raw.linkedIssueNumbers } : {}),
    ...(raw.reviewers && raw.reviewers.length > 0 ? { reviewers: raw.reviewers } : {}),
    ...(raw.commits && raw.commits.length > 0 ? { commits: raw.commits } : {}),
    ...(typeof raw.additions === "number" ? { additions: raw.additions } : {}),
    ...(typeof raw.deletions === "number" ? { deletions: raw.deletions } : {}),
    ...(typeof raw.changedFiles === "number" ? { changedFiles: raw.changedFiles } : {}),
    ...(raw.files && raw.files.length > 0 ? { files: raw.files } : {}),
  };
}

function optionFromString(value: string | null | undefined): Option.Option<string> {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? Option.some(trimmed) : Option.none();
}

function dateTimeOption(value: string | null | undefined): Option.Option<DateTime.Utc> {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length === 0) return Option.none();
  const date = new Date(trimmed);
  if (!Number.isFinite(date.getTime())) return Option.none();
  return Option.some(DateTime.fromDateUnsafe(date));
}

function durationMsOption(
  startedAt: string | null | undefined,
  finishedAt: string | null | undefined,
): Option.Option<number> {
  const started = startedAt ? new Date(startedAt) : null;
  const finished = finishedAt ? new Date(finishedAt) : null;
  if (
    started === null ||
    finished === null ||
    !Number.isFinite(started.getTime()) ||
    !Number.isFinite(finished.getTime())
  ) {
    return Option.none();
  }
  return Option.some(Math.max(0, finished.getTime() - started.getTime()));
}

function toWorkflowRun(raw: GitHubCli.GitHubWorkflowRun): SourceControlWorkflowRun {
  return {
    provider: "github",
    runId: raw.runId,
    workflowName: raw.workflowName,
    ...(raw.displayTitle ? { displayTitle: raw.displayTitle } : {}),
    branch: optionFromString(raw.branch),
    ...(raw.event ? { event: raw.event } : {}),
    commit: raw.commit,
    actor: optionFromString(raw.actor),
    status: raw.status,
    conclusion: optionFromString(raw.conclusion),
    startedAt: dateTimeOption(raw.startedAt),
    updatedAt: dateTimeOption(raw.updatedAt),
    durationMs: durationMsOption(raw.startedAt, raw.updatedAt),
    url: raw.url,
  };
}

function toWorkflowStep(
  raw: GitHubCli.GitHubWorkflowJob["steps"][number],
): SourceControlWorkflowStep {
  return {
    number: Math.max(0, Math.trunc(raw.number)),
    name: raw.name,
    status: raw.status,
    conclusion: optionFromString(raw.conclusion),
    startedAt: dateTimeOption(raw.startedAt),
    completedAt: dateTimeOption(raw.completedAt),
    durationMs: durationMsOption(raw.startedAt, raw.completedAt),
  };
}

function toWorkflowJob(raw: GitHubCli.GitHubWorkflowJob): SourceControlWorkflowJob {
  return {
    jobId: raw.jobId,
    name: raw.name,
    status: raw.status,
    conclusion: optionFromString(raw.conclusion),
    startedAt: dateTimeOption(raw.startedAt),
    completedAt: dateTimeOption(raw.completedAt),
    durationMs: durationMsOption(raw.startedAt, raw.completedAt),
    url: optionFromString(raw.url),
    steps: raw.steps.map(toWorkflowStep),
  };
}

function truncateWorkflowLog(
  log: string,
): Pick<SourceControlWorkflowJobLogResult, "log" | "truncated"> {
  if (Buffer.byteLength(log, "utf8") <= SOURCE_CONTROL_WORKFLOW_LOG_MAX_BYTES) {
    return { log, truncated: false };
  }
  const buffer = Buffer.from(log, "utf8").subarray(0, SOURCE_CONTROL_WORKFLOW_LOG_MAX_BYTES);
  return { log: buffer.toString("utf8"), truncated: true };
}

export const make = Effect.fn("makeGitHubSourceControlProvider")(function* () {
  const github = yield* GitHubCli.GitHubCli;
  const fileSystem = yield* FileSystem.FileSystem;

  const withTempBodyFile = <A>(
    input: {
      readonly operation: string;
      readonly prefix: string;
      readonly body: string;
    },
    useBodyFile: (bodyFile: string) => Effect.Effect<A, SourceControlProviderError>,
  ) =>
    Effect.gen(function* () {
      const bodyFile = yield* fileSystem.makeTempFile({ prefix: input.prefix, suffix: ".md" }).pipe(
        Effect.mapError(
          (cause) =>
            new SourceControlProviderError({
              provider: "github",
              operation: input.operation,
              detail: "Failed to create temp file for GitHub body.",
              cause,
            }),
        ),
      );
      const work = Effect.gen(function* () {
        yield* fileSystem.writeFileString(bodyFile, input.body).pipe(
          Effect.mapError(
            (cause) =>
              new SourceControlProviderError({
                provider: "github",
                operation: input.operation,
                detail: "Failed to write GitHub body temp file.",
                cause,
              }),
          ),
        );
        return yield* useBodyFile(bodyFile);
      });
      return yield* work.pipe(
        Effect.ensuring(fileSystem.remove(bodyFile).pipe(Effect.catch(() => Effect.void))),
      );
    });

  const listChangeRequests: SourceControlProvider.SourceControlProviderShape["listChangeRequests"] =
    (input) => {
      const headSelector = input.headSelector.trim();
      if (input.state === "open" && headSelector.length > 0) {
        return github
          .listOpenPullRequests({
            cwd: input.cwd,
            headSelector,
            ...(input.limit !== undefined ? { limit: input.limit } : {}),
          })
          .pipe(
            Effect.map((items) => items.map(toChangeRequest)),
            Effect.mapError((error) => providerError("listChangeRequests", error)),
          );
      }

      const stateArg: ChangeRequestState | "all" = input.state;
      const executeListChangeRequests = (jsonFields: ReadonlyArray<string>) =>
        github.execute({
          cwd: input.cwd,
          args: [
            "pr",
            "list",
            ...(headSelector.length > 0 ? ["--head", headSelector] : []),
            "--state",
            stateArg,
            "--limit",
            String(input.limit ?? 20),
            "--json",
            GitHubCli.formatGitHubJsonFields(jsonFields),
          ],
        });

      return executeListChangeRequests(GitHubCli.GITHUB_PULL_REQUEST_LIST_JSON_FIELDS).pipe(
        Effect.catchIf(GitHubCli.isStatusCheckRollupAccessError, () =>
          executeListChangeRequests(
            GitHubCli.withoutStatusCheckRollupJsonField(
              GitHubCli.GITHUB_PULL_REQUEST_LIST_JSON_FIELDS,
            ),
          ),
        ),
        Effect.flatMap((result) => {
          const raw = result.stdout.trim();
          if (raw.length === 0) {
            return Effect.succeed([]);
          }
          return Effect.sync(() => GitHubPullRequests.decodeGitHubPullRequestListJson(raw)).pipe(
            Effect.flatMap((decoded) =>
              Result.isSuccess(decoded)
                ? Effect.succeed(
                    decoded.success.map((item) => ({
                      ...toChangeRequest(item),
                      updatedAt: item.updatedAt,
                    })),
                  )
                : Effect.fail(
                    new SourceControlProviderError({
                      provider: "github",
                      operation: "listChangeRequests",
                      detail: "GitHub CLI returned invalid change request JSON.",
                      cause: decoded.failure,
                    }),
                  ),
            ),
          );
        }),
        Effect.mapError((error) =>
          Schema.is(SourceControlProviderError)(error)
            ? error
            : providerError("listChangeRequests", error),
        ),
      );
    };

  return SourceControlProvider.SourceControlProvider.of({
    kind: "github",
    listChangeRequests,
    getChangeRequest: (input) =>
      github.getPullRequest(input).pipe(
        Effect.map(toChangeRequest),
        Effect.mapError((error) => providerError("getChangeRequest", error)),
      ),
    createChangeRequest: (input) =>
      github
        .createPullRequest({
          cwd: input.cwd,
          baseBranch: input.baseRefName,
          headSelector: input.headSelector,
          title: input.title,
          bodyFile: input.bodyFile,
        })
        .pipe(Effect.mapError((error) => providerError("createChangeRequest", error))),
    getRepositoryCloneUrls: (input) =>
      github
        .getRepositoryCloneUrls(input)
        .pipe(Effect.mapError((error) => providerError("getRepositoryCloneUrls", error))),
    createRepository: (input) =>
      github
        .createRepository(input)
        .pipe(Effect.mapError((error) => providerError("createRepository", error))),
    getDefaultBranch: (input) =>
      github
        .getDefaultBranch(input)
        .pipe(Effect.mapError((error) => providerError("getDefaultBranch", error))),
    checkoutChangeRequest: (input) =>
      github
        .checkoutPullRequest(input)
        .pipe(Effect.mapError((error) => providerError("checkoutChangeRequest", error))),
    listIssues: (input) =>
      github
        .listIssues({
          cwd: input.cwd,
          state: input.state,
          ...(input.limit !== undefined ? { limit: input.limit } : {}),
        })
        .pipe(
          Effect.map((items) => items.map(toIssueSummary)),
          Effect.mapError((error) => providerError("listIssues", error)),
        ),
    getIssue: (input) =>
      github.getIssue({ cwd: input.cwd, reference: input.reference }).pipe(
        Effect.map((raw) => toIssueDetail(raw, { fullContent: input.fullContent ?? false })),
        Effect.mapError((error) => providerError("getIssue", error)),
      ),
    addIssueComment: (input) =>
      Effect.gen(function* () {
        const existing = input.clientMutationId
          ? yield* github
              .getIssue({ cwd: input.cwd, reference: input.reference })
              .pipe(Effect.mapError((error) => providerError("addIssueComment", error)))
          : null;
        if (existing && hasCommentMutationMarker(existing.comments, input.clientMutationId)) {
          return toIssueDetail(existing, { fullContent: true });
        }

        yield* withTempBodyFile(
          {
            operation: "addIssueComment",
            prefix: "ryco-gh-comment-body-",
            body: appendCommentMutationMarker(input.body, input.clientMutationId),
          },
          (bodyFile) =>
            github
              .addIssueComment({
                cwd: input.cwd,
                reference: input.reference,
                bodyFile,
              })
              .pipe(Effect.mapError((error) => providerError("addIssueComment", error))),
        );
        const updated = yield* github
          .getIssue({ cwd: input.cwd, reference: input.reference })
          .pipe(Effect.mapError((error) => providerError("addIssueComment", error)));
        return toIssueDetail(updated, { fullContent: true });
      }),
    addIssueCommentReaction: (input) =>
      Effect.gen(function* () {
        const reactionGroups = yield* github
          .getCommentReactionGroups({ cwd: input.cwd, commentIds: [input.commentId] })
          .pipe(Effect.mapError((error) => providerError("addIssueCommentReaction", error)));
        const viewerHasReacted =
          reactionGroups
            .find((group) => group.id === input.commentId)
            ?.reactions.find((reaction) => reaction.content === input.content)?.viewerHasReacted ===
          true;
        const reactionMutation = viewerHasReacted ? github.removeReaction : github.addReaction;
        yield* reactionMutation({
          cwd: input.cwd,
          subjectId: input.commentId,
          content: input.content,
        }).pipe(Effect.mapError((error) => providerError("addIssueCommentReaction", error)));
        const updated = yield* github
          .getIssue({ cwd: input.cwd, reference: input.reference })
          .pipe(Effect.mapError((error) => providerError("addIssueCommentReaction", error)));
        return toIssueDetail(updated, { fullContent: true });
      }),
    searchIssues: (input) =>
      github
        .searchIssues({
          cwd: input.cwd,
          query: input.query,
          ...(input.limit !== undefined ? { limit: input.limit } : {}),
        })
        .pipe(
          Effect.map((items) => items.map(toIssueSummary)),
          Effect.mapError((error) => providerError("searchIssues", error)),
        ),
    searchChangeRequests: (input) =>
      github
        .searchPullRequests({
          cwd: input.cwd,
          query: input.query,
          ...(input.limit !== undefined ? { limit: input.limit } : {}),
        })
        .pipe(
          Effect.map((items) => items.map(toChangeRequest)),
          Effect.mapError((error) => providerError("searchChangeRequests", error)),
        ),
    getChangeRequestDetail: (input) =>
      github.getPullRequestDetail({ cwd: input.cwd, reference: input.reference }).pipe(
        Effect.map((raw) =>
          toChangeRequestDetail(raw, { fullContent: input.fullContent ?? false }),
        ),
        Effect.mapError((error) => providerError("getChangeRequestDetail", error)),
      ),
    addChangeRequestComment: (input) =>
      Effect.gen(function* () {
        const existing = input.clientMutationId
          ? yield* github
              .getPullRequestDetail({ cwd: input.cwd, reference: input.reference })
              .pipe(Effect.mapError((error) => providerError("addChangeRequestComment", error)))
          : null;
        if (existing && hasCommentMutationMarker(existing.comments, input.clientMutationId)) {
          return toChangeRequestDetail(existing, { fullContent: true });
        }

        yield* withTempBodyFile(
          {
            operation: "addChangeRequestComment",
            prefix: "ryco-gh-comment-body-",
            body: appendCommentMutationMarker(input.body, input.clientMutationId),
          },
          (bodyFile) =>
            github
              .addPullRequestComment({
                cwd: input.cwd,
                reference: input.reference,
                bodyFile,
              })
              .pipe(Effect.mapError((error) => providerError("addChangeRequestComment", error))),
        );
        const updated = yield* github
          .getPullRequestDetail({ cwd: input.cwd, reference: input.reference })
          .pipe(Effect.mapError((error) => providerError("addChangeRequestComment", error)));
        return toChangeRequestDetail(updated, { fullContent: true });
      }),
    addChangeRequestCommentReaction: (input) =>
      Effect.gen(function* () {
        const reactionGroups = yield* github
          .getCommentReactionGroups({ cwd: input.cwd, commentIds: [input.commentId] })
          .pipe(
            Effect.mapError((error) => providerError("addChangeRequestCommentReaction", error)),
          );
        const viewerHasReacted =
          reactionGroups
            .find((group) => group.id === input.commentId)
            ?.reactions.find((reaction) => reaction.content === input.content)?.viewerHasReacted ===
          true;
        const reactionMutation = viewerHasReacted ? github.removeReaction : github.addReaction;
        yield* reactionMutation({
          cwd: input.cwd,
          subjectId: input.commentId,
          content: input.content,
        }).pipe(
          Effect.mapError((error) => providerError("addChangeRequestCommentReaction", error)),
        );
        const updated = yield* github
          .getPullRequestDetail({ cwd: input.cwd, reference: input.reference })
          .pipe(
            Effect.mapError((error) => providerError("addChangeRequestCommentReaction", error)),
          );
        return toChangeRequestDetail(updated, { fullContent: true });
      }),
    getChangeRequestDiff: (input) =>
      github
        .getPullRequestDiff({ cwd: input.cwd, reference: input.reference })
        .pipe(Effect.mapError((error) => providerError("getChangeRequestDiff", error))),
    createIssue: (input) =>
      withTempBodyFile(
        {
          operation: "createIssue",
          prefix: "ryco-gh-issue-body-",
          body: input.body,
        },
        (bodyFile) =>
          Effect.gen(function* () {
            const created = yield* github
              .createIssue({
                cwd: input.cwd,
                title: input.title,
                bodyFile,
                ...(input.labels ? { labels: input.labels } : {}),
                ...(input.assignees ? { assignees: input.assignees } : {}),
              })
              .pipe(Effect.mapError((cause) => providerError("createIssue", cause)));
            const detail = yield* github
              .getIssue({ cwd: input.cwd, reference: String(created.number) })
              .pipe(
                Effect.mapError((cause) => providerError("createIssue", cause)),
                Effect.catch(() =>
                  Effect.succeed({
                    provider: "github",
                    number: created.number,
                    title: input.title,
                    url: created.url,
                    state: "open" as const,
                    updatedAt: Option.none(),
                  } satisfies SourceControlIssueSummary),
                ),
              );
            if ("body" in detail) {
              return toIssueSummary(detail);
            }
            return detail;
          }),
      ),
    listLabels: (input) =>
      github
        .listLabels({ cwd: input.cwd })
        .pipe(Effect.mapError((cause) => providerError("listLabels", cause))),
    listAssignees: (input) =>
      github.listAssignees({ cwd: input.cwd }).pipe(
        Effect.map((users) =>
          users.map((u) => ({
            login: u.login,
            ...(u.name ? { displayName: u.name } : {}),
            ...(u.avatarUrl ? { avatarUrl: u.avatarUrl } : {}),
          })),
        ),
        Effect.mapError((cause) => providerError("listAssignees", cause)),
      ),
    getPullRequestState: (input) =>
      github.getPullRequest({ cwd: input.cwd, reference: String(input.number) }).pipe(
        Effect.map((summary) => ({
          state: summary.state ?? "open",
          isDraft: summary.isDraft ?? false,
        })),
        Effect.mapError((cause) => providerError("getPullRequestState", cause)),
      ),
    getIssueState: (input) =>
      github.getIssue({ cwd: input.cwd, reference: String(input.number) }).pipe(
        Effect.map((detail) => ({ state: detail.state })),
        Effect.mapError((cause) => providerError("getIssueState", cause)),
      ),
    listWorkflowRuns: (input) =>
      Effect.gen(function* () {
        let repositoryNameWithOwner: string | null = null;
        let headSha: string | null = input.commitSha?.trim() || null;

        if (input.pullRequestNumber !== undefined && headSha === null) {
          const context = yield* github.getPullRequestWorkflowContext({
            cwd: input.cwd,
            reference: String(input.pullRequestNumber),
          });
          repositoryNameWithOwner =
            context.baseRepositoryNameWithOwner ?? context.headRepositoryNameWithOwner;
          headSha = context.headSha;
        }

        const runs = yield* github.listWorkflowRuns({
          cwd: input.cwd,
          ...(headSha ? { headSha } : {}),
          ...(input.limit !== undefined ? { limit: input.limit } : {}),
        });
        repositoryNameWithOwner =
          repositoryNameWithOwner ??
          runs.find((run) => run.repositoryNameWithOwner !== null)?.repositoryNameWithOwner ??
          null;

        return {
          provider: "github",
          repository: optionFromString(repositoryNameWithOwner),
          pullRequestNumber:
            input.pullRequestNumber !== undefined
              ? Option.some(input.pullRequestNumber)
              : Option.none(),
          headSha: optionFromString(headSha),
          runs: runs.map(toWorkflowRun),
        } satisfies SourceControlWorkflowRunListResult;
      }).pipe(Effect.mapError((cause) => providerError("listWorkflowRuns", cause))),
    getWorkflowRunJobs: (input) =>
      github.listWorkflowRunJobs({ cwd: input.cwd, runId: input.runId }).pipe(
        Effect.map(
          (jobs) =>
            ({
              provider: "github",
              runId: input.runId,
              jobs: jobs.map(toWorkflowJob),
            }) satisfies SourceControlWorkflowRunJobsResult,
        ),
        Effect.mapError((cause) => providerError("getWorkflowRunJobs", cause)),
      ),
    getWorkflowJobLog: (input) =>
      github.getWorkflowJobLog(input).pipe(
        Effect.map((log) => {
          const truncated = truncateWorkflowLog(log);
          return {
            provider: "github",
            runId: input.runId,
            jobId: input.jobId,
            ...truncated,
          } satisfies SourceControlWorkflowJobLogResult;
        }),
        Effect.mapError((cause) => providerError("getWorkflowJobLog", cause)),
      ),
    rerunWorkflow: (input) =>
      Effect.gen(function* () {
        if (input.target === "job") {
          yield* github.rerunWorkflowJob({ cwd: input.cwd, jobId: input.jobId });
          return {
            provider: "github",
            runId: input.runId,
            target: "job",
            jobId: input.jobId,
          } satisfies SourceControlWorkflowRerunResult;
        }

        yield* github.rerunFailedWorkflowJobs({ cwd: input.cwd, runId: input.runId });
        return {
          provider: "github",
          runId: input.runId,
          target: "failed-jobs",
        } satisfies SourceControlWorkflowRerunResult;
      }).pipe(Effect.mapError((cause) => providerError("rerunWorkflow", cause))),
  });
});

export const layer = Layer.effect(SourceControlProvider.SourceControlProvider, make());
