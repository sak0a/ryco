import type {
  ChangeRequest,
  EnvironmentId,
  SourceControlAssigneeCandidate,
  SourceControlChangeRequestDetail,
  SourceControlIssueDetail,
  SourceControlIssueSummary,
  SourceControlLabel,
  SourceControlProviderKind,
  SourceControlRepositorySearchResult,
  SourceControlWorkflowJobLogResult,
  SourceControlWorkflowRunJobsResult,
  SourceControlWorkflowRunListResult,
} from "@ryco/contracts";
import { requireEnvironmentConnection } from "~/environments/runtime";
import {
  createKeyedQueryRegistry,
  defineKeyedQueryByInput,
  KEY_SEP,
} from "@ryco/client-runtime/rpc";

// ---------------------------------------------------------------------------
// Atom-backed source-control context reads.
//
// Replaces the React Query `*QueryOptions` helpers in
// `~/lib/sourceControlContextRpc` (issue/PR lists + searches) plus the former
// issue-creation label/assignee lookups and mutations. List/search reads are
// reactive (`watch*` + state atoms); issue/PR detail lookups are imperative
// cached fetches (the former `queryClient.fetchQuery` calls).
// ---------------------------------------------------------------------------

const ISSUE_LIST_STALE_TIME_MS = 60_000;
const CHANGE_REQUEST_LIST_STALE_TIME_MS = 60_000;
const SEARCH_STALE_TIME_MS = 30_000;
const LABELS_STALE_TIME_MS = 5 * 60_000;
const ASSIGNEES_STALE_TIME_MS = 5 * 60_000;
const DETAIL_STALE_TIME_MS = 5 * 60_000;
const ISSUE_DETAIL_STALE_TIME_MS = 300_000;
const CHANGE_REQUEST_DETAIL_STALE_TIME_MS = 300_000;
const CHANGE_REQUEST_DIFF_STALE_TIME_MS = 300_000;
const WORKFLOW_RUNS_STALE_TIME_MS = 60_000;
const WORKFLOW_RUN_JOBS_STALE_TIME_MS = 60_000;
const WORKFLOW_JOB_LOG_STALE_TIME_MS = 300_000;

export interface SourceControlQueryState<T> {
  readonly data: T | null;
  readonly isLoading: boolean;
  readonly isFetching: boolean;
  readonly error: Error | null;
}

const INITIAL_QUERY_STATE: SourceControlQueryState<never> = Object.freeze({
  data: null,
  isLoading: false,
  isFetching: false,
  error: null,
});

const sourceControlRegistry = createKeyedQueryRegistry<SourceControlQueryState<unknown>>({
  labelPrefix: "source-control",
  initialState: INITIAL_QUERY_STATE,
  buildFetchingState: (current) => ({
    data: current.data,
    isLoading: current.data === null,
    isFetching: true,
    error: null,
  }),
  buildSuccessState: (data) => ({
    data,
    isLoading: false,
    isFetching: false,
    error: null,
  }),
  buildErrorState: (current, error) => ({
    data: current.data,
    isLoading: false,
    isFetching: false,
    error,
  }),
  selectPollData: (state) => state.data,
  onRunStart: (controller) => {
    controller.fetching = true;
  },
  onRunEnd: (controller) => {
    controller.fetching = false;
  },
});

const { controllers, runController, clearPollTimer } = sourceControlRegistry;

export type QueryBinding<TInput, TData> = import("@ryco/client-runtime/rpc").KeyedQueryByInput<
  TInput,
  TData,
  SourceControlQueryState<TData>
>;

interface SourceControlQueryDefinition<TInput, TData> {
  readonly label: string;
  readonly staleTime: number;
  readonly isEnabled: (input: TInput) => boolean;
  readonly buildKey: (input: TInput) => string;
  readonly resolveEnvironmentId: (input: TInput) => EnvironmentId;
  readonly resolveCwd: (input: TInput) => string;
  readonly run: (input: TInput) => Promise<TData>;
}

