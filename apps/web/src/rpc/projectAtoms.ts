import type { EnvironmentId, ProjectSearchEntriesResult } from "@ryco/contracts";
import { Atom } from "effect/unstable/reactivity";

import { ensureEnvironmentApi } from "~/environmentApi";
import { appAtomRegistry } from "./atomRegistry";

export const DEFAULT_PROJECT_SEARCH_ENTRIES_LIMIT = 80;
export const DEFAULT_PROJECT_SEARCH_ENTRIES_STALE_TIME_MS = 15_000;

export const EMPTY_PROJECT_SEARCH_ENTRIES_RESULT: ProjectSearchEntriesResult = Object.freeze({
  entries: [],
  truncated: false,
});

/**
 * Reactive state for a project entry search scope. Mirrors the observable
 * surface previously provided by React Query's `useQuery`:
 * - `data` keeps the most recently committed result while a new query loads
 *   (the former `placeholderData: (previous) => previous` behavior).
 * - `isLoading` is only true while the first result for a scope is in flight.
 * - `isFetching` is true whenever a request is in flight.
 */
export interface ProjectSearchEntriesState {
  readonly data: ProjectSearchEntriesResult | null;
  readonly isLoading: boolean;
  readonly isFetching: boolean;
  readonly error: Error | null;
}

/**
 * Identity of a project search scope: results are cached and retained per
 * environment + working directory + result limit, independent of the query.
 */
export interface ProjectSearchEntriesScope {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly limit?: number;
}

export interface ProjectSearchEntriesInput extends ProjectSearchEntriesScope {
  readonly query: string;
  readonly enabled?: boolean;
  readonly staleTime?: number;
}

interface ResolvedProjectSearchEntriesInput {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly query: string;
  readonly limit: number;
  readonly staleTime: number;
}

interface CacheEntry {
  readonly result: ProjectSearchEntriesResult;
  readonly fetchedAt: number;
}

interface ScopeRuntime {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly limit: number;
  token: number;
  inFlightQuery: string | null;
  lastInput: ResolvedProjectSearchEntriesInput | null;
  observerCount: number;
  readonly cache: Map<string, CacheEntry>;
}

const INITIAL_PROJECT_SEARCH_ENTRIES_STATE: ProjectSearchEntriesState = Object.freeze({
  data: null,
  isLoading: false,
  isFetching: false,
  error: null,
});

export const EMPTY_PROJECT_SEARCH_ENTRIES_STATE = INITIAL_PROJECT_SEARCH_ENTRIES_STATE;

const EMPTY_PROJECT_SEARCH_ENTRIES_ATOM = Atom.make(INITIAL_PROJECT_SEARCH_ENTRIES_STATE).pipe(
  Atom.keepAlive,
  Atom.withLabel("project-search-entries:null"),
);

const knownScopeKeys = new Set<string>();
const scopeRuntimes = new Map<string, ScopeRuntime>();

const projectSearchEntriesStateAtom = Atom.family((scopeKey: string) => {
  knownScopeKeys.add(scopeKey);
  return Atom.make(INITIAL_PROJECT_SEARCH_ENTRIES_STATE).pipe(
    Atom.keepAlive,
    Atom.withLabel(`project-search-entries:${scopeKey}`),
  );
});

function getScopeKey(environmentId: EnvironmentId, cwd: string, limit: number): string {
  return `${environmentId}::${cwd}::${limit}`;
}

export function resolveProjectSearchEntriesScopeKey(
  scope: ProjectSearchEntriesScope,
): string | null {
  if (scope.environmentId === null || scope.cwd === null) {
    return null;
  }
  return getScopeKey(
    scope.environmentId,
    scope.cwd,
    scope.limit ?? DEFAULT_PROJECT_SEARCH_ENTRIES_LIMIT,
  );
}

export function getProjectSearchEntriesStateAtom(scopeKey: string | null) {
  return scopeKey === null
    ? EMPTY_PROJECT_SEARCH_ENTRIES_ATOM
    : projectSearchEntriesStateAtom(scopeKey);
}

function resolveInput(input: ProjectSearchEntriesInput): ResolvedProjectSearchEntriesInput | null {
  const enabled =
    (input.enabled ?? true) &&
    input.environmentId !== null &&
    input.cwd !== null &&
    input.query.length > 0;
  if (!enabled || input.environmentId === null || input.cwd === null) {
    return null;
  }
  return {
    environmentId: input.environmentId,
    cwd: input.cwd,
    query: input.query,
    limit: input.limit ?? DEFAULT_PROJECT_SEARCH_ENTRIES_LIMIT,
    staleTime: input.staleTime ?? DEFAULT_PROJECT_SEARCH_ENTRIES_STALE_TIME_MS,
  };
}

function ensureScopeRuntime(
  environmentId: EnvironmentId,
  cwd: string,
  limit: number,
): ScopeRuntime {
  const scopeKey = getScopeKey(environmentId, cwd, limit);
  let runtime = scopeRuntimes.get(scopeKey);
  if (!runtime) {
    runtime = {
      environmentId,
      cwd,
      limit,
      token: 0,
      inFlightQuery: null,
      lastInput: null,
      observerCount: 0,
      cache: new Map(),
    };
    scopeRuntimes.set(scopeKey, runtime);
  }
  return runtime;
}

function setState(scopeKey: string, next: ProjectSearchEntriesState): void {
  const atom = projectSearchEntriesStateAtom(scopeKey);
  const current = appAtomRegistry.get(atom);
  if (
    current.data === next.data &&
    current.isLoading === next.isLoading &&
    current.isFetching === next.isFetching &&
    current.error === next.error
  ) {
    return;
  }
  appAtomRegistry.set(atom, next);
}

