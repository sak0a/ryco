import { createHash } from "node:crypto";

import { DateTime, Effect, FileSystem, Layer, Option, Result, Schema } from "effect";
import {
  SourceControlProviderError,
  truncateSourceControlDetailContent,
  type ChangeRequest,
  type ChangeRequestState,
  type SourceControlChangeRequestDetail,
  type SourceControlIssueComment,
  type SourceControlIssueDetail,
  type SourceControlIssueSummary,
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
    readonly author: string;
    readonly body: string;
    readonly createdAt: string;
    readonly authorAssociation?: string;
    readonly reviewState?: SourceControlIssueComment["reviewState"];
  },
  context: {
    readonly itemAuthor: string | null | undefined;
    readonly repositoryOwner: string | null;
  },
): SourceControlIssueComment {
  return {
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
      return github
        .execute({
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
            "number,title,url,baseRefName,headRefName,state,mergedAt,updatedAt,isCrossRepository,isDraft,author,assignees,labels,comments,headRepository,headRepositoryOwner",
          ],
        })
        .pipe(
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
  });
});

export const layer = Layer.effect(SourceControlProvider.SourceControlProvider, make());