function defineQuery<TInput, TData>(
  definition: SourceControlQueryDefinition<TInput, TData>,
): QueryBinding<TInput, TData> {
  return defineKeyedQueryByInput(
    sourceControlRegistry,
    {
      ...definition,
      createControllerFields: (input) => ({ cwd: definition.resolveCwd(input), fetching: false }),
    },
    (controller) => {
      const isStale =
        controller.hasData && Date.now() - controller.lastFetchedAt >= controller.staleTime;
      return !controller.fetching && (!controller.hasData || isStale);
    },
  ) as QueryBinding<TInput, TData>;
}

function sourceControlClient(environmentId: EnvironmentId) {
  return requireEnvironmentConnection(environmentId).client.sourceControl;
}

// ---------------------------------------------------------------------------
// Issue list
// ---------------------------------------------------------------------------

export interface SourceControlIssueListInput {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly state: "open" | "closed" | "all";
  readonly limit?: number;
  readonly enabled?: boolean;
}

export const issueListBinding = defineQuery<
  SourceControlIssueListInput,
  ReadonlyArray<SourceControlIssueSummary>
>({
  label: "issues:list",
  staleTime: ISSUE_LIST_STALE_TIME_MS,
  isEnabled: (input) =>
    (input.enabled ?? true) && input.environmentId !== null && input.cwd !== null,
  buildKey: (input) =>
    `${input.environmentId}${KEY_SEP}${input.cwd}${KEY_SEP}${input.state}${KEY_SEP}${input.limit ?? ""}`,
  resolveEnvironmentId: (input) => input.environmentId as EnvironmentId,
  resolveCwd: (input) => input.cwd as string,
  run: (input) =>
    sourceControlClient(input.environmentId as EnvironmentId).listIssues({
      cwd: input.cwd as string,
      state: input.state,
      ...(input.limit !== undefined ? { limit: input.limit } : {}),
    }),
});

// ---------------------------------------------------------------------------
// Change request (PR) list
// ---------------------------------------------------------------------------

export interface SourceControlChangeRequestListInput {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly state: "open" | "closed" | "merged" | "all";
  readonly limit?: number;
  readonly enabled?: boolean;
}

export const changeRequestListBinding = defineQuery<
  SourceControlChangeRequestListInput,
  ReadonlyArray<ChangeRequest>
>({
  label: "changeRequests:list",
  staleTime: CHANGE_REQUEST_LIST_STALE_TIME_MS,
  isEnabled: (input) =>
    (input.enabled ?? true) && input.environmentId !== null && input.cwd !== null,
  buildKey: (input) =>
    `${input.environmentId}${KEY_SEP}${input.cwd}${KEY_SEP}${input.state}${KEY_SEP}${input.limit ?? ""}`,
  resolveEnvironmentId: (input) => input.environmentId as EnvironmentId,
  resolveCwd: (input) => input.cwd as string,
  run: (input) =>
    sourceControlClient(input.environmentId as EnvironmentId).listChangeRequests({
      cwd: input.cwd as string,
      state: input.state,
      ...(input.limit !== undefined ? { limit: input.limit } : {}),
    }),
});

// ---------------------------------------------------------------------------
// Issue search
// ---------------------------------------------------------------------------

export interface SourceControlIssueSearchInput {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly query: string;
  readonly limit?: number;
  readonly enabled?: boolean;
}

export const issueSearchBinding = defineQuery<
  SourceControlIssueSearchInput,
  ReadonlyArray<SourceControlIssueSummary>
>({
  label: "issues:search",
  staleTime: SEARCH_STALE_TIME_MS,
  isEnabled: (input) =>
    (input.enabled ?? true) &&
    input.environmentId !== null &&
    input.cwd !== null &&
    input.query.length > 0,
  buildKey: (input) =>
    `${input.environmentId}${KEY_SEP}${input.cwd}${KEY_SEP}${input.query}${KEY_SEP}${input.limit ?? ""}`,
  resolveEnvironmentId: (input) => input.environmentId as EnvironmentId,
  resolveCwd: (input) => input.cwd as string,
  run: (input) =>
    sourceControlClient(input.environmentId as EnvironmentId).searchIssues({
      cwd: input.cwd as string,
      query: input.query,
      ...(input.limit !== undefined ? { limit: input.limit } : {}),
    }),
});