function markFetching(scopeKey: string): void {
  const current = appAtomRegistry.get(projectSearchEntriesStateAtom(scopeKey));
  setState(scopeKey, {
    data: current.data,
    isLoading: current.data === null,
    isFetching: true,
    error: null,
  });
}

function commitResult(scopeKey: string, result: ProjectSearchEntriesResult): void {
  setState(scopeKey, {
    data: result,
    isLoading: false,
    isFetching: false,
    error: null,
  });
}

function commitError(scopeKey: string, error: Error): void {
  const current = appAtomRegistry.get(projectSearchEntriesStateAtom(scopeKey));
  setState(scopeKey, {
    data: current.data,
    isLoading: false,
    isFetching: false,
    error,
  });
}

function startFetch(
  scopeKey: string,
  runtime: ScopeRuntime,
  resolved: ResolvedProjectSearchEntriesInput,
): void {
  const query = resolved.query;
  const token = ++runtime.token;
  runtime.inFlightQuery = query;
  markFetching(scopeKey);

  let api: ReturnType<typeof ensureEnvironmentApi>;
  try {
    api = ensureEnvironmentApi(resolved.environmentId);
  } catch (error) {
    if (runtime.token === token) {
      runtime.inFlightQuery = null;
      commitError(scopeKey, toError(error));
    }
    return;
  }

  api.projects
    .searchEntries({ cwd: resolved.cwd, query, limit: resolved.limit })
    .then((result) => {
      runtime.cache.set(query, { result, fetchedAt: Date.now() });
      if (runtime.token !== token) {
        return;
      }
      runtime.inFlightQuery = null;
      commitResult(scopeKey, result);
    })
    .catch((error) => {
      if (runtime.token !== token) {
        return;
      }
      runtime.inFlightQuery = null;
      commitError(scopeKey, toError(error));
    });
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Trigger a project entry search for the given input, honoring the same
 * gating, stale-time, and keep-previous-result semantics that the former
 * React Query options provided. Safe to call on every render: identical
 * in-flight queries and fresh cached results are deduplicated.
 */
export function requestProjectSearchEntries(
  input: ProjectSearchEntriesInput,
  options?: { readonly force?: boolean },
): void {
  const resolved = resolveInput(input);
  if (resolved === null) {
    return;
  }

  const scopeKey = getScopeKey(resolved.environmentId, resolved.cwd, resolved.limit);
  const runtime = ensureScopeRuntime(resolved.environmentId, resolved.cwd, resolved.limit);
  runtime.lastInput = resolved;

  if (!options?.force) {
    const cached = runtime.cache.get(resolved.query);
    if (cached && Date.now() - cached.fetchedAt < resolved.staleTime) {
      commitResult(scopeKey, cached.result);
      return;
    }
    if (runtime.inFlightQuery === resolved.query) {
      return;
    }
  }

  startFetch(scopeKey, runtime, resolved);
}

export function retainProjectSearchEntriesScope(scope: ProjectSearchEntriesScope): void {
  if (scope.environmentId === null || scope.cwd === null) {
    return;
  }
  const runtime = ensureScopeRuntime(
    scope.environmentId,
    scope.cwd,
    scope.limit ?? DEFAULT_PROJECT_SEARCH_ENTRIES_LIMIT,
  );
  runtime.observerCount += 1;
}

export function releaseProjectSearchEntriesScope(scope: ProjectSearchEntriesScope): void {
  const scopeKey = resolveProjectSearchEntriesScopeKey(scope);
  if (scopeKey === null) {
    return;
  }
  const runtime = scopeRuntimes.get(scopeKey);
  if (runtime && runtime.observerCount > 0) {
    runtime.observerCount -= 1;
  }
}

/**
 * Invalidate cached project search results, optionally scoped to an
 * environment and/or working directory. Mounted scopes (those with active
 * observers) refetch their last requested query immediately; idle scopes only
 * drop their cache so the next request fetches fresh data. This mirrors React
 * Query's "refetch active queries, mark the rest stale" invalidation.
 */
export function invalidateProjectSearchEntries(input?: {
  readonly environmentId?: EnvironmentId | null;
  readonly cwd?: string | null;
}): void {
  const environmentId = input?.environmentId ?? null;
  const cwd = input?.cwd ?? null;

  for (const runtime of scopeRuntimes.values()) {
    if (environmentId !== null && runtime.environmentId !== environmentId) {
      continue;
    }
    if (cwd !== null && runtime.cwd !== cwd) {
      continue;
    }

    runtime.cache.clear();
    if (runtime.observerCount > 0 && runtime.lastInput !== null) {
      requestProjectSearchEntries(runtime.lastInput, { force: true });
    }
  }
}

export function getProjectSearchEntriesSnapshot(
  input: ProjectSearchEntriesInput,
): ProjectSearchEntriesState {
  const scopeKey = resolveProjectSearchEntriesScopeKey(input);
  if (scopeKey === null) {
    return INITIAL_PROJECT_SEARCH_ENTRIES_STATE;
  }
  return appAtomRegistry.get(projectSearchEntriesStateAtom(scopeKey));
}

export function resetProjectAtomsForTests(): void {
  for (const key of knownScopeKeys) {
    appAtomRegistry.set(projectSearchEntriesStateAtom(key), INITIAL_PROJECT_SEARCH_ENTRIES_STATE);
  }
  knownScopeKeys.clear();
  scopeRuntimes.clear();
}
