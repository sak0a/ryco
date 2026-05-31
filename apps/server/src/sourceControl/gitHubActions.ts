import { Cause, Result, Schema } from "effect";
import { PositiveInt, TrimmedNonEmptyString } from "@ryco/contracts";
import { decodeJsonResult, formatSchemaError } from "@ryco/shared/schemaJson";

export interface NormalizedGitHubWorkflowRunCommit {
  readonly oid: string;
  readonly shortOid: string;
  readonly messageHeadline?: string;
}

export interface NormalizedGitHubWorkflowRun {
  readonly runId: string;
  readonly workflowName: string;
  readonly displayTitle?: string;
  readonly branch: string | null;
  readonly event?: string;
  readonly commit: NormalizedGitHubWorkflowRunCommit;
  readonly actor: string | null;
  readonly status: string;
  readonly conclusion: string | null;
  readonly startedAt: string | null;
  readonly updatedAt: string | null;
  readonly url: string;
  readonly repositoryNameWithOwner: string | null;
}

export interface NormalizedGitHubWorkflowStep {
  readonly number: number;
  readonly name: string;
  readonly status: string;
  readonly conclusion: string | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
}

export interface NormalizedGitHubWorkflowJob {
  readonly jobId: string;
  readonly name: string;
  readonly status: string;
  readonly conclusion: string | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly url: string | null;
  readonly steps: ReadonlyArray<NormalizedGitHubWorkflowStep>;
}

export interface NormalizedGitHubPullRequestWorkflowContext {
  readonly number: number;
  readonly headSha: string;
  readonly headRefName: string;
  readonly headRepositoryNameWithOwner: string | null;
  readonly baseRepositoryNameWithOwner: string | null;
}

const RawGitHubWorkflowRunSchema = Schema.Struct({
  id: Schema.Number,
  name: Schema.optional(Schema.NullOr(Schema.String)),
  display_title: Schema.optional(Schema.NullOr(Schema.String)),
  head_branch: Schema.optional(Schema.NullOr(Schema.String)),
  head_sha: Schema.optional(Schema.NullOr(Schema.String)),
  event: Schema.optional(Schema.NullOr(Schema.String)),
  status: Schema.optional(Schema.NullOr(Schema.String)),
  conclusion: Schema.optional(Schema.NullOr(Schema.String)),
  html_url: Schema.optional(Schema.NullOr(Schema.String)),
  run_started_at: Schema.optional(Schema.NullOr(Schema.String)),
  updated_at: Schema.optional(Schema.NullOr(Schema.String)),
  actor: Schema.optional(Schema.NullOr(Schema.Struct({ login: Schema.String }))),
  head_commit: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        id: Schema.optional(Schema.NullOr(Schema.String)),
        message: Schema.optional(Schema.NullOr(Schema.String)),
      }),
    ),
  ),
  repository: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        full_name: Schema.optional(Schema.NullOr(Schema.String)),
      }),
    ),
  ),
});

const RawGitHubWorkflowRunsResponseSchema = Schema.Struct({
  workflow_runs: Schema.Array(RawGitHubWorkflowRunSchema),
});

const RawGitHubWorkflowStepSchema = Schema.Struct({
  number: Schema.optional(Schema.NullOr(Schema.Number)),
  name: Schema.optional(Schema.NullOr(Schema.String)),
  status: Schema.optional(Schema.NullOr(Schema.String)),
  conclusion: Schema.optional(Schema.NullOr(Schema.String)),
  started_at: Schema.optional(Schema.NullOr(Schema.String)),
  completed_at: Schema.optional(Schema.NullOr(Schema.String)),
});

const RawGitHubWorkflowJobSchema = Schema.Struct({
  id: Schema.Number,
  name: Schema.optional(Schema.NullOr(Schema.String)),
  status: Schema.optional(Schema.NullOr(Schema.String)),
  conclusion: Schema.optional(Schema.NullOr(Schema.String)),
  started_at: Schema.optional(Schema.NullOr(Schema.String)),
  completed_at: Schema.optional(Schema.NullOr(Schema.String)),
  html_url: Schema.optional(Schema.NullOr(Schema.String)),
  steps: Schema.optional(Schema.Array(RawGitHubWorkflowStepSchema)),
});

const RawGitHubWorkflowJobsResponseSchema = Schema.Struct({
  jobs: Schema.Array(RawGitHubWorkflowJobSchema),
});

const RawGitHubWorkflowJobsPayloadSchema = Schema.Union([
  RawGitHubWorkflowJobsResponseSchema,
  Schema.Array(RawGitHubWorkflowJobsResponseSchema),
]);

const RawGitHubPullRequestWorkflowContextSchema = Schema.Struct({
  number: PositiveInt,
  head: Schema.Struct({
    sha: TrimmedNonEmptyString,
    ref: TrimmedNonEmptyString,
    repo: Schema.optional(
      Schema.NullOr(
        Schema.Struct({
          full_name: Schema.optional(Schema.NullOr(Schema.String)),
        }),
      ),
    ),
  }),
  base: Schema.optional(
    Schema.Struct({
      repo: Schema.optional(
        Schema.NullOr(
          Schema.Struct({
            full_name: Schema.optional(Schema.NullOr(Schema.String)),
          }),
        ),
      ),
    }),
  ),
});