// ---------------------------------------------------------------------------
// Change request (PR) search
// ---------------------------------------------------------------------------

export interface SourceControlChangeRequestSearchInput {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly query: string;
  readonly limit?: number;
  readonly enabled?: boolean;
}

export const changeRequestSearchBinding = defineQuery<
  SourceControlChangeRequestSearchInput,
  ReadonlyArray<ChangeRequest>
>({
  label: "changeRequests:search",
  staleTime: SEARCH_STALE_TIME_MS,
  isEnabled: (input) =>
    (input.enabled ?? true) &&
    input.environmentId !== null &&
    input.cwd !== null &&
    input.query.length > 0,
  buildKey: (input) =>
    `${input.environmentId}${KEY_SEP}${input.cwd}${KEY_SEP}${input.query}${KEY_SEP}${input.limit ?? ""}`,
  resolveEnvironmentId: (input) => input.environmentId as EnvironmentId,
  resolveCwd: (input) => input.cwd as string,
  run: (input) =>
    sourceControlClient(input.environmentId as EnvironmentId).searchChangeRequests({
      cwd: input.cwd as string,
      query: input.query,
      ...(input.limit !== undefined ? { limit: input.limit } : {}),
    }),
});

// ---------------------------------------------------------------------------
// Remote repository search (command palette clone flow)
// ---------------------------------------------------------------------------

export interface SourceControlRepositorySearchInput {
  readonly environmentId: EnvironmentId | null;
  readonly provider: SourceControlProviderKind | null;
  readonly query: string;
  readonly limit?: number;
  readonly enabled?: boolean;
}

export const repositorySearchBinding = defineQuery<
  SourceControlRepositorySearchInput,
  SourceControlRepositorySearchResult
>({
  label: "repositories:search",
  staleTime: SEARCH_STALE_TIME_MS,
  isEnabled: (input) =>
    (input.enabled ?? true) && input.environmentId !== null && input.provider !== null,
  buildKey: (input) =>
    `${input.environmentId}${KEY_SEP}${input.provider}${KEY_SEP}${input.query}${KEY_SEP}${input.limit ?? 25}`,
  resolveEnvironmentId: (input) => input.environmentId as EnvironmentId,
  resolveCwd: () => "",
  run: (input) =>
    sourceControlClient(input.environmentId as EnvironmentId).searchRepositories({
      provider: input.provider as SourceControlProviderKind,
      ...(input.query.length > 0 ? { query: input.query } : {}),
      ...(input.limit !== undefined ? { limit: input.limit } : {}),
    }),
});

// ---------------------------------------------------------------------------
// Issue creation: labels + assignees
// ---------------------------------------------------------------------------

export interface SourceControlIssueMetaInput {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly enabled?: boolean;
}

export const issueLabelsBinding = defineQuery<
  SourceControlIssueMetaInput,
  ReadonlyArray<SourceControlLabel>
>({
  label: "issues:labels",
  staleTime: LABELS_STALE_TIME_MS,
  isEnabled: (input) =>
    (input.enabled ?? true) && input.environmentId !== null && input.cwd !== null,
  buildKey: (input) => `${input.environmentId}${KEY_SEP}${input.cwd}`,
  resolveEnvironmentId: (input) => input.environmentId as EnvironmentId,
  resolveCwd: (input) => input.cwd as string,
  run: (input) =>
    sourceControlClient(input.environmentId as EnvironmentId).listIssueLabels({
      cwd: input.cwd as string,
    }),
});

export const issueAssigneesBinding = defineQuery<
  SourceControlIssueMetaInput,
  ReadonlyArray<SourceControlAssigneeCandidate>
>({
  label: "issues:assignees",
  staleTime: ASSIGNEES_STALE_TIME_MS,
  isEnabled: (input) =>
    (input.enabled ?? true) && input.environmentId !== null && input.cwd !== null,
  buildKey: (input) => `${input.environmentId}${KEY_SEP}${input.cwd}`,
  resolveEnvironmentId: (input) => input.environmentId as EnvironmentId,
  resolveCwd: (input) => input.cwd as string,
  run: (input) =>
    sourceControlClient(input.environmentId as EnvironmentId).listIssueAssignees({
      cwd: input.cwd as string,
    }),
});

