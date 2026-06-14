import type {
  AtlassianConnectionSummary,
  AtlassianProjectLink,
  EnvironmentId,
  ProjectId,
} from "@ryco/contracts";
import { Atom } from "effect/unstable/reactivity";

import { requireEnvironmentConnection } from "~/environments/runtime";
import { appAtomRegistry } from "./atomRegistry";

// ---------------------------------------------------------------------------
// Atom-backed Atlassian reads.
//
// Replaces the React Query `["atlassian", "connections", ...]` and
// `["atlassian", "project-link", ...]` reads in the settings/project-settings
// surfaces. Both reads are reactive (`watch` + state atoms) and scoped by
// environment (and project, for links) so mutations can invalidate them the
// way the former `queryClient.invalidateQueries({ queryKey: ["atlassian"] })`
// did. A zero stale time mirrors the previous `useQuery` calls, which refetched
// on every mount.
// ---------------------------------------------------------------------------

const CONNECTIONS_STALE_TIME_MS = 0;
const PROJECT_LINK_STALE_TIME_MS = 0;

const KEY_SEP = "\u0000";
const NOOP: () => void = () => undefined;

export interface AtlassianQueryState<T> {
  readonly data: T | null;
  readonly isLoading: boolean;
  readonly isFetching: boolean;
  readonly isError: boolean;
  readonly error: Error | null;
}

const INITIAL_QUERY_STATE: AtlassianQueryState<never> = Object.freeze({
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
  return Atom.make<AtlassianQueryState<unknown>>(INITIAL_QUERY_STATE).pipe(
    Atom.keepAlive,
    Atom.withLabel(`atlassian:${compositeKey}`),
  );
});

const EMPTY_QUERY_ATOM = Atom.make<AtlassianQueryState<unknown>>(INITIAL_QUERY_STATE).pipe(
  Atom.keepAlive,
  Atom.withLabel("atlassian:null"),
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

function setQueryState(compositeKey: string, next: AtlassianQueryState<unknown>): void {
  appAtomRegistry.set(queryStateAtom(compositeKey), next);
}

function getQueryState(compositeKey: string): AtlassianQueryState<unknown> {
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

export interface AtlassianQuery<TInput, TData> {
  readonly keyOf: (input: TInput) => string | null;
  readonly watch: (input: TInput) => () => void;
  readonly refresh: (compositeKey: string | null) => void;
  readonly getAtom: (compositeKey: string | null) => Atom.Atom<AtlassianQueryState<TData>>;
  readonly getSnapshot: (compositeKey: string | null) => AtlassianQueryState<TData>;
}

function defineQuery<TInput, TData>(
  definition: QueryDefinition<TInput, TData>,
): AtlassianQuery<TInput, TData> {
  function keyOf(input: TInput): string | null {
    if (!definition.isEnabled(input)) {
      return null;
    }
    return `${definition.label}${KEY_SEP}${definition.buildKey(input)}`;
  }

  function getAtom(compositeKey: string | null): Atom.Atom<AtlassianQueryState<TData>> {
    return (compositeKey === null ? EMPTY_QUERY_ATOM : queryStateAtom(compositeKey)) as Atom.Atom<
      AtlassianQueryState<TData>
    >;
  }

  function getSnapshot(compositeKey: string | null): AtlassianQueryState<TData> {
    if (compositeKey === null) {
      return INITIAL_QUERY_STATE as AtlassianQueryState<TData>;
    }
    return getQueryState(compositeKey) as AtlassianQueryState<TData>;
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

function atlassianClient(environmentId: EnvironmentId) {
  return requireEnvironmentConnection(environmentId).client.atlassian;
}

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

export interface AtlassianConnectionsInput {
  readonly environmentId: EnvironmentId | null;
  readonly enabled?: boolean;
}

export const atlassianConnectionsQuery = defineQuery<
  AtlassianConnectionsInput,
  ReadonlyArray<AtlassianConnectionSummary>
>({
  label: "connections",
  staleTime: CONNECTIONS_STALE_TIME_MS,
  isEnabled: (input) => (input.enabled ?? true) && input.environmentId !== null,
  buildKey: (input) => `${input.environmentId}`,
  resolveEnvironmentId: (input) => input.environmentId as EnvironmentId,
  resolveProjectId: () => null,
  run: (input) => atlassianClient(input.environmentId as EnvironmentId).listConnections(),
});

// ---------------------------------------------------------------------------
// Project link
// ---------------------------------------------------------------------------

export interface AtlassianProjectLinkInput {
  readonly environmentId: EnvironmentId | null;
  readonly projectId: ProjectId | null;
  readonly enabled?: boolean;
}

export const atlassianProjectLinkQuery = defineQuery<
  AtlassianProjectLinkInput,
  AtlassianProjectLink | null
>({
  label: "project-link",
  staleTime: PROJECT_LINK_STALE_TIME_MS,
  isEnabled: (input) =>
    (input.enabled ?? true) && input.environmentId !== null && input.projectId !== null,
  buildKey: (input) => `${input.environmentId}${KEY_SEP}${input.projectId}`,
  resolveEnvironmentId: (input) => input.environmentId as EnvironmentId,
  resolveProjectId: (input) => input.projectId,
  run: (input) =>
    atlassianClient(input.environmentId as EnvironmentId).getProjectLink({
      projectId: input.projectId as ProjectId,
    }),
});

// ---------------------------------------------------------------------------
// Invalidation
//
// Mirrors React Query's prefix invalidation previously triggered via
// `queryClient.invalidateQueries({ queryKey: ["atlassian"] })`, optionally
// scoped by environment. Mounted reads refetch immediately; idle ones are
// dropped so their next mount refetches.
// ---------------------------------------------------------------------------

export function invalidateAtlassian(input?: {
  readonly environmentId?: EnvironmentId | null;
}): void {
  const environmentId = input?.environmentId ?? null;

  for (const controller of controllers.values()) {
    if (environmentId !== null && controller.environmentId !== environmentId) {
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

export function resetAtlassianAtomsForTests(): void {
  for (const controller of controllers.values()) {
    controller.fetchToken += 1;
  }
  controllers.clear();
  for (const compositeKey of knownStateKeys) {
    appAtomRegistry.set(queryStateAtom(compositeKey), INITIAL_QUERY_STATE);
  }
  knownStateKeys.clear();
}