function optionalTrimmed(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function trimmedOr(value: string | null | undefined, fallback: string): string {
  return optionalTrimmed(value) ?? fallback;
}

function shortOid(oid: string): string {
  return oid.length > 12 ? oid.slice(0, 12) : oid;
}

function firstLine(value: string | null | undefined): string | null {
  const trimmed = optionalTrimmed(value);
  if (!trimmed) return null;
  return trimmed.split(/\r?\n/u)[0] ?? trimmed;
}

function normalizeWorkflowRun(
  raw: Schema.Schema.Type<typeof RawGitHubWorkflowRunSchema>,
): NormalizedGitHubWorkflowRun {
  const runId = String(raw.id);
  const oid = optionalTrimmed(raw.head_commit?.id) ?? optionalTrimmed(raw.head_sha) ?? "unknown";
  const workflowName =
    optionalTrimmed(raw.name) ?? optionalTrimmed(raw.display_title) ?? `Run ${runId}`;
  const url = optionalTrimmed(raw.html_url) ?? `https://github.com/actions/runs/${runId}`;
  const messageHeadline = firstLine(raw.head_commit?.message);
  const displayTitle = optionalTrimmed(raw.display_title);
  const event = optionalTrimmed(raw.event);

  return {
    runId,
    workflowName,
    ...(displayTitle ? { displayTitle } : {}),
    branch: optionalTrimmed(raw.head_branch),
    ...(event ? { event } : {}),
    commit: {
      oid,
      shortOid: shortOid(oid),
      ...(messageHeadline ? { messageHeadline } : {}),
    },
    actor: optionalTrimmed(raw.actor?.login),
    status: trimmedOr(raw.status, "unknown"),
    conclusion: optionalTrimmed(raw.conclusion),
    startedAt: optionalTrimmed(raw.run_started_at),
    updatedAt: optionalTrimmed(raw.updated_at),
    url,
    repositoryNameWithOwner: optionalTrimmed(raw.repository?.full_name),
  };
}

function normalizeWorkflowStep(
  raw: Schema.Schema.Type<typeof RawGitHubWorkflowStepSchema>,
  index: number,
): NormalizedGitHubWorkflowStep {
  return {
    number: typeof raw.number === "number" && Number.isFinite(raw.number) ? raw.number : index + 1,
    name: trimmedOr(raw.name, `Step ${index + 1}`),
    status: trimmedOr(raw.status, "unknown"),
    conclusion: optionalTrimmed(raw.conclusion),
    startedAt: optionalTrimmed(raw.started_at),
    completedAt: optionalTrimmed(raw.completed_at),
  };
}

function normalizeWorkflowJob(
  raw: Schema.Schema.Type<typeof RawGitHubWorkflowJobSchema>,
): NormalizedGitHubWorkflowJob {
  return {
    jobId: String(raw.id),
    name: trimmedOr(raw.name, `Job ${raw.id}`),
    status: trimmedOr(raw.status, "unknown"),
    conclusion: optionalTrimmed(raw.conclusion),
    startedAt: optionalTrimmed(raw.started_at),
    completedAt: optionalTrimmed(raw.completed_at),
    url: optionalTrimmed(raw.html_url),
    steps: (raw.steps ?? []).map((step, index) => normalizeWorkflowStep(step, index)),
  };
}

function normalizePullRequestWorkflowContext(
  raw: Schema.Schema.Type<typeof RawGitHubPullRequestWorkflowContextSchema>,
): NormalizedGitHubPullRequestWorkflowContext {
  return {
    number: raw.number,
    headSha: raw.head.sha,
    headRefName: raw.head.ref,
    headRepositoryNameWithOwner: optionalTrimmed(raw.head.repo?.full_name),
    baseRepositoryNameWithOwner: optionalTrimmed(raw.base?.repo?.full_name),
  };
}

const decodeWorkflowRunsResponse = decodeJsonResult(RawGitHubWorkflowRunsResponseSchema);
const decodeWorkflowJobsResponse = decodeJsonResult(RawGitHubWorkflowJobsPayloadSchema);
const decodePullRequestWorkflowContext = decodeJsonResult(
  RawGitHubPullRequestWorkflowContextSchema,
);

export const formatGitHubWorkflowDecodeError = formatSchemaError;

export function decodeGitHubWorkflowRunsJson(
  raw: string,
): Result.Result<ReadonlyArray<NormalizedGitHubWorkflowRun>, Cause.Cause<Schema.SchemaError>> {
  const result = decodeWorkflowRunsResponse(raw);
  return Result.isSuccess(result)
    ? Result.succeed(result.success.workflow_runs.map(normalizeWorkflowRun))
    : Result.fail(result.failure);
}

export function decodeGitHubWorkflowJobsJson(
  raw: string,
): Result.Result<ReadonlyArray<NormalizedGitHubWorkflowJob>, Cause.Cause<Schema.SchemaError>> {
  const result = decodeWorkflowJobsResponse(raw);
  if (!Result.isSuccess(result)) return Result.fail(result.failure);
  const pages = Array.isArray(result.success) ? result.success : [result.success];
  return Result.succeed(pages.flatMap((page) => page.jobs.map(normalizeWorkflowJob)));
}

export function decodeGitHubPullRequestWorkflowContextJson(
  raw: string,
): Result.Result<NormalizedGitHubPullRequestWorkflowContext, Cause.Cause<Schema.SchemaError>> {
  const result = decodePullRequestWorkflowContext(raw);
  return Result.isSuccess(result)
    ? Result.succeed(normalizePullRequestWorkflowContext(result.success))
    : Result.fail(result.failure);
}