// ---------------------------------------------------------------------------
// Issue detail
// ---------------------------------------------------------------------------

export interface SourceControlIssueDetailInput {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly reference: string | null;
  readonly fullContent?: boolean;
  readonly enabled?: boolean;
}

export const issueDetailBinding = defineQuery<
  SourceControlIssueDetailInput,
  SourceControlIssueDetail
>({
  label: "issues:detail",
  staleTime: ISSUE_DETAIL_STALE_TIME_MS,
  isEnabled: (input) =>
    (input.enabled ?? true) &&
    input.environmentId !== null &&
    input.cwd !== null &&
    input.reference !== null,
  buildKey: (input) =>
    `${input.environmentId}${KEY_SEP}${input.cwd}${KEY_SEP}${input.reference}${KEY_SEP}${input.fullContent ?? false}`,
  resolveEnvironmentId: (input) => input.environmentId as EnvironmentId,
  resolveCwd: (input) => input.cwd as string,
  run: (input) =>
    sourceControlClient(input.environmentId as EnvironmentId).getIssue({
      cwd: input.cwd as string,
      reference: input.reference as string,
      ...(input.fullContent ? { fullContent: true } : {}),
    }),
});

// ---------------------------------------------------------------------------
// Change request detail + diff
// ---------------------------------------------------------------------------

export interface SourceControlChangeRequestDetailInput {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly reference: string | null;
  readonly fullContent?: boolean;
  readonly enabled?: boolean;
}

export const changeRequestDetailBinding = defineQuery<
  SourceControlChangeRequestDetailInput,
  SourceControlChangeRequestDetail
>({
  label: "changeRequests:detail",
  staleTime: CHANGE_REQUEST_DETAIL_STALE_TIME_MS,
  isEnabled: (input) =>
    (input.enabled ?? true) &&
    input.environmentId !== null &&
    input.cwd !== null &&
    input.reference !== null,
  buildKey: (input) =>
    `${input.environmentId}${KEY_SEP}${input.cwd}${KEY_SEP}${input.reference}${KEY_SEP}${input.fullContent ?? false}`,
  resolveEnvironmentId: (input) => input.environmentId as EnvironmentId,
  resolveCwd: (input) => input.cwd as string,
  run: (input) =>
    sourceControlClient(input.environmentId as EnvironmentId).getChangeRequestDetail({
      cwd: input.cwd as string,
      reference: input.reference as string,
      ...(input.fullContent ? { fullContent: true } : {}),
    }),
});

export interface SourceControlChangeRequestDiffInput {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly reference: string | null;
  readonly enabled?: boolean;
}

export const changeRequestDiffBinding = defineQuery<SourceControlChangeRequestDiffInput, string>({
  label: "changeRequests:diff",
  staleTime: CHANGE_REQUEST_DIFF_STALE_TIME_MS,
  isEnabled: (input) =>
    (input.enabled ?? true) &&
    input.environmentId !== null &&
    input.cwd !== null &&
    input.reference !== null,
  buildKey: (input) => `${input.environmentId}${KEY_SEP}${input.cwd}${KEY_SEP}${input.reference}`,
  resolveEnvironmentId: (input) => input.environmentId as EnvironmentId,
  resolveCwd: (input) => input.cwd as string,
  run: (input) =>
    sourceControlClient(input.environmentId as EnvironmentId).getChangeRequestDiff({
      cwd: input.cwd as string,
      reference: input.reference as string,
    }),
});

// ---------------------------------------------------------------------------
// Workflow runs, jobs, and logs
// ---------------------------------------------------------------------------

export interface SourceControlWorkflowRunsInput {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly pullRequestNumber?: number | null;
  readonly commitSha?: string | null;
  readonly limit?: number;
  readonly enabled?: boolean;
}

export const workflowRunsBinding = defineQuery<
  SourceControlWorkflowRunsInput,
  SourceControlWorkflowRunListResult
