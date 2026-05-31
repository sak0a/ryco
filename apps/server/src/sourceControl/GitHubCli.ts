import { Context, Effect, Layer, Result, Schema, SchemaIssue } from "effect";

import {
  TrimmedNonEmptyString,
  type SourceControlRepositoryVisibility,
  type VcsError,
} from "@ryco/contracts";
import { formatSchemaError } from "@ryco/shared/schemaJson";

import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as GitHubIssues from "./gitHubIssues.ts";
import type { NormalizedGitHubIssueDetail, NormalizedGitHubIssueRecord } from "./gitHubIssues.ts";
import * as GitHubActions from "./gitHubActions.ts";
import { buildGitHubIssueCreateArgv, parseGitHubIssueCreateOutput } from "./gitHubIssueCreate.ts";
import * as GitHubPullRequests from "./gitHubPullRequests.ts";

const DEFAULT_TIMEOUT_MS = 30_000;

export class GitHubCliError extends Schema.TaggedErrorClass<GitHubCliError>()("GitHubCliError", {
  operation: Schema.String,
  detail: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {
  override get message(): string {
    return `GitHub CLI failed in ${this.operation}: ${this.detail}`;
  }
}

export interface GitHubLabel {
  readonly name: string;
  readonly color?: string;
  readonly description?: string;
}

export interface GitHubPullRequestSummary {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly baseRefName: string;
  readonly headRefName: string;
  readonly state?: "open" | "closed" | "merged";
  readonly isCrossRepository?: boolean;
  readonly isDraft?: boolean;
  readonly author?: string | null;
  readonly assignees?: ReadonlyArray<string>;
  readonly labels?: ReadonlyArray<GitHubLabel>;
  readonly commentsCount?: number | null;
  readonly headRepositoryNameWithOwner?: string | null;
  readonly headRepositoryOwnerLogin?: string | null;
}

export interface GitHubPullRequestCommit {
  readonly oid: string;
  readonly shortOid: string;
  readonly messageHeadline: string;
  readonly committedDate?: string;
  readonly author?: string;
}

export type GitHubReviewState =
  | "approved"
  | "changes_requested"
  | "commented"
  | "dismissed"
  | "pending";

export interface GitHubPullRequestFile {
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
}

export interface GitHubPullRequestDetail extends GitHubPullRequestSummary {
  readonly body: string;
  readonly comments: ReadonlyArray<{
    readonly author: string;
    readonly body: string;
    readonly createdAt: string;
    readonly authorAssociation?: string;
    readonly reviewState?: GitHubReviewState;
  }>;
  readonly linkedIssueNumbers: ReadonlyArray<number>;
  readonly reviewers: ReadonlyArray<string>;
  readonly commits: ReadonlyArray<GitHubPullRequestCommit>;
  readonly additions: number;
  readonly deletions: number;
  readonly changedFiles: number;
  readonly files: ReadonlyArray<GitHubPullRequestFile>;
}

export interface GitHubRepositoryCloneUrls {
  readonly nameWithOwner: string;
  readonly url: string;
  readonly sshUrl: string;
}

export type GitHubWorkflowRun = GitHubActions.NormalizedGitHubWorkflowRun;
export type GitHubWorkflowJob = GitHubActions.NormalizedGitHubWorkflowJob;
export type GitHubPullRequestWorkflowContext =
  GitHubActions.NormalizedGitHubPullRequestWorkflowContext;

export interface GitHubCliShape {
  readonly execute: (input: {
    readonly cwd: string;
    readonly args: ReadonlyArray<string>;
    readonly timeoutMs?: number;
  }) => Effect.Effect<VcsProcess.VcsProcessOutput, GitHubCliError>;

  readonly listOpenPullRequests: (input: {
    readonly cwd: string;
    readonly headSelector: string;
    readonly limit?: number;
  }) => Effect.Effect<ReadonlyArray<GitHubPullRequestSummary>, GitHubCliError>;

  readonly getPullRequest: (input: {
    readonly cwd: string;
    readonly reference: string;
  }) => Effect.Effect<GitHubPullRequestSummary, GitHubCliError>;

  readonly getRepositoryCloneUrls: (input: {
    readonly cwd: string;
    readonly repository: string;
  }) => Effect.Effect<GitHubRepositoryCloneUrls, GitHubCliError>;

  readonly createRepository: (input: {
    readonly cwd: string;
    readonly repository: string;
    readonly visibility: SourceControlRepositoryVisibility;
  }) => Effect.Effect<GitHubRepositoryCloneUrls, GitHubCliError>;

  readonly createPullRequest: (input: {
    readonly cwd: string;
    readonly baseBranch: string;
    readonly headSelector: string;
    readonly title: string;
    readonly bodyFile: string;
  }) => Effect.Effect<void, GitHubCliError>;

  readonly getDefaultBranch: (input: {
    readonly cwd: string;
  }) => Effect.Effect<string | null, GitHubCliError>;

  readonly checkoutPullRequest: (input: {
    readonly cwd: string;
    readonly reference: string;
    readonly force?: boolean;
  }) => Effect.Effect<void, GitHubCliError>;

  readonly listIssues: (input: {
    readonly cwd: string;
    readonly state: "open" | "closed" | "all";
    readonly limit?: number;
  }) => Effect.Effect<ReadonlyArray<NormalizedGitHubIssueRecord>, GitHubCliError>;

  readonly getIssue: (input: {
    readonly cwd: string;
    readonly reference: string;
  }) => Effect.Effect<NormalizedGitHubIssueDetail, GitHubCliError>;

  readonly searchIssues: (input: {
    readonly cwd: string;
    readonly query: string;
    readonly limit?: number;
  }) => Effect.Effect<ReadonlyArray<NormalizedGitHubIssueRecord>, GitHubCliError>;

  readonly searchPullRequests: (input: {
    readonly cwd: string;
    readonly query: string;
    readonly limit?: number;
  }) => Effect.Effect<ReadonlyArray<GitHubPullRequestSummary>, GitHubCliError>;

  readonly getPullRequestDetail: (input: {
    readonly cwd: string;
    readonly reference: string;
  }) => Effect.Effect<GitHubPullRequestDetail, GitHubCliError>;

  readonly getPullRequestDiff: (input: {
    readonly cwd: string;
    readonly reference: string;
  }) => Effect.Effect<string, GitHubCliError>;

  readonly createIssue: (input: {
    readonly cwd: string;
    readonly title: string;
    readonly bodyFile: string;
    readonly labels?: ReadonlyArray<string>;
    readonly assignees?: ReadonlyArray<string>;
  }) => Effect.Effect<{ url: string; number: number }, GitHubCliError>;

  readonly addIssueComment: (input: {
    readonly cwd: string;
    readonly reference: string;
    readonly bodyFile: string;
  }) => Effect.Effect<void, GitHubCliError>;

  readonly addPullRequestComment: (input: {
    readonly cwd: string;
    readonly reference: string;
    readonly bodyFile: string;
  }) => Effect.Effect<void, GitHubCliError>;

  readonly listLabels: (input: {
    readonly cwd: string;
  }) => Effect.Effect<ReadonlyArray<GitHubLabel>, GitHubCliError>;

  readonly listAssignees: (input: {
    readonly cwd: string;
  }) => Effect.Effect<
    ReadonlyArray<{ login: string; name?: string | null; avatarUrl?: string | null }>,
    GitHubCliError
  >;

  readonly listWorkflowRuns: (input: {
    readonly cwd: string;
    readonly headSha?: string;
    readonly limit?: number;
  }) => Effect.Effect<ReadonlyArray<GitHubWorkflowRun>, GitHubCliError>;

  readonly getPullRequestWorkflowContext: (input: {
    readonly cwd: string;
    readonly reference: string;
  }) => Effect.Effect<GitHubPullRequestWorkflowContext, GitHubCliError>;

  readonly listWorkflowRunJobs: (input: {
    readonly cwd: string;
    readonly runId: string;
  }) => Effect.Effect<ReadonlyArray<GitHubWorkflowJob>, GitHubCliError>;

  readonly getWorkflowJobLog: (input: {
    readonly cwd: string;
    readonly runId: string;
    readonly jobId: string;
  }) => Effect.Effect<string, GitHubCliError>;

  readonly rerunFailedWorkflowJobs: (input: {
    readonly cwd: string;
    readonly runId: string;
  }) => Effect.Effect<void, GitHubCliError>;

  readonly rerunWorkflowJob: (input: {
    readonly cwd: string;
    readonly jobId: string;
  }) => Effect.Effect<void, GitHubCliError>;
}

export class GitHubCli extends Context.Service<GitHubCli, GitHubCliShape>()(
  "s3/source-control/GitHubCli",
) {}

function errorText(error: VcsError | unknown): string {
  if (typeof error === "object" && error !== null) {
    const tag = "_tag" in error && typeof error._tag === "string" ? error._tag : "";
    const detail = "detail" in error && typeof error.detail === "string" ? error.detail : "";
    const message = "message" in error && typeof error.message === "string" ? error.message : "";
    return [tag, detail, message].filter(Boolean).join("\n");
  }

  return String(error);
}

function normalizeGitHubCliError(
  operation: "execute" | "stdout",
  error: VcsError | unknown,
): GitHubCliError {
  const text = errorText(error);
  const lower = text.toLowerCase();

  if (lower.includes("command not found: gh") || lower.includes("enoent")) {
    return new GitHubCliError({
      operation,
      detail: "GitHub CLI (`gh`) is required but not available on PATH.",
      cause: error,
    });
  }

  if (
    lower.includes("authentication failed") ||
    lower.includes("not logged in") ||
    lower.includes("gh auth login") ||
    lower.includes("no oauth token")
  ) {
    return new GitHubCliError({
      operation,
      detail: "GitHub CLI is not authenticated. Run `gh auth login` and retry.",
      cause: error,
    });
  }

  if (
    lower.includes("api rate limit exceeded") ||
    lower.includes("secondary rate limit") ||
    lower.includes("rate limit")
  ) {
    return new GitHubCliError({
      operation,
      detail: "GitHub API rate limit exceeded. Wait for the reset window and retry.",
      cause: error,
    });
  }

  if (
    lower.includes("resource not accessible by integration") ||
    lower.includes("must have actions read permission") ||
    lower.includes("must have actions write permission") ||
    lower.includes("permission denied") ||
    lower.includes("forbidden") ||
    lower.includes("http 403")
  ) {
    return new GitHubCliError({
      operation,
      detail:
        "GitHub Actions is not accessible for this repository. Check token permissions, Actions write access for reruns, and repository Actions settings.",
      cause: error,
    });
  }

  if (
    lower.includes("http 410") ||
    lower.includes("gone") ||
    lower.includes("expired") ||
    lower.includes("logs are no longer available")
  ) {
    return new GitHubCliError({
      operation,
      detail: "GitHub Actions logs are no longer available for this run.",
      cause: error,
    });
  }

  if (
    lower.includes("http 422") ||
    lower.includes("unprocessable entity") ||
    lower.includes("cannot rerun") ||
    lower.includes("cannot re-run") ||
    lower.includes("no failed jobs")
  ) {
    return new GitHubCliError({
      operation,
      detail: "GitHub Actions cannot rerun this workflow run or job in its current state.",
      cause: error,
    });
  }

  if (
    lower.includes("could not resolve to a pullrequest") ||
    lower.includes("repository.pullrequest") ||
    lower.includes("no pull requests found for branch") ||
    lower.includes("pull request not found")
  ) {
    return new GitHubCliError({
      operation,
      detail: "Pull request not found. Check the PR number or URL and try again.",
      cause: error,
    });
  }

  if (
    lower.includes("not found") ||
    lower.includes("http 404") ||
    lower.includes("no workflow runs found")
  ) {
    return new GitHubCliError({
      operation,
      detail: "GitHub Actions run or repository was not found.",
      cause: error,
    });
  }

  return new GitHubCliError({
    operation,
    detail: text,
    cause: error,
  });
}

const RawGitHubRepositoryCloneUrlsSchema = Schema.Struct({
  nameWithOwner: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  sshUrl: TrimmedNonEmptyString,
});

function normalizeRepositoryCloneUrls(
  raw: Schema.Schema.Type<typeof RawGitHubRepositoryCloneUrlsSchema>,
): GitHubRepositoryCloneUrls {
  return {
    nameWithOwner: raw.nameWithOwner,
    url: raw.url,
    sshUrl: raw.sshUrl,
  };
}

/**
 * `gh repo create` prints the canonical URL of the new repository on stdout
 * (e.g. `https://github.com/owner/repo`). Reading it back here avoids a
 * follow-up `gh repo view`, which can race GitHub's GraphQL eventual
 * consistency window and falsely report the just-created repo as missing.
 */
function deriveRepositoryCloneUrlsFromCreateOutput(
  stdout: string,
  repository: string,
): GitHubRepositoryCloneUrls {
  const fallbackHost = "github.com";
  const match = stdout.match(/https?:\/\/[^\s]+/);
  if (match) {
    const cleaned = match[0].replace(/\.git$/, "");
    try {
      const parsed = new URL(cleaned);
      const pathname = parsed.pathname.replace(/^\/+|\/+$/g, "");
      const segments = pathname.split("/").filter(Boolean);
      if (segments.length === 2) {
        const nameWithOwner = `${segments[0]}/${segments[1]}`;
        return {
          nameWithOwner,
          url: `${parsed.origin}/${nameWithOwner}`,
          sshUrl: `git@${parsed.host}:${nameWithOwner}.git`,
        };
      }
    } catch {
      // Fall through to the input-derived defaults below.
    }
  }
  return {
    nameWithOwner: repository,
    url: `https://${fallbackHost}/${repository}`,
    sshUrl: `git@${fallbackHost}:${repository}.git`,
  };
}

function decodeGitHubJson<S extends Schema.Top>(
  raw: string,
  schema: S,
  operation: "listOpenPullRequests" | "getPullRequest" | "getRepositoryCloneUrls",
  invalidDetail: string,
): Effect.Effect<S["Type"], GitHubCliError, S["DecodingServices"]> {
  return Schema.decodeEffect(Schema.fromJsonString(schema))(raw).pipe(
    Effect.mapError(
      (error) =>
        new GitHubCliError({
          operation,
          detail: `${invalidDetail}: ${SchemaIssue.makeFormatterDefault()(error.issue)}`,
          cause: error,
        }),
    ),
  );
}

function workflowRunLimit(limit: number | undefined): number {
  const value = Math.trunc(limit ?? 20);
  if (!Number.isFinite(value)) return 20;
  return Math.min(50, Math.max(1, value));
}

function workflowRunsEndpoint(input: { readonly headSha?: string; readonly limit?: number }) {
  const params = new URLSearchParams();
  params.set("per_page", String(workflowRunLimit(input.limit)));
  if (input.headSha?.trim()) {
    params.set("head_sha", input.headSha.trim());
  }
  return `repos/{owner}/{repo}/actions/runs?${params.toString()}`;
}

function withGitHubCliOperation<A>(
  operation: string,
  effect: Effect.Effect<A, GitHubCliError>,
): Effect.Effect<A, GitHubCliError> {
  return effect.pipe(
    Effect.mapError(
      (error) =>
        new GitHubCliError({
          operation,
          detail: error.detail,
          cause: error,
        }),
    ),
  );
}

function pullRequestApiReference(reference: string): string {
  const trimmed = reference.trim();
  if (/^\d+$/u.test(trimmed)) return trimmed;

  try {
    const url = new URL(trimmed);
    const match = /\/pull\/(\d+)(?:\/|$)/u.exec(url.pathname);
    if (match?.[1]) return match[1];
  } catch {
    // Fall through to the original input. GitHub will return a useful error.
  }

  return trimmed;
}

export const make = Effect.fn("makeGitHubCli")(function* () {
  const process = yield* VcsProcess.VcsProcess;

  const execute: GitHubCliShape["execute"] = (input) =>
    process
      .run({
        operation: "GitHubCli.execute",
        command: "gh",
        args: input.args,
        cwd: input.cwd,
        timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      })
      .pipe(Effect.mapError((error) => normalizeGitHubCliError("execute", error)));

  return GitHubCli.of({
    execute,
    listOpenPullRequests: (input) =>
      execute({
        cwd: input.cwd,
        args: [
          "pr",
          "list",
          "--head",
          input.headSelector,
          "--state",
          "open",
          "--limit",
          String(input.limit ?? 1),
          "--json",
          "number,title,url,baseRefName,headRefName,state,mergedAt,isCrossRepository,isDraft,author,assignees,labels,comments,headRepository,headRepositoryOwner",
        ],
      }).pipe(
        Effect.map((result) => result.stdout.trim()),
        Effect.flatMap((raw) =>
          raw.length === 0
            ? Effect.succeed([])
            : Effect.sync(() => GitHubPullRequests.decodeGitHubPullRequestListJson(raw)).pipe(
                Effect.flatMap((decoded) => {
                  if (!Result.isSuccess(decoded)) {
                    return Effect.fail(
                      new GitHubCliError({
                        operation: "listOpenPullRequests",
                        detail: `GitHub CLI returned invalid PR list JSON: ${GitHubPullRequests.formatGitHubJsonDecodeError(decoded.failure)}`,
                        cause: decoded.failure,
                      }),
                    );
                  }

                  return Effect.succeed(
                    decoded.success.map(({ updatedAt: _updatedAt, ...summary }) => summary),
                  );
                }),
              ),
        ),
      ),
    getPullRequest: (input) =>
      execute({
        cwd: input.cwd,
        args: [
          "pr",
          "view",
          input.reference,
          "--json",
          "number,title,url,baseRefName,headRefName,state,mergedAt,isCrossRepository,isDraft,author,assignees,labels,comments,headRepository,headRepositoryOwner",
        ],
      }).pipe(
        Effect.map((result) => result.stdout.trim()),
        Effect.flatMap((raw) =>
          Effect.sync(() => GitHubPullRequests.decodeGitHubPullRequestJson(raw)).pipe(
            Effect.flatMap((decoded) => {
              if (!Result.isSuccess(decoded)) {
                return Effect.fail(
                  new GitHubCliError({
                    operation: "getPullRequest",
                    detail: `GitHub CLI returned invalid pull request JSON: ${GitHubPullRequests.formatGitHubJsonDecodeError(decoded.failure)}`,
                    cause: decoded.failure,
                  }),
                );
              }

              return Effect.succeed(
                (({ updatedAt: _updatedAt, ...summary }) => summary)(decoded.success),
              );
            }),
          ),
        ),
      ),
    getRepositoryCloneUrls: (input) =>
      execute({
        cwd: input.cwd,
        args: ["repo", "view", input.repository, "--json", "nameWithOwner,url,sshUrl"],
      }).pipe(
        Effect.map((result) => result.stdout.trim()),
        Effect.flatMap((raw) =>
          decodeGitHubJson(
            raw,
            RawGitHubRepositoryCloneUrlsSchema,
            "getRepositoryCloneUrls",
            "GitHub CLI returned invalid repository JSON.",
          ),
        ),
        Effect.map(normalizeRepositoryCloneUrls),
      ),
    createRepository: (input) =>
      execute({
        cwd: input.cwd,
        args: ["repo", "create", input.repository, `--${input.visibility}`],
      }).pipe(
        Effect.map((result) =>
          deriveRepositoryCloneUrlsFromCreateOutput(result.stdout, input.repository),
        ),
      ),
    createPullRequest: (input) =>
      execute({
        cwd: input.cwd,
        args: [
          "pr",
          "create",
          "--base",
          input.baseBranch,
          "--head",
          input.headSelector,
          "--title",
          input.title,
          "--body-file",
          input.bodyFile,
        ],
      }).pipe(Effect.asVoid),
    getDefaultBranch: (input) =>
      execute({
        cwd: input.cwd,
        args: ["repo", "view", "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"],
      }).pipe(
        Effect.map((value) => {
          const trimmed = value.stdout.trim();
          return trimmed.length > 0 ? trimmed : null;
        }),
      ),
    checkoutPullRequest: (input) =>
      execute({
        cwd: input.cwd,
        args: ["pr", "checkout", input.reference, ...(input.force ? ["--force"] : [])],
      }).pipe(Effect.asVoid),
    listIssues: (input) =>
      execute({
        cwd: input.cwd,
        args: [
          "issue",
          "list",
          "--state",
          input.state,
          "--limit",
          String(input.limit ?? 50),
          "--json",
          "number,title,url,state,updatedAt,author,labels,assignees,comments",
        ],
      }).pipe(
        Effect.map((r) => r.stdout.trim()),
        Effect.flatMap((raw) =>
          raw.length === 0
            ? Effect.succeed([])
            : Effect.sync(() => GitHubIssues.decodeGitHubIssueListJson(raw)).pipe(
                Effect.flatMap((decoded) =>
                  Result.isSuccess(decoded)
                    ? Effect.succeed(decoded.success)
                    : Effect.fail(
                        new GitHubCliError({
                          operation: "listIssues",
                          detail: `GitHub CLI returned invalid issue list JSON: ${GitHubIssues.formatGitHubIssueDecodeError(decoded.failure)}`,
                          cause: decoded.failure,
                        }),
                      ),
                ),
              ),
        ),
      ),
    getIssue: (input) =>
      execute({
        cwd: input.cwd,
        args: [
          "issue",
          "view",
          input.reference,
          "--json",
          "number,title,url,state,updatedAt,author,labels,assignees,body,comments",
        ],
      }).pipe(
        Effect.map((r) => r.stdout.trim()),
        Effect.flatMap((raw) =>
          Effect.sync(() => GitHubIssues.decodeGitHubIssueDetailJson(raw)).pipe(
            Effect.flatMap((decoded) =>
              Result.isSuccess(decoded)
                ? Effect.succeed(decoded.success)
                : Effect.fail(
                    new GitHubCliError({
                      operation: "getIssue",
                      detail: `GitHub CLI returned invalid issue JSON: ${GitHubIssues.formatGitHubIssueDecodeError(decoded.failure)}`,
                      cause: decoded.failure,
                    }),
                  ),
            ),
          ),
        ),
      ),
    searchIssues: (input) =>
      execute({
        cwd: input.cwd,
        args: [
          "issue",
          "list",
          "--search",
          input.query,
          "--limit",
          String(input.limit ?? 20),
          "--json",
          "number,title,url,state,updatedAt,author,labels,assignees,comments",
        ],
      }).pipe(
        Effect.map((r) => r.stdout.trim()),
        Effect.flatMap((raw) =>
          raw.length === 0
            ? Effect.succeed([])
            : Effect.sync(() => GitHubIssues.decodeGitHubIssueListJson(raw)).pipe(
                Effect.flatMap((decoded) =>
                  Result.isSuccess(decoded)
                    ? Effect.succeed(decoded.success)
                    : Effect.fail(
                        new GitHubCliError({
                          operation: "searchIssues",
                          detail: `GitHub CLI returned invalid issue list JSON: ${GitHubIssues.formatGitHubIssueDecodeError(decoded.failure)}`,
                          cause: decoded.failure,
                        }),
                      ),
                ),
              ),
        ),
      ),
    searchPullRequests: (input) =>
      execute({
        cwd: input.cwd,
        args: [
          "pr",
          "list",
          "--search",
          input.query,
          "--limit",
          String(input.limit ?? 20),
          "--json",
          "number,title,url,baseRefName,headRefName,state,mergedAt,isCrossRepository,isDraft,author,assignees,labels,comments,headRepository,headRepositoryOwner",
        ],
      }).pipe(
        Effect.map((result) => result.stdout.trim()),
        Effect.flatMap((raw) =>
          raw.length === 0
            ? Effect.succeed([])
            : Effect.sync(() => GitHubPullRequests.decodeGitHubPullRequestListJson(raw)).pipe(
                Effect.flatMap((decoded) => {
                  if (!Result.isSuccess(decoded)) {
                    return Effect.fail(
                      new GitHubCliError({
                        operation: "searchPullRequests",
                        detail: `GitHub CLI returned invalid PR list JSON: ${GitHubPullRequests.formatGitHubJsonDecodeError(decoded.failure)}`,
                        cause: decoded.failure,
                      }),
                    );
                  }
                  return Effect.succeed(
                    decoded.success.map(({ updatedAt: _updatedAt, ...summary }) => summary),
                  );
                }),
              ),
        ),
      ),
    getPullRequestDetail: (input) =>
      execute({
        cwd: input.cwd,
        args: [
          "pr",
          "view",
          input.reference,
          "--json",
          "number,title,url,baseRefName,headRefName,state,mergedAt,isCrossRepository,isDraft,author,assignees,labels,headRepository,headRepositoryOwner,body,comments,reviewRequests,reviews,commits,additions,deletions,changedFiles,files",
        ],
      }).pipe(
        Effect.map((r) => r.stdout.trim()),
        Effect.flatMap((raw) =>
          Effect.sync(() => GitHubPullRequests.decodeGitHubPullRequestDetailJson(raw)).pipe(
            Effect.flatMap((decoded) => {
              if (!Result.isSuccess(decoded)) {
                return Effect.fail(
                  new GitHubCliError({
                    operation: "getPullRequestDetail",
                    detail: `GitHub CLI returned invalid pull request JSON: ${GitHubPullRequests.formatGitHubJsonDecodeError(decoded.failure)}`,
                    cause: decoded.failure,
                  }),
                );
              }
              const { updatedAt: _updatedAt, ...rest } = decoded.success;
              return Effect.succeed(rest);
            }),
          ),
        ),
      ),
    getPullRequestDiff: (input) =>
      execute({
        cwd: input.cwd,
        args: ["pr", "diff", input.reference],
      }).pipe(Effect.map((r) => r.stdout)),
    createIssue: (input) =>
      execute({
        cwd: input.cwd,
        args: buildGitHubIssueCreateArgv({
          title: input.title,
          bodyFile: input.bodyFile,
          ...(input.labels ? { labels: input.labels } : {}),
          ...(input.assignees ? { assignees: input.assignees } : {}),
        }),
      }).pipe(
        Effect.flatMap((r) => {
          const parsed = parseGitHubIssueCreateOutput(r.stdout);
          return parsed
            ? Effect.succeed(parsed)
            : Effect.fail(
                new GitHubCliError({
                  operation: "createIssue",
                  detail: `Unrecognized 'gh issue create' output: ${r.stdout.slice(0, 200)}`,
                }),
              );
        }),
      ),
    addIssueComment: (input) =>
      execute({
        cwd: input.cwd,
        args: ["issue", "comment", input.reference, "--body-file", input.bodyFile],
      }).pipe(Effect.asVoid),
    addPullRequestComment: (input) =>
      execute({
        cwd: input.cwd,
        args: ["pr", "comment", input.reference, "--body-file", input.bodyFile],
      }).pipe(Effect.asVoid),
    listLabels: (input) =>
      execute({
        cwd: input.cwd,
        args: ["label", "list", "--json", "name,color,description", "--limit", "1000"],
      }).pipe(
        Effect.map((r) => r.stdout.trim()),
        Effect.flatMap((raw) =>
          raw.length === 0
            ? Effect.succeed([])
            : Effect.sync(() => GitHubIssues.decodeJsonLabelList(raw)).pipe(
                Effect.flatMap((decoded) =>
                  Result.isSuccess(decoded)
                    ? Effect.succeed(
                        decoded.success.map((l) => ({
                          name: l.name,
                          ...(l.color ? { color: l.color } : {}),
                          ...(l.description ? { description: l.description } : {}),
                        })),
                      )
                    : Effect.fail(
                        new GitHubCliError({
                          operation: "listLabels",
                          detail: `Invalid label list output: ${formatSchemaError(decoded.failure)}`,
                          cause: decoded.failure,
                        }),
                      ),
                ),
              ),
        ),
      ),
    listAssignees: (input) =>
      execute({
        cwd: input.cwd,
        args: [
          "api",
          "-X",
          "GET",
          "repos/{owner}/{repo}/assignees",
          "-F",
          "per_page=100",
          "--paginate",
        ],
      }).pipe(
        Effect.map((r) => r.stdout.trim()),
        Effect.flatMap((raw) =>
          raw.length === 0
            ? Effect.succeed([])
            : Effect.sync(() => GitHubIssues.decodeJsonAssigneeList(raw)).pipe(
                Effect.flatMap((decoded) =>
                  Result.isSuccess(decoded)
                    ? Effect.succeed(
                        decoded.success.map((u) => ({
                          login: u.login,
                          ...(u.name ? { name: u.name } : {}),
                          ...(u.avatar_url ? { avatarUrl: u.avatar_url } : {}),
                        })),
                      )
                    : Effect.fail(
                        new GitHubCliError({
                          operation: "listAssignees",
                          detail: `Invalid assignees output: ${formatSchemaError(decoded.failure)}`,
                          cause: decoded.failure,
                        }),
                      ),
                ),
              ),
        ),
      ),
    listWorkflowRuns: (input) =>
      execute({
        cwd: input.cwd,
        args: ["api", workflowRunsEndpoint(input)],
        timeoutMs: 45_000,
      }).pipe(
        Effect.map((r) => r.stdout.trim()),
        Effect.flatMap((raw) =>
          raw.length === 0
            ? Effect.succeed([])
            : Effect.sync(() => GitHubActions.decodeGitHubWorkflowRunsJson(raw)).pipe(
                Effect.flatMap((decoded) =>
                  Result.isSuccess(decoded)
                    ? Effect.succeed(decoded.success)
                    : Effect.fail(
                        new GitHubCliError({
                          operation: "listWorkflowRuns",
                          detail: `Invalid workflow run output: ${GitHubActions.formatGitHubWorkflowDecodeError(decoded.failure)}`,
                          cause: decoded.failure,
                        }),
                      ),
                ),
              ),
        ),
      ),
    getPullRequestWorkflowContext: (input) =>
      execute({
        cwd: input.cwd,
        args: ["api", `repos/{owner}/{repo}/pulls/${pullRequestApiReference(input.reference)}`],
      }).pipe(
        Effect.map((r) => r.stdout.trim()),
        Effect.flatMap((raw) =>
          Effect.sync(() => GitHubActions.decodeGitHubPullRequestWorkflowContextJson(raw)).pipe(
            Effect.flatMap((decoded) =>
              Result.isSuccess(decoded)
                ? Effect.succeed(decoded.success)
                : Effect.fail(
                    new GitHubCliError({
                      operation: "getPullRequestWorkflowContext",
                      detail: `Invalid pull request workflow context output: ${GitHubActions.formatGitHubWorkflowDecodeError(decoded.failure)}`,
                      cause: decoded.failure,
                    }),
                  ),
            ),
          ),
        ),
      ),
    listWorkflowRunJobs: (input) =>
      execute({
        cwd: input.cwd,
        args: [
          "api",
          "--paginate",
          "--slurp",
          `repos/{owner}/{repo}/actions/runs/${input.runId}/jobs?per_page=100`,
        ],
        timeoutMs: 45_000,
      }).pipe(
        Effect.map((r) => r.stdout.trim()),
        Effect.flatMap((raw) =>
          raw.length === 0
            ? Effect.succeed([])
            : Effect.sync(() => GitHubActions.decodeGitHubWorkflowJobsJson(raw)).pipe(
                Effect.flatMap((decoded) =>
                  Result.isSuccess(decoded)
                    ? Effect.succeed(decoded.success)
                    : Effect.fail(
                        new GitHubCliError({
                          operation: "listWorkflowRunJobs",
                          detail: `Invalid workflow jobs output: ${GitHubActions.formatGitHubWorkflowDecodeError(decoded.failure)}`,
                          cause: decoded.failure,
                        }),
                      ),
                ),
              ),
        ),
      ),
    getWorkflowJobLog: (input) =>
      execute({
        cwd: input.cwd,
        args: ["run", "view", input.runId, "--job", input.jobId, "--log"],
        timeoutMs: 60_000,
      }).pipe(Effect.map((r) => r.stdout)),
    rerunFailedWorkflowJobs: (input) =>
      withGitHubCliOperation(
        "rerunFailedWorkflowJobs",
        execute({
          cwd: input.cwd,
          args: [
            "api",
            "-X",
            "POST",
            `repos/{owner}/{repo}/actions/runs/${input.runId}/rerun-failed-jobs`,
          ],
          timeoutMs: 45_000,
        }),
      ).pipe(Effect.asVoid),
    rerunWorkflowJob: (input) =>
      withGitHubCliOperation(
        "rerunWorkflowJob",
        execute({
          cwd: input.cwd,
          args: ["api", "-X", "POST", `repos/{owner}/{repo}/actions/jobs/${input.jobId}/rerun`],
          timeoutMs: 45_000,
        }),
      ).pipe(Effect.asVoid),
  });
});

export const layer = Layer.effect(GitHubCli, make());
