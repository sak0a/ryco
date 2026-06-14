import type {
  AtlassianConnectionId,
  EnvironmentId,
  ProjectId,
  WorkItemDetail as WorkItemDetailModel,
  WorkItemProject,
  WorkItemStateFilter,
  WorkItemSummary,
} from "@ryco/contracts";
import { Atom } from "effect/unstable/reactivity";

import { requireEnvironmentConnection } from "~/environments/runtime";
import { appAtomRegistry } from "./atomRegistry";

// ---------------------------------------------------------------------------
// Atom-backed work-item reads.
//
// Replaces the React Query `workItem*QueryOptions` helpers in
// `~/lib/workItemsRpc` (project discovery, list, search, detail). List/search/
// detail/project reads are reactive (`watch` + state atoms) and scoped by
// environment + project for invalidation, matching the previous
// `queryClient.invalidateQueries({ queryKey: workItemsQueryKeys.all })`.
// ---------------------------------------------------------------------------

const LIST_STALE_TIME_MS = 60_000;
const SEARCH_STALE_TIME_MS = 30_000;
const DETAIL_STALE_TIME_MS = 60_000;
const PROJECTS_STALE_TIME_MS = 5 * 60_000;

const KEY_SEP = "\u0000";
const NOOP: () => void = () => undefined;

export interface WorkItemQueryState<T> {
  readonly data: T | null;
  readonly isLoading: boolean;
  readonly isFetching: boolean;
  readonly isError: boolean;
  readonly error: Error | null;
}

const INITIAL_QUERY_STATE: WorkItemQueryState<never> = Object.freeze({
  data: null,
  isLoading: false,
  isFetching: false,
  isError: false,
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
  return Atom.make<WorkItemQueryState<unknown>>(INITIAL_QUERY_STATE).pipe(
    Atom.keepAlive,
    Atom.withLabel(`work-items:${compositeKey}`),
  );
});

const EMPTY_QUERY_ATOM = Atom.make<WorkItemQueryState<unknown>>(INITIAL_QUERY_STATE).pipe(
  Atom.keepAlive,
  Atom.withLabel("work-items:null"),
);

interface QueryController {
  readonly compositeKey: string;
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId | null;
  readonly staleTime: number;
  readonly run: () => Promise<unknown>;
  subscriberCount: number;
  lastFetchedAt: number;
  fetchToken: number;
  hasData: boolean;
}

const controllers = new Map<string, QueryController>();

function setQueryState(compositeKey: string, next: WorkItemQueryState<unknown>): void {
  appAtomRegistry.set(queryStateAtom(compositeKey), next);
}

function getQueryState(compositeKey: string): WorkItemQueryState<unknown> {
  return appAtomRegistry.get(queryStateAtom(compositeKey));
}

