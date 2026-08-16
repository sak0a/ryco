import type {
  AtlassianConnectionSummary,
  AtlassianProjectLink,
  EnvironmentId,
  ProjectId,
} from "@ryco/contracts";
import { requireEnvironmentConnection } from "~/environments/runtime";
import { createKeyedQueryRegistry, defineKeyedQueryByKey, KEY_SEP } from "@ryco/client-runtime/rpc";

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

const atlassianRegistry = createKeyedQueryRegistry<AtlassianQueryState<unknown>>({
  labelPrefix: "atlassian",
  initialState: INITIAL_QUERY_STATE,
  buildFetchingState: (current) => ({
    data: current.data,
    isLoading: current.data === null,
    isFetching: true,
    isError: false,
    error: null,
  }),
  buildSuccessState: (data) => ({
    data,
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
  }),
  buildErrorState: (current, error) => ({
    data: current.data,
    isLoading: false,
    isFetching: false,
    isError: true,
    error,
  }),
});

const { controllers, runController } = atlassianRegistry;

export type AtlassianQuery<TInput, TData> = import("@ryco/client-runtime/rpc").KeyedQueryByKey<
  TInput,
  TData,
  AtlassianQueryState<TData>
>;

interface AtlassianQueryDefinition<TInput, TData> {
  readonly label: string;
  readonly staleTime: number;
  readonly isEnabled: (input: TInput) => boolean;
  readonly buildKey: (input: TInput) => string;
  readonly resolveEnvironmentId: (input: TInput) => EnvironmentId;
  readonly resolveProjectId: (input: TInput) => ProjectId | null;
  readonly run: (input: TInput) => Promise<TData>;
}

function defineQuery<TInput, TData>(
  definition: AtlassianQueryDefinition<TInput, TData>,
): AtlassianQuery<TInput, TData> {
  return defineKeyedQueryByKey(
    atlassianRegistry,
    {
      ...definition,
      createControllerFields: (input) => ({ projectId: definition.resolveProjectId(input) }),
    },
    (controller) =>
      !controller.hasData || Date.now() - controller.lastFetchedAt >= controller.staleTime,
  ) as AtlassianQuery<TInput, TData>;
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
    atlassianRegistry.cancel(controller);
    if (controller.subscriberCount > 0) {
      void runController(controller);
    }
  }
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

export function resetAtlassianAtomsForTests(): void {
  atlassianRegistry.resetForTests();
}
