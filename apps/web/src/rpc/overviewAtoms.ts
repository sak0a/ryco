import type {
  ChangeRequest,
  EnvironmentId,
  SourceControlChangeRequestDetail,
  SourceControlWorkflowJob,
  SourceControlWorkflowRunJobsResult,
  SourceControlWorkflowRunListResult,
} from "@ryco/contracts";
import { Atom } from "effect/unstable/reactivity";

import { requireEnvironmentConnection } from "../environments/runtime";
import { appAtomRegistry } from "@ryco/client-runtime/rpc";
import { invalidateScopes, subscribeInvalidationScope } from "./gitAtoms";

// ---------------------------------------------------------------------------
// Overview source-control atoms
//
// Atom-backed replacement for the React Query (`useQuery`/`useQueries`) usage
// in `ChatOverviewPanel` covering the open change-request list, pull request
// detail (30s polling while open), workflow runs (dynamic post-push/active
// polling), and per-run workflow jobs (30s polling for the active run). The
// previous `staleTime`, `enabled`-gating, refetch interval, and
// keep-previous-data semantics are preserved so the consuming component does
// not change shape.
// ---------------------------------------------------------------------------

const CHANGE_REQUEST_LIST_STALE_TIME_MS = 60_000;
const CHANGE_REQUEST_DETAIL_STALE_TIME_MS = 300_000;
const WORKFLOW_RUNS_STALE_TIME_MS = 60_000;
const WORKFLOW_RUN_JOBS_STALE_TIME_MS = 60_000;

const CHANGE_REQUEST_DETAIL_OPEN_REFETCH_INTERVAL_MS = 30_000;
const ACTIVE_WORKFLOW_RUN_JOBS_REFETCH_INTERVAL_MS = 30_000;

export const OVERVIEW_CHANGE_REQUEST_LIST_LIMIT = 50;
export const OVERVIEW_WORKFLOW_RUNS_LIMIT = 20;

const NOOP: () => void = () => undefined;
const FIELD_SEPARATOR = "\u0000";

/**
 * Scoped invalidation key for overview source-control state of a working
 * directory. Refetches every mounted overview query (list/detail/workflows/
 * jobs) for that cwd. Mirrors the per-cwd React Query invalidation the
 * post-push workflow watch previously triggered against the source-control
 * query keys.
 */
export function sourceControlScopeKey(cwd: string | null): string {
  return `sourcecontrol:${cwd ?? ""}`;
}