async function runController(controller: QueryController): Promise<void> {
  const token = ++controller.fetchToken;
  const current = getQueryState(controller.compositeKey);
  setQueryState(controller.compositeKey, {
    data: current.data,
    isLoading: current.data === null,
    isFetching: true,
    isError: false,
    error: null,
  });

  try {
    const data = await controller.run();
    if (token !== controller.fetchToken) {
      return;
    }
    controller.hasData = true;
    controller.lastFetchedAt = Date.now();
    setQueryState(controller.compositeKey, {
      data,
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
    });
  } catch (error) {
    if (token !== controller.fetchToken) {
      return;
    }
    setQueryState(controller.compositeKey, {
      data: getQueryState(controller.compositeKey).data,
      isLoading: false,
      isFetching: false,
      isError: true,
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
  readonly resolveProjectId: (input: TInput) => ProjectId | null;
  readonly run: (input: TInput) => Promise<TData>;
}

export interface WorkItemQuery<TInput, TData> {
  readonly keyOf: (input: TInput) => string | null;
  readonly watch: (input: TInput) => () => void;
  readonly refresh: (compositeKey: string | null) => void;
  readonly getAtom: (compositeKey: string | null) => Atom.Atom<WorkItemQueryState<TData>>;
  readonly getSnapshot: (compositeKey: string | null) => WorkItemQueryState<TData>;
}

function defineQuery<TInput, TData>(
  definition: QueryDefinition<TInput, TData>,
): WorkItemQuery<TInput, TData> {
  function keyOf(input: TInput): string | null {
    if (!definition.isEnabled(input)) {
      return null;
    }
    return `${definition.label}${KEY_SEP}${definition.buildKey(input)}`;
  }

  function getAtom(compositeKey: string | null): Atom.Atom<WorkItemQueryState<TData>> {
    return (compositeKey === null ? EMPTY_QUERY_ATOM : queryStateAtom(compositeKey)) as Atom.Atom<
      WorkItemQueryState<TData>
    >;
  }

  function getSnapshot(compositeKey: string | null): WorkItemQueryState<TData> {
    if (compositeKey === null) {
      return INITIAL_QUERY_STATE as WorkItemQueryState<TData>;
    }
    return getQueryState(compositeKey) as WorkItemQueryState<TData>;
  }

  function watch(input: TInput): () => void {
    const compositeKey = keyOf(input);
    if (compositeKey === null) {
      return NOOP;
    }

    let controller = controllers.get(compositeKey);
    if (!controller) {
      controller = {
        compositeKey,
        environmentId: definition.resolveEnvironmentId(input),
        projectId: definition.resolveProjectId(input),
        staleTime: definition.staleTime,
        run: () => definition.run(input),
        subscriberCount: 0,
        lastFetchedAt: 0,
        fetchToken: 0,
        hasData: false,
      };
      controllers.set(compositeKey, controller);
    }

    controller.subscriberCount += 1;
    if (!controller.hasData || Date.now() - controller.lastFetchedAt >= controller.staleTime) {
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

  function refresh(compositeKey: string | null): void {
    if (compositeKey === null) {
      return;
    }
    const controller = controllers.get(compositeKey);
    if (!controller) {
      return;
    }
    controller.lastFetchedAt = 0;
    void runController(controller);
  }

  return { keyOf, watch, refresh, getAtom, getSnapshot };
}

function workItemsClient(environmentId: EnvironmentId) {
  return requireEnvironmentConnection(environmentId).client.workItems;
}

// ---------------------------------------------------------------------------
// Project discovery
// ---------------------------------------------------------------------------

export interface WorkItemProjectsInput {
  readonly environmentId: EnvironmentId | null;
  readonly connectionId: AtlassianConnectionId | null;
  readonly siteUrl?: string;
  readonly enabled?: boolean;
}

export const workItemProjectsQuery = defineQuery<
  WorkItemProjectsInput,
  ReadonlyArray<WorkItemProject>
>({
  label: "projects",
  staleTime: PROJECTS_STALE_TIME_MS,
  isEnabled: (input) =>
    (input.enabled ?? true) && input.environmentId !== null && input.connectionId !== null,
  buildKey: (input) =>
    `${input.environmentId}${KEY_SEP}${input.connectionId}${KEY_SEP}${input.siteUrl?.trim() ?? ""}`,
  resolveEnvironmentId: (input) => input.environmentId as EnvironmentId,
  resolveProjectId: () => null,
  run: (input) => {
    const siteUrl = input.siteUrl?.trim() ?? "";
    return workItemsClient(input.environmentId as EnvironmentId).listProjects({
      connectionId: input.connectionId as AtlassianConnectionId,
      ...(siteUrl.length > 0 ? { siteUrl } : {}),
    });
  },
});

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export interface WorkItemListInput {
  readonly environmentId: EnvironmentId | null;
  readonly projectId: ProjectId | null;
  readonly state: WorkItemStateFilter;
  readonly limit?: number;
  readonly enabled?: boolean;
}

export const workItemListQuery = defineQuery<WorkItemListInput, ReadonlyArray<WorkItemSummary>>({
  label: "list",
  staleTime: LIST_STALE_TIME_MS,
  isEnabled: (input) =>
    (input.enabled ?? true) && input.environmentId !== null && input.projectId !== null,
  buildKey: (input) =>
    `${input.environmentId}${KEY_SEP}${input.projectId}${KEY_SEP}${input.state}${KEY_SEP}${input.limit ?? ""}`,
  resolveEnvironmentId: (input) => input.environmentId as EnvironmentId,
  resolveProjectId: (input) => input.projectId,
  run: (input) =>
    workItemsClient(input.environmentId as EnvironmentId).list({
      projectId: input.projectId as ProjectId,
      state: input.state,
      ...(input.limit !== undefined ? { limit: input.limit } : {}),
    }),
});

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface WorkItemSearchInput {
  readonly environmentId: EnvironmentId | null;
  readonly projectId: ProjectId | null;
  readonly query: string;
  readonly limit?: number;
  readonly enabled?: boolean;
}

export const workItemSearchQuery = defineQuery<WorkItemSearchInput, ReadonlyArray<WorkItemSummary>>(
  {
    label: "search",
    staleTime: SEARCH_STALE_TIME_MS,
    isEnabled: (input) =>
      (input.enabled ?? true) &&
      input.environmentId !== null &&
      input.projectId !== null &&
      input.query.trim().length > 0,
    buildKey: (input) =>
      `${input.environmentId}${KEY_SEP}${input.projectId}${KEY_SEP}${input.query.trim()}${KEY_SEP}${input.limit ?? ""}`,
    resolveEnvironmentId: (input) => input.environmentId as EnvironmentId,
    resolveProjectId: (input) => input.projectId,
    run: (input) =>
      workItemsClient(input.environmentId as EnvironmentId).search({
        projectId: input.projectId as ProjectId,
        query: input.query.trim(),
        ...(input.limit !== undefined ? { limit: input.limit } : {}),
      }),
  },
);

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

export interface WorkItemDetailInput {
  readonly environmentId: EnvironmentId | null;
  readonly projectId: ProjectId | null;
  readonly key: string;
  readonly fullContent?: boolean;
  readonly enabled?: boolean;
}

export const workItemDetailQuery = defineQuery<WorkItemDetailInput, WorkItemDetailModel>({
  label: "detail",
  staleTime: DETAIL_STALE_TIME_MS,
  isEnabled: (input) =>
    (input.enabled ?? true) &&
    input.environmentId !== null &&
    input.projectId !== null &&
    input.key.trim().length > 0,
  buildKey: (input) =>
    `${input.environmentId}${KEY_SEP}${input.projectId}${KEY_SEP}${input.key}${KEY_SEP}${input.fullContent ?? false}`,
  resolveEnvironmentId: (input) => input.environmentId as EnvironmentId,
  resolveProjectId: (input) => input.projectId,
  run: (input) =>
    workItemsClient(input.environmentId as EnvironmentId).get({
      projectId: input.projectId as ProjectId,
      key: input.key,
      fullContent: input.fullContent ?? false,
    }),
});

/**
 * Imperatively seed the cached detail for a work item (both truncated and
 * full-content variants), mirroring the former
 * `queryClient.setQueryData(workItemsQueryKeys.detail(...))` after comment and
 * field mutations.
 */
export function setWorkItemDetailCache(
  scope: { readonly environmentId: EnvironmentId; readonly projectId: ProjectId },
  key: string,
  detail: WorkItemDetailModel,
): void {
  for (const fullContent of [false, true]) {
    const compositeKey = workItemDetailQuery.keyOf({
      environmentId: scope.environmentId,
      projectId: scope.projectId,
      key,
      fullContent,
    });
    if (compositeKey === null) {
      continue;
    }
    const controller = controllers.get(compositeKey);
    if (controller) {
      controller.fetchToken += 1;
      controller.hasData = true;
      controller.lastFetchedAt = Date.now();
    }
    setQueryState(compositeKey, {
      data: detail,
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
    });
  }
}

// ---------------------------------------------------------------------------
// Invalidation
//
// Mirrors React Query's "refetch active queries, drop the rest" invalidation
// previously triggered via `queryClient.invalidateQueries({ queryKey:
// workItemsQueryKeys.all })`, scoped by environment and (optionally) project.
// ---------------------------------------------------------------------------

export function invalidateWorkItems(input?: {
  readonly environmentId?: EnvironmentId | null;
  readonly projectId?: ProjectId | null;
}): void {
  const environmentId = input?.environmentId ?? null;
  const projectId = input?.projectId ?? null;

  for (const controller of controllers.values()) {
    if (environmentId !== null && controller.environmentId !== environmentId) {
      continue;
    }
    if (projectId !== null && controller.projectId !== projectId) {
      continue;
    }
    controller.hasData = false;
    controller.lastFetchedAt = 0;
    if (controller.subscriberCount > 0) {
      void runController(controller);
    }
  }
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

export function resetWorkItemsAtomsForTests(): void {
  for (const controller of controllers.values()) {
    controller.fetchToken += 1;
  }
  controllers.clear();
  for (const compositeKey of knownStateKeys) {
    appAtomRegistry.set(queryStateAtom(compositeKey), INITIAL_QUERY_STATE);
  }
  knownStateKeys.clear();
}
