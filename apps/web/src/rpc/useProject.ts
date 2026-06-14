import { useAtomValue } from "@effect/atom-react";
import { useEffect, useRef } from "react";

import {
  EMPTY_FILESYSTEM_BROWSE_STATE,
  EMPTY_PROJECT_SEARCH_ENTRIES_STATE,
  getFilesystemBrowseStateAtom,
  getProjectSearchEntriesStateAtom,
  type FilesystemBrowseInput,
  type FilesystemBrowseState,
  type ProjectSearchEntriesInput,
  type ProjectSearchEntriesState,
  prefetchFilesystemBrowse,
  releaseProjectSearchEntriesScope,
  requestProjectSearchEntries,
  resolveFilesystemBrowseKey,
  resolveProjectSearchEntriesScopeKey,
  retainProjectSearchEntriesScope,
  watchFilesystemBrowse,
} from "./projectAtoms";

/**
 * Atom-backed replacement for the former `useQuery(projectSearchEntriesQueryOptions(...))`.
 *
 * Preserves the prior observable behavior: results for a given
 * environment/cwd scope are retained while a new query loads, requests are
 * gated until an environment, cwd, and non-empty query are present, and the
 * scope refetches when invalidated through `invalidateProjectSearchEntries`.
 */
export function useProjectSearchEntries(
  input: ProjectSearchEntriesInput,
): ProjectSearchEntriesState {
  const scopeKey = resolveProjectSearchEntriesScopeKey(input);
  const { environmentId, cwd, query, enabled, limit, staleTime } = input;

  useEffect(() => {
    if (environmentId === null || cwd === null) {
      return;
    }
    const scope = {
      environmentId,
      cwd,
      ...(limit !== undefined ? { limit } : {}),
    };
    retainProjectSearchEntriesScope(scope);
    return () => releaseProjectSearchEntriesScope(scope);
  }, [environmentId, cwd, limit]);

  useEffect(() => {
    requestProjectSearchEntries({
      environmentId,
      cwd,
      query,
      ...(enabled !== undefined ? { enabled } : {}),
      ...(limit !== undefined ? { limit } : {}),
      ...(staleTime !== undefined ? { staleTime } : {}),
    });
  }, [environmentId, cwd, query, enabled, limit, staleTime]);

  const state = useAtomValue(getProjectSearchEntriesStateAtom(scopeKey));
  return scopeKey === null ? EMPTY_PROJECT_SEARCH_ENTRIES_STATE : state;
}

/**
 * Atom-backed replacement for the former `useQuery(filesystemBrowse)` reads in
 * the command palette. Each environment/cwd/path tuple is cached independently
 * with stale-time gating; `prefetchFilesystemBrowse` warms adjacent paths.
 */
export function useFilesystemBrowse(input: FilesystemBrowseInput): FilesystemBrowseState {
  const browseKey = resolveFilesystemBrowseKey(input);
  const inputRef = useRef(input);
  inputRef.current = input;

  useEffect(() => watchFilesystemBrowse(inputRef.current), [browseKey]);

  const state = useAtomValue(getFilesystemBrowseStateAtom(browseKey));
  return browseKey === null ? EMPTY_FILESYSTEM_BROWSE_STATE : state;
}

export { prefetchFilesystemBrowse };