>({
  label: "workflows:runs",
  staleTime: WORKFLOW_RUNS_STALE_TIME_MS,
  isEnabled: (input) =>
    (input.enabled ?? true) && input.environmentId !== null && input.cwd !== null,
  buildKey: (input) =>
    `${input.environmentId}${KEY_SEP}${input.cwd}${KEY_SEP}${input.pullRequestNumber ?? ""}${KEY_SEP}${input.commitSha ?? ""}${KEY_SEP}${input.limit ?? ""}`,
  resolveEnvironmentId: (input) => input.environmentId as EnvironmentId,
  resolveCwd: (input) => input.cwd as string,
  run: (input) =>
    sourceControlClient(input.environmentId as EnvironmentId).listWorkflowRuns({
      cwd: input.cwd as string,
      ...(input.pullRequestNumber !== undefined && input.pullRequestNumber !== null
        ? { pullRequestNumber: input.pullRequestNumber }
        : {}),
      ...(input.commitSha !== undefined && input.commitSha !== null
        ? { commitSha: input.commitSha }
        : {}),
      ...(input.limit !== undefined ? { limit: input.limit } : {}),
    }),
});

export interface SourceControlWorkflowRunJobsInput {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly runId: string | null;
  readonly enabled?: boolean;
}

export const workflowRunJobsBinding = defineQuery<
  SourceControlWorkflowRunJobsInput,
  SourceControlWorkflowRunJobsResult
>({
  label: "workflows:jobs",
  staleTime: WORKFLOW_RUN_JOBS_STALE_TIME_MS,
  isEnabled: (input) =>
    (input.enabled ?? true) &&
    input.environmentId !== null &&
    input.cwd !== null &&
    input.runId !== null,
  buildKey: (input) => `${input.environmentId}${KEY_SEP}${input.cwd}${KEY_SEP}${input.runId}`,
  resolveEnvironmentId: (input) => input.environmentId as EnvironmentId,
  resolveCwd: (input) => input.cwd as string,
  run: (input) =>
    sourceControlClient(input.environmentId as EnvironmentId).getWorkflowRunJobs({
      cwd: input.cwd as string,
      runId: input.runId as string,
    }),
});

export interface SourceControlWorkflowJobLogInput {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly runId: string | null;
  readonly jobId: string | null;
  readonly enabled?: boolean;
}

export const workflowJobLogBinding = defineQuery<
  SourceControlWorkflowJobLogInput,
  SourceControlWorkflowJobLogResult
>({
  label: "workflows:jobLog",
  staleTime: WORKFLOW_JOB_LOG_STALE_TIME_MS,
  isEnabled: (input) =>
    (input.enabled ?? false) &&
    input.environmentId !== null &&
    input.cwd !== null &&
    input.runId !== null &&
    input.jobId !== null,
  buildKey: (input) =>
    `${input.environmentId}${KEY_SEP}${input.cwd}${KEY_SEP}${input.runId}${KEY_SEP}${input.jobId}`,
  resolveEnvironmentId: (input) => input.environmentId as EnvironmentId,
  resolveCwd: (input) => input.cwd as string,
  run: (input) =>
    sourceControlClient(input.environmentId as EnvironmentId).getWorkflowJobLog({
      cwd: input.cwd as string,
      runId: input.runId as string,
      jobId: input.jobId as string,
    }),
});

// ---------------------------------------------------------------------------
// Imperative detail fetches (cached, replacing queryClient.fetchQuery)
// ---------------------------------------------------------------------------

interface DetailCacheEntry<T> {
  readonly value: T;
  readonly fetchedAt: number;
}

interface DetailCacheSlot {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  promise?: Promise<unknown>;
  entry?: DetailCacheEntry<unknown>;
}

const detailCache = new Map<string, DetailCacheSlot>();

