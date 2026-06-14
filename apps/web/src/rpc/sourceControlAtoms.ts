import type {
  ChangeRequest,
  EnvironmentId,
  SourceControlAssigneeCandidate,
  SourceControlChangeRequestDetail,
  SourceControlIssueDetail,
  SourceControlIssueSummary,
  SourceControlLabel,
} from "@ryco/contracts";
import { Atom } from "effect/unstable/reactivity";

import { requireEnvironmentConnection } from "~/environments/runtime";
import { appAtomRegistry } from "./atomRegistry";

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

const KEY_SEP = "\u0000";
const NOOP: () => void = () => undefined;

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

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

// ---------------------------------------------------------------------------
// Shared keyed-query infrastructure
// ---------------------------------------------------------------------------

const knownStateKeys = new Set<string>();

const queryStateAtom = Atom.family((compositeKey: string) => {
  knownStateKeys.add(compositeKey);
  return Atom.make<SourceControlQueryState<unknown>>(INITIAL_QUERY_STATE).pipe(
    Atom.keepAlive,
    Atom.withLabel(`source-control:${compositeKey}`),
  );
});

const EMPTY_QUERY_ATOM = Atom.make<SourceControlQueryState<unknown>>(INITIAL_QUERY_STATE).pipe(
  Atom.keepAlive,
  Atom.withLabel("source-control:null"),
);

interface QueryController {
  readonly compositeKey: string;
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly staleTime: number;
  readonly run: () => Promise<unknown>;
  subscriberCount: number;
  lastFetchedAt: number;
  fetchToken: number;
  hasData: boolean;
  fetching: boolean;
}

const controllers = new Map<string, QueryController>();

function setQueryState(compositeKey: string, next: SourceControlQueryState<unknown>): void {
  appAtomRegistry.set(queryStateAtom(compositeKey), next);
}

function getQueryState(compositeKey: string): SourceControlQueryState<unknown> {
  return appAtomRegistry.get(queryStateAtom(compositeKey));
}

async function runController(controller: QueryController): Promise<void> {
  const token = ++controller.fetchToken;
  controller.fetching = true;
  const current = getQueryState(controller.compositeKey);
  setQueryState(controller.compositeKey, {
    data: current.data,
    isLoading: current.data === null,
    isFetching: true,
    error: null,
  });

  try {
    const data = await controller.run();
    if (token !== controller.fetchToken) {
      return;
    }
    controller.fetching = false;
    controller.hasData = true;
    controller.lastFetchedAt = Date.now();
    setQueryState(controller.compositeKey, {
      data,
      isLoading: false,
      isFetching: false,
      error: null,
    });
  } catch (error) {
    if (token !== controller.fetchToken) {
      return;
    }
    controller.fetching = false;
    setQueryState(controller.compositeKey, {
      data: getQueryState(controller.compositeKey).data,
      isLoading: false,
      isFetching: false,
      error: toError(error),
    });
  }
}

interface QueryDefinition<TInput, TData> {
  readonly label: string;
  readonly staleTime: number;
  readonly isEnabled: (input: TInput) => boolean;
  readonly buildKey: (input: TInput) => string;
  readonly resolveEnvironmentId: (input: TInput) => EnvironmentId;
  readonly resolveCwd: (input: TInput) => string;
  readonly run: (input: TInput) => Promise<TData>;
}

export interface QueryBinding<TInput, TData> {
  readonly targetKey: (input: TInput) => string | null;
  readonly atomFor: (input: TInput) => Atom.Atom<SourceControlQueryState<TData>>;
  readonly snapshotFor: (input: TInput) => SourceControlQueryState<TData>;
  readonly watch: (input: TInput) => () => void;
}

function defineQuery<TInput, TData>(
  definition: QueryDefinition<TInput, TData>,
): QueryBinding<TInput, TData> {
  function compositeKeyFor(input: TInput): string | null {
    if (!definition.isEnabled(input)) {
      return null;
    }
    return `${definition.label}${KEY_SEP}${definition.buildKey(input)}`;
  }

  function atomFor(input: TInput): Atom.Atom<SourceControlQueryState<TData>> {
    const compositeKey = compositeKeyFor(input);
    return (compositeKey === null ? EMPTY_QUERY_ATOM : queryStateAtom(compositeKey)) as Atom.Atom<
      SourceControlQueryState<TData>
    >;
  }

  function snapshotFor(input: TInput): SourceControlQueryState<TData> {
    const compositeKey = compositeKeyFor(input);
    if (compositeKey === null) {
      return INITIAL_QUERY_STATE as SourceControlQueryState<TData>;
    }
    return getQueryState(compositeKey) as SourceControlQueryState<TData>;
  }

  function watch(input: TInput): () => void {
    const compositeKey = compositeKeyFor(input);
    if (compositeKey === null) {
      return NOOP;
    }

    let controller = controllers.get(compositeKey);
    if (!controller) {
      controller = {
        compositeKey,
        environmentId: definition.resolveEnvironmentId(input),
        cwd: definition.resolveCwd(input),
        staleTime: definition.staleTime,
        run: () => definition.run(input),
        subscriberCount: 0,
        lastFetchedAt: 0,
        fetchToken: 0,
        hasData: false,
        fetching: false,
      };
      controllers.set(compositeKey, controller);
    }

    controller.subscriberCount += 1;
    const isStale =
      controller.hasData && Date.now() - controller.lastFetchedAt >= controller.staleTime;
    if (!controller.fetching && (!controller.hasData || isStale)) {
      void runController(controller);
    }

    return () => {
      const current = controllers.get(compositeKey);
      if (!current) {
        return;
      }
      current.subscriberCount = Math.max(0, current.subscriberCount - 1);
    };
  }

  return { targetKey: compositeKeyFor, atomFor, snapshotFor, watch };
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
    if (cwd !== null && controller.cwd !== cwd) {
      continue;
    }
    controller.hasData = false;
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
  for (const controller of controllers.values()) {
    controller.fetchToken += 1;
  }
  controllers.clear();
  detailCache.clear();
  for (const compositeKey of knownStateKeys) {
    appAtomRegistry.set(queryStateAtom(compositeKey), INITIAL_QUERY_STATE);
  }
  knownStateKeys.clear();
}
