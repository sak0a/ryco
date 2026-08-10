// React bindings over the workspace file cache (projectFilesAtoms): retain a key
// while the screen is mounted, read its atom state, and expose an imperative
// refetch for pull-to-refresh. The mobile counterpart of
// apps/web/src/rpc/useProjectPreview.ts, with web's `useFilesystemBrowse`
// connection-identity fencing folded in — mobile reads the live connection off
// the supervisor instead of the web connection store.
//
// Entry ordering is deliberately NOT applied here: the tree builder owns
// directories-first/natural ordering, and search results must keep the node's
// ranking.
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentConnection } from "@ryco/client-runtime/connection";
import {
  normalizeWorkspaceFileSearchQuery,
  WORKSPACE_FILE_SEARCH_DEBOUNCE_MS,
} from "@ryco/client-runtime/state/files";
import type {
  EnvironmentId,
  ProjectListEntriesResult,
  ProjectReadFileResult,
  ProjectSearchEntriesResult,
} from "@ryco/contracts";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { useConnectionRegistry } from "../providers/ConnectionRegistryProvider";
import {
  projectListEntriesQuery,
  projectReadFileQuery,
  projectSearchEntriesQuery,
  type ProjectFilesQuery,
  type ProjectFilesQueryState,
  type ProjectListEntriesInput,
  type ProjectReadFileInput,
  type ProjectSearchEntriesInput,
} from "./projectFilesAtoms";

export interface ProjectFilesQueryResult<T> extends ProjectFilesQueryState<T> {
  readonly refetch: () => Promise<{ readonly data: T | null }>;
}

export interface ProjectSearchEntriesQueryResult extends ProjectFilesQueryResult<ProjectSearchEntriesResult> {
  /** The box holds a query the debounce has not sent to the node yet. */
  readonly isDebouncing: boolean;
}

/**
 * The live connection for an environment, as an identity. A reconnect registers
 * a NEW connection object, which is the signal that whatever the previous client
 * still owed us is dead and the node may have moved on underneath us.
 */
function useEnvironmentConnection(
  environmentId: EnvironmentId | null,
): EnvironmentConnection | null {
  const { driver } = useConnectionRegistry();
  const readConnection = useCallback(
    () => (environmentId === null ? null : driver.supervisor.read(environmentId)),
    [driver, environmentId],
  );
  return useSyncExternalStore(driver.supervisor.subscribe, readConnection, readConnection);
}

function useProjectFilesQuery<TInput, TData>(
  query: ProjectFilesQuery<TInput, TData>,
  input: TInput,
  environmentId: EnvironmentId | null,
): ProjectFilesQueryResult<TData> {
  const cacheKey = query.keyOf(input);
  const connection = useEnvironmentConnection(environmentId);

  // The effect is keyed on the cache key and the connection identity; `input` is
  // read through a ref so a fresh object per render never re-subscribes.
  const inputRef = useRef(input);
  inputRef.current = input;
  const lastConnectionRef = useRef<EnvironmentConnection | null>(null);

  useEffect(() => {
    const isReconnect =
      lastConnectionRef.current !== null && lastConnectionRef.current !== connection;
    lastConnectionRef.current = connection;
    const release = query.watch(inputRef.current);
    // staleTime alone would keep answering with what the dead client returned,
    // so a reconnect forces one refetch — UNCONDITIONALLY. An in-flight fetch is
    // not a reason to skip it: that fetch may have been issued by the replaced
    // client, and only the refresh's fetchToken bump fences its late result out.
    if (isReconnect && connection !== null) {
      query.refresh(cacheKey);
    }
    return release;
  }, [query, cacheKey, connection]);

  const state = useAtomValue(query.getAtom(cacheKey));

  const refetch = useCallback(async () => {
    const next = await query.refreshAsync(cacheKey);
    return { data: next.data };
  }, [query, cacheKey]);

  return {
    data: state.data,
    isLoading: state.isLoading,
    isFetching: state.isFetching,
    error: state.error,
    refetch,
  };
}

export function useProjectListEntries(
  input: ProjectListEntriesInput,
): ProjectFilesQueryResult<ProjectListEntriesResult> {
  return useProjectFilesQuery(projectListEntriesQuery, input, input.environmentId);
}

export function useProjectReadFile(
  input: ProjectReadFileInput,
): ProjectFilesQueryResult<ProjectReadFileResult> {
  return useProjectFilesQuery(projectReadFileQuery, input, input.environmentId);
}

/**
 * Server-side entry search. The debounce lives here so every caller pays it: the
 * node ranks the results, and a request per keystroke would both burn the socket
 * and race answers back out of order.
 */
export function useProjectSearchEntries(
  input: ProjectSearchEntriesInput,
): ProjectSearchEntriesQueryResult {
  const normalizedQuery = normalizeWorkspaceFileSearchQuery(input.query);
  const [debouncedQuery, setDebouncedQuery] = useState(normalizedQuery);

  useEffect(() => {
    if (normalizedQuery === debouncedQuery) return;
    // Clearing the box is not a keystroke to wait out: drop back to the tree at
    // once rather than showing results for a query the user already erased.
    if (normalizedQuery.length === 0) {
      setDebouncedQuery("");
      return;
    }
    const timer = setTimeout(
      () => setDebouncedQuery(normalizedQuery),
      WORKSPACE_FILE_SEARCH_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [normalizedQuery, debouncedQuery]);

  const result = useProjectFilesQuery(
    projectSearchEntriesQuery,
    { ...input, query: debouncedQuery },
    input.environmentId,
  );

  return { ...result, isDebouncing: normalizedQuery !== debouncedQuery };
}