export function invalidateOverviewSourceControl(cwd: string | null): void {
  invalidateScopes([sourceControlScopeKey(cwd)]);
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

// ---------------------------------------------------------------------------
// Generic single-value polling query
// ---------------------------------------------------------------------------

export interface OverviewQueryState<TData> {
  readonly data: TData | null;
  readonly error: Error | null;
  readonly isLoading: boolean;
  readonly isFetching: boolean;
}

const INITIAL_QUERY_STATE: OverviewQueryState<unknown> = Object.freeze({
  data: null,
  error: null,
  isLoading: true,
  isFetching: false,
});

const EMPTY_QUERY_STATE: OverviewQueryState<unknown> = Object.freeze({
  data: null,
  error: null,
  isLoading: false,
  isFetching: false,
});

const EMPTY_QUERY_ATOM = Atom.make(EMPTY_QUERY_STATE).pipe(
  Atom.keepAlive,
  Atom.withLabel("overview-query:empty"),
);

const knownQueryKeys = new Set<string>();

const queryStateAtoms = Atom.family((key: string) => {
  knownQueryKeys.add(key);
  return Atom.make(INITIAL_QUERY_STATE).pipe(
    Atom.keepAlive,
    Atom.withLabel(`overview-query:${key}`),
  );
});

export function getOverviewQueryAtom(key: string | null): Atom.Atom<OverviewQueryState<unknown>> {
  return key === null ? EMPTY_QUERY_ATOM : queryStateAtoms(key);
}

interface QuerySpec {
  readonly key: string;
  readonly scope: string;
  readonly staleTimeMs: number;
  fetch(): Promise<unknown>;
  resolveIntervalMs(data: unknown): number | false;
}

interface QueryController {
  spec: QuerySpec;
  subscriberCount: number;
  token: number;
  lastFetchedAt: number;
  timer: ReturnType<typeof setTimeout> | null;
  invalidationUnsub: () => void;
}

const queryControllers = new Map<string, QueryController>();

function getQueryState(key: string): OverviewQueryState<unknown> {
  return appAtomRegistry.get(queryStateAtoms(key));
}

function setQueryState(key: string, next: OverviewQueryState<unknown>): void {
  const atom = queryStateAtoms(key);
  const current = appAtomRegistry.get(atom);
  if (
    current.data === next.data &&
    current.error === next.error &&
    current.isLoading === next.isLoading &&
    current.isFetching === next.isFetching
  ) {
    return;
  }
  appAtomRegistry.set(atom, next);
}

function clearQueryTimer(controller: QueryController): void {
  if (controller.timer !== null) {
    clearTimeout(controller.timer);
    controller.timer = null;
  }
}

function scheduleNextQueryFetch(controller: QueryController): void {
  clearQueryTimer(controller);
  if (controller.subscriberCount <= 0) {
    return;
  }
  const interval = controller.spec.resolveIntervalMs(getQueryState(controller.spec.key).data);
  if (interval === false || interval <= 0) {
    return;
  }
  controller.timer = setTimeout(() => {
    controller.timer = null;
    void runQueryFetch(controller);
  }, interval);
}

async function runQueryFetch(controller: QueryController): Promise<void> {
  const token = ++controller.token;
  const key = controller.spec.key;
  const current = getQueryState(key);
  setQueryState(key, {
    data: current.data,
    error: null,
    isLoading: current.data === null,
    isFetching: true,
  });

  try {
    const data = await controller.spec.fetch();
    if (token !== controller.token) {
      return;
    }
    controller.lastFetchedAt = Date.now();
    setQueryState(key, { data, error: null, isLoading: false, isFetching: false });
  } catch (error) {
    if (token !== controller.token) {
      return;
    }
    setQueryState(key, {
      data: getQueryState(key).data,
      error: toError(error),
      isLoading: false,
      isFetching: false,
    });
  } finally {
    if (token === controller.token) {
      scheduleNextQueryFetch(controller);
    }
  }
}

function watchOverviewQuery(spec: QuerySpec): () => void {
  const existing = queryControllers.get(spec.key);
  if (existing) {
    existing.spec = spec;
    existing.subscriberCount += 1;
    if (Date.now() - existing.lastFetchedAt >= spec.staleTimeMs) {
      void runQueryFetch(existing);
    } else {
      scheduleNextQueryFetch(existing);
    }
    return () => unwatchOverviewQuery(spec.key);
  }

  const controller: QueryController = {
    spec,
    subscriberCount: 1,
    token: 0,
    lastFetchedAt: 0,
    timer: null,
    invalidationUnsub: NOOP,
  };
  queryControllers.set(spec.key, controller);
  controller.invalidationUnsub = subscribeInvalidationScope(spec.scope, () => {
    void runQueryFetch(controller);
  });
  void runQueryFetch(controller);
  return () => unwatchOverviewQuery(spec.key);
}

function unwatchOverviewQuery(key: string): void {
  const controller = queryControllers.get(key);
  if (!controller) {
    return;
  }
  controller.subscriberCount -= 1;
  if (controller.subscriberCount > 0) {
    return;
  }
  clearQueryTimer(controller);
  controller.invalidationUnsub();
  controller.token += 1;
  queryControllers.delete(key);
}

function getOverviewQuerySnapshot(key: string | null): OverviewQueryState<unknown> {
  if (key === null) {
    return EMPTY_QUERY_STATE;
  }
  return getQueryState(key);
}

// ---------------------------------------------------------------------------
// Change request list (open)
// ---------------------------------------------------------------------------

function changeRequestListKey(environmentId: EnvironmentId, cwd: string): string {
  return ["list", environmentId, cwd].join(FIELD_SEPARATOR);
}

export interface OverviewChangeRequestListTarget {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly enabled: boolean;
}

export function getOverviewChangeRequestListKey(
  target: OverviewChangeRequestListTarget,
): string | null {
  if (!target.enabled || target.environmentId === null || target.cwd === null) {
    return null;
  }
  return changeRequestListKey(target.environmentId, target.cwd);
}

export function watchOverviewChangeRequestList(
  target: OverviewChangeRequestListTarget,
): () => void {
  const key = getOverviewChangeRequestListKey(target);
  if (key === null || target.environmentId === null || target.cwd === null) {
    return NOOP;
  }
  const environmentId = target.environmentId;
  const cwd = target.cwd;
  return watchOverviewQuery({
    key,
    scope: sourceControlScopeKey(cwd),
    staleTimeMs: CHANGE_REQUEST_LIST_STALE_TIME_MS,
    fetch: () =>
      requireEnvironmentConnection(environmentId).client.sourceControl.listChangeRequests({
        cwd,
        state: "open",
        limit: OVERVIEW_CHANGE_REQUEST_LIST_LIMIT,
      }),
    resolveIntervalMs: () => false,
  });
}

export function getOverviewChangeRequestListSnapshot(
  target: OverviewChangeRequestListTarget,
): OverviewQueryState<ReadonlyArray<ChangeRequest>> {
  return getOverviewQuerySnapshot(getOverviewChangeRequestListKey(target)) as OverviewQueryState<
    ReadonlyArray<ChangeRequest>
  >;
}

// ---------------------------------------------------------------------------
// Change request detail (30s polling while open)
// ---------------------------------------------------------------------------

function changeRequestDetailKey(
  environmentId: EnvironmentId,
  cwd: string,
  reference: string,
): string {
  return ["detail", environmentId, cwd, reference].join(FIELD_SEPARATOR);
}

export interface OverviewChangeRequestDetailTarget {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly reference: string | null;
  readonly enabled: boolean;
}

export function getOverviewChangeRequestDetailKey(
  target: OverviewChangeRequestDetailTarget,
): string | null {
  if (
    !target.enabled ||
    target.environmentId === null ||
    target.cwd === null ||
    target.reference === null
  ) {
    return null;
  }
  return changeRequestDetailKey(target.environmentId, target.cwd, target.reference);
}

export function watchOverviewChangeRequestDetail(
  target: OverviewChangeRequestDetailTarget,
): () => void {
  const key = getOverviewChangeRequestDetailKey(target);
  if (
    key === null ||
    target.environmentId === null ||
    target.cwd === null ||
    target.reference === null
  ) {
    return NOOP;
  }
  const environmentId = target.environmentId;
  const cwd = target.cwd;
  const reference = target.reference;
  return watchOverviewQuery({
    key,
    scope: sourceControlScopeKey(cwd),
    staleTimeMs: CHANGE_REQUEST_DETAIL_STALE_TIME_MS,
    fetch: () =>
      requireEnvironmentConnection(environmentId).client.sourceControl.getChangeRequestDetail({
        cwd,
        reference,
      }),
    resolveIntervalMs: (data) =>
      (data as SourceControlChangeRequestDetail | null)?.state === "open"
        ? CHANGE_REQUEST_DETAIL_OPEN_REFETCH_INTERVAL_MS
        : false,
  });
}

export function getOverviewChangeRequestDetailSnapshot(
  target: OverviewChangeRequestDetailTarget,
): OverviewQueryState<SourceControlChangeRequestDetail> {
  return getOverviewQuerySnapshot(
    getOverviewChangeRequestDetailKey(target),
  ) as OverviewQueryState<SourceControlChangeRequestDetail>;
}

// ---------------------------------------------------------------------------
// Workflow runs (dynamic post-push / active polling)
// ---------------------------------------------------------------------------

function workflowRunsKey(
  environmentId: EnvironmentId,
  cwd: string,
  pullRequestNumber: number | null,
  branch: string | null,
  commitSha: string | null,
): string {
  return [
    "workflows",
    environmentId,
    cwd,
    pullRequestNumber === null ? "" : String(pullRequestNumber),
    branch ?? "",
    commitSha ?? "",
  ].join(FIELD_SEPARATOR);
}

export interface OverviewWorkflowRunsTarget {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly pullRequestNumber: number | null;
  /** Branch to scope runs to when there is no pull request (default branch). */
  readonly branch: string | null;
  readonly commitSha: string | null;
  readonly enabled: boolean;
}

export function getOverviewWorkflowRunsKey(target: OverviewWorkflowRunsTarget): string | null {
  if (
    !target.enabled ||
    target.environmentId === null ||
    target.cwd === null ||
    (target.pullRequestNumber === null && target.branch === null)
  ) {
    return null;
  }
  return workflowRunsKey(
    target.environmentId,
    target.cwd,
    target.pullRequestNumber,
    target.branch,
    target.commitSha,
  );
}

export function watchOverviewWorkflowRuns(
  target: OverviewWorkflowRunsTarget,
  resolveIntervalMs: (data: SourceControlWorkflowRunListResult | null) => number | false,
): () => void {
  const key = getOverviewWorkflowRunsKey(target);
  if (
    key === null ||
    target.environmentId === null ||
    target.cwd === null ||
    (target.pullRequestNumber === null && target.branch === null)
  ) {
    return NOOP;
  }
  const environmentId = target.environmentId;
  const cwd = target.cwd;
  const pullRequestNumber = target.pullRequestNumber;
  const branch = target.branch;
  const commitSha = target.commitSha;
  return watchOverviewQuery({
    key,
    scope: sourceControlScopeKey(cwd),
    staleTimeMs: WORKFLOW_RUNS_STALE_TIME_MS,
    fetch: () =>
      requireEnvironmentConnection(environmentId).client.sourceControl.listWorkflowRuns({
        cwd,
        ...(pullRequestNumber !== null ? { pullRequestNumber } : {}),
        ...(pullRequestNumber === null && branch !== null ? { branch } : {}),
        ...(commitSha !== null ? { commitSha } : {}),
        limit: OVERVIEW_WORKFLOW_RUNS_LIMIT,
      }),
    resolveIntervalMs: (data) =>
      resolveIntervalMs(data as SourceControlWorkflowRunListResult | null),
  });
}

export function getOverviewWorkflowRunsSnapshot(
  target: OverviewWorkflowRunsTarget,
): OverviewQueryState<SourceControlWorkflowRunListResult> {
  return getOverviewQuerySnapshot(
    getOverviewWorkflowRunsKey(target),
  ) as OverviewQueryState<SourceControlWorkflowRunListResult>;
}

// ---------------------------------------------------------------------------
// Workflow run jobs (per-run, 30s polling for the active run)
// ---------------------------------------------------------------------------

export interface WorkflowRunJobsEntry {
  readonly jobs: ReadonlyArray<SourceControlWorkflowJob> | null;
  readonly isLoading: boolean;
  readonly error: Error | null;
  readonly fetchedAt: number;
}

export type WorkflowRunJobsMap = ReadonlyMap<string, WorkflowRunJobsEntry>;

const EMPTY_WORKFLOW_RUN_JOBS_MAP: WorkflowRunJobsMap = Object.freeze(new Map());

const EMPTY_WORKFLOW_RUN_JOBS_ATOM = Atom.make(EMPTY_WORKFLOW_RUN_JOBS_MAP).pipe(
  Atom.keepAlive,
  Atom.withLabel("overview-workflow-run-jobs:null"),
);

const knownWorkflowRunJobsKeys = new Set<string>();

const workflowRunJobsStateAtoms = Atom.family((key: string) => {
  knownWorkflowRunJobsKeys.add(key);
  return Atom.make(EMPTY_WORKFLOW_RUN_JOBS_MAP).pipe(
    Atom.keepAlive,
    Atom.withLabel(`overview-workflow-run-jobs:${key}`),
  );
});

interface WorkflowRunJobsController {
  readonly key: string;
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly scope: string;
  subscriberCount: number;
  runIds: ReadonlyArray<string>;
  activeRunId: string | null;
  readonly tokensByRun: Map<string, number>;
  timer: ReturnType<typeof setTimeout> | null;
  invalidationUnsub: () => void;
}

const workflowRunJobsControllers = new Map<string, WorkflowRunJobsController>();

function workflowRunJobsScopeId(environmentId: EnvironmentId, cwd: string): string {
  return [environmentId, cwd].join(FIELD_SEPARATOR);
}

function getWorkflowRunJobsMap(key: string): WorkflowRunJobsMap {
  return appAtomRegistry.get(workflowRunJobsStateAtoms(key));
}

function setWorkflowRunJobsEntry(key: string, runId: string, entry: WorkflowRunJobsEntry): void {
  const current = getWorkflowRunJobsMap(key);
  const next = new Map(current);
  next.set(runId, entry);
  appAtomRegistry.set(workflowRunJobsStateAtoms(key), next);
}

async function fetchWorkflowRunJobs(
  controller: WorkflowRunJobsController,
  runId: string,
): Promise<void> {
  const token = (controller.tokensByRun.get(runId) ?? 0) + 1;
  controller.tokensByRun.set(runId, token);
  const previous = getWorkflowRunJobsMap(controller.key).get(runId);
  setWorkflowRunJobsEntry(controller.key, runId, {
    jobs: previous?.jobs ?? null,
    isLoading: (previous?.jobs ?? null) === null,
    error: null,
    fetchedAt: previous?.fetchedAt ?? 0,
  });

  try {
    const result: SourceControlWorkflowRunJobsResult = await requireEnvironmentConnection(
      controller.environmentId,
    ).client.sourceControl.getWorkflowRunJobs({ cwd: controller.cwd, runId });
    if (controller.tokensByRun.get(runId) !== token) {
      return;
    }
    setWorkflowRunJobsEntry(controller.key, runId, {
      jobs: result.jobs,
      isLoading: false,
      error: null,
      fetchedAt: Date.now(),
    });
  } catch (error) {
    if (controller.tokensByRun.get(runId) !== token) {
      return;
    }
    const current = getWorkflowRunJobsMap(controller.key).get(runId);
    setWorkflowRunJobsEntry(controller.key, runId, {
      jobs: current?.jobs ?? null,
      isLoading: false,
      error: toError(error),
      fetchedAt: Date.now(),
    });
  }
}

function clearWorkflowRunJobsTimer(controller: WorkflowRunJobsController): void {
  if (controller.timer !== null) {
    clearTimeout(controller.timer);
    controller.timer = null;
  }
}

function scheduleActiveWorkflowRunJobsPoll(controller: WorkflowRunJobsController): void {
  clearWorkflowRunJobsTimer(controller);
  if (controller.subscriberCount <= 0 || controller.activeRunId === null) {
    return;
  }
  const activeRunId = controller.activeRunId;
  controller.timer = setTimeout(() => {
    controller.timer = null;
    void fetchWorkflowRunJobs(controller, activeRunId).finally(() => {
      scheduleActiveWorkflowRunJobsPoll(controller);
    });
  }, ACTIVE_WORKFLOW_RUN_JOBS_REFETCH_INTERVAL_MS);
}

function ensureWorkflowRunJobsFetched(controller: WorkflowRunJobsController): void {
  const map = getWorkflowRunJobsMap(controller.key);
  const now = Date.now();
  for (const runId of controller.runIds) {
    const entry = map.get(runId);
    if (!entry || (entry.jobs === null && !entry.isLoading)) {
      void fetchWorkflowRunJobs(controller, runId);
      continue;
    }
    if (entry.jobs !== null && now - entry.fetchedAt >= WORKFLOW_RUN_JOBS_STALE_TIME_MS) {
      void fetchWorkflowRunJobs(controller, runId);
    }
  }
}

export interface OverviewWorkflowRunJobsTarget {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly runIds: ReadonlyArray<string>;
  readonly activeRunId: string | null;
  readonly enabled: boolean;
}

export function getOverviewWorkflowRunJobsKey(
  target: OverviewWorkflowRunJobsTarget,
): string | null {
  if (
    !target.enabled ||
    target.environmentId === null ||
    target.cwd === null ||
    target.runIds.length === 0
  ) {
    return null;
  }
  return workflowRunJobsScopeId(target.environmentId, target.cwd);
}

export function watchOverviewWorkflowRunJobs(target: OverviewWorkflowRunJobsTarget): () => void {
  const key = getOverviewWorkflowRunJobsKey(target);
  if (key === null || target.environmentId === null || target.cwd === null) {
    return NOOP;
  }
  const environmentId = target.environmentId;
  const cwd = target.cwd;

  let controller = workflowRunJobsControllers.get(key);
  if (!controller) {
    controller = {
      key,
      environmentId,
      cwd,
      scope: sourceControlScopeKey(cwd),
      subscriberCount: 0,
      runIds: [],
      activeRunId: null,
      tokensByRun: new Map(),
      timer: null,
      invalidationUnsub: NOOP,
    };
    workflowRunJobsControllers.set(key, controller);
    controller.invalidationUnsub = subscribeInvalidationScope(controller.scope, () => {
      const activeController = workflowRunJobsControllers.get(key);
      if (!activeController) {
        return;
      }
      for (const runId of activeController.runIds) {
        void fetchWorkflowRunJobs(activeController, runId);
      }
    });
  }

  controller.subscriberCount += 1;
  controller.runIds = [...target.runIds];
  controller.activeRunId = target.activeRunId;
  ensureWorkflowRunJobsFetched(controller);
  scheduleActiveWorkflowRunJobsPoll(controller);

  return () => unwatchOverviewWorkflowRunJobs(key);
}

function unwatchOverviewWorkflowRunJobs(key: string): void {
  const controller = workflowRunJobsControllers.get(key);
  if (!controller) {
    return;
  }
  controller.subscriberCount -= 1;
  if (controller.subscriberCount > 0) {
    return;
  }
  clearWorkflowRunJobsTimer(controller);
  controller.invalidationUnsub();
  workflowRunJobsControllers.delete(key);
}

export function getOverviewWorkflowRunJobsAtom(key: string | null): Atom.Atom<WorkflowRunJobsMap> {
  return key === null ? EMPTY_WORKFLOW_RUN_JOBS_ATOM : workflowRunJobsStateAtoms(key);
}

export interface OverviewWorkflowRunJobsResult {
  readonly jobsByRunId: Map<string, ReadonlyArray<SourceControlWorkflowJob>>;
  readonly isLoading: boolean;
}

export function selectOverviewWorkflowRunJobs(
  map: WorkflowRunJobsMap,
  runIds: ReadonlyArray<string>,
  enabled: boolean,
): OverviewWorkflowRunJobsResult {
  const jobsByRunId = new Map<string, ReadonlyArray<SourceControlWorkflowJob>>();
  if (!enabled || runIds.length === 0) {
    return { jobsByRunId, isLoading: false };
  }
  let isLoading = false;
  for (const runId of runIds) {
    const entry = map.get(runId);
    if (!entry || (entry.jobs === null && entry.error === null)) {
      isLoading = true;
      continue;
    }
    if (entry.jobs !== null) {
      jobsByRunId.set(runId, entry.jobs);
    }
  }
  return { jobsByRunId, isLoading };
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

export function clearOverviewAtomState(): void {
  for (const controller of queryControllers.values()) {
    clearQueryTimer(controller);
    controller.invalidationUnsub();
    controller.token += 1;
  }
  queryControllers.clear();
  for (const controller of workflowRunJobsControllers.values()) {
    clearWorkflowRunJobsTimer(controller);
    controller.invalidationUnsub();
  }
  workflowRunJobsControllers.clear();

  for (const key of knownQueryKeys) {
    appAtomRegistry.set(queryStateAtoms(key), INITIAL_QUERY_STATE);
  }
  knownQueryKeys.clear();
  for (const key of knownWorkflowRunJobsKeys) {
    appAtomRegistry.set(workflowRunJobsStateAtoms(key), EMPTY_WORKFLOW_RUN_JOBS_MAP);
  }
  knownWorkflowRunJobsKeys.clear();
}

export const resetOverviewAtomsForTests = clearOverviewAtomState;