async function fetchDetailWithCache<T>(params: {
  readonly cacheKey: string;
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly staleTime: number;
  readonly run: () => Promise<T>;
}): Promise<T> {
  const existing = detailCache.get(params.cacheKey);
  if (existing?.entry && Date.now() - existing.entry.fetchedAt < params.staleTime) {
    return existing.entry.value as T;
  }
  if (existing?.promise) {
    return existing.promise as Promise<T>;
  }

  const promise = params
    .run()
    .then((value) => {
      detailCache.set(params.cacheKey, {
        environmentId: params.environmentId,
        cwd: params.cwd,
        entry: { value, fetchedAt: Date.now() },
      });
      return value;
    })
    .catch((error: unknown) => {
      const slot = detailCache.get(params.cacheKey);
      if (slot && slot.promise === promise) {
        detailCache.delete(params.cacheKey);
      }
      throw error;
    });

  detailCache.set(params.cacheKey, {
    environmentId: params.environmentId,
    cwd: params.cwd,
    promise,
  });
  return promise;
}

export function fetchSourceControlIssueDetail(input: {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly reference: string;
  readonly fullContent?: boolean;
}): Promise<SourceControlIssueDetail> {
  if (!input.environmentId || !input.cwd) {
    return Promise.reject(new Error("Issue detail is unavailable."));
  }
  const environmentId = input.environmentId;
  const cwd = input.cwd;
  const fullContent = input.fullContent ?? false;
  const cacheKey = `issueDetail${KEY_SEP}${environmentId}${KEY_SEP}${cwd}${KEY_SEP}${input.reference}${KEY_SEP}${fullContent}`;
  return fetchDetailWithCache({
    cacheKey,
    environmentId,
    cwd,
    staleTime: DETAIL_STALE_TIME_MS,
    run: () =>
      sourceControlClient(environmentId).getIssue({
        cwd,
        reference: input.reference,
        ...(fullContent ? { fullContent: true } : {}),
      }),
  });
}

export function fetchSourceControlChangeRequestDetail(input: {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly reference: string;
  readonly fullContent?: boolean;
}): Promise<SourceControlChangeRequestDetail> {
  if (!input.environmentId || !input.cwd) {
    return Promise.reject(new Error("Change request detail is unavailable."));
  }
  const environmentId = input.environmentId;
  const cwd = input.cwd;
  const fullContent = input.fullContent ?? false;
  const cacheKey = `changeRequestDetail${KEY_SEP}${environmentId}${KEY_SEP}${cwd}${KEY_SEP}${input.reference}${KEY_SEP}${fullContent}`;
  return fetchDetailWithCache({
    cacheKey,
    environmentId,
    cwd,
    staleTime: DETAIL_STALE_TIME_MS,
    run: () =>
      sourceControlClient(environmentId).getChangeRequestDetail({
        cwd,
        reference: input.reference,
        ...(fullContent ? { fullContent: true } : {}),
      }),
  });
}

// ---------------------------------------------------------------------------
// Invalidation
//
// Mirrors React Query's "refetch active queries, drop the rest" invalidation
// previously triggered via `queryClient.invalidateQueries({ queryKey:
// sourceControlContextQueryKeys.all })`. Mounted list/search scopes refetch;
// idle scopes are marked stale so the next watch refetches. Cached detail
// lookups for the matching environment/cwd are dropped.
// ---------------------------------------------------------------------------

export function invalidateSourceControl(input?: {
  readonly environmentId?: EnvironmentId | null;
  readonly cwd?: string | null;
}): void {
  const environmentId = input?.environmentId ?? null;
  const cwd = input?.cwd ?? null;

  for (const controller of controllers.values()) {
    if (environmentId !== null && controller.environmentId !== environmentId) {
      continue;
    }
    if (cwd !== null && (controller.cwd as string) !== cwd) {
      continue;
    }
    controller.hasData = false;
    clearPollTimer(controller);
    if (controller.subscriberCount > 0) {
      void runController(controller);
    } else {
      // No active observers: cancel any in-flight fetch so the next watch
      // refetches fresh data.
      controller.fetchToken += 1;
      controller.fetching = false;
    }
  }

  for (const [cacheKey, slot] of detailCache) {
    if (environmentId !== null && slot.environmentId !== environmentId) {
      continue;
    }
    if (cwd !== null && slot.cwd !== cwd) {
      continue;
    }
    detailCache.delete(cacheKey);
  }
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

export function resetSourceControlAtomsForTests(): void {
  sourceControlRegistry.resetForTests();
  detailCache.clear();
}
