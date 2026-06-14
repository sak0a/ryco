import { useAtomValue } from "@effect/atom-react";
import type { ProjectListEntriesResult, ProjectReadFileResult } from "@ryco/contracts";
import { useCallback, useEffect, useMemo } from "react";

import {
  type ProjectListEntriesInput,
  type ProjectPreviewQueryState,
  projectListEntriesQuery,
  projectReadFileQuery,
  type ProjectReadFileInput,
} from "./projectPreviewAtoms";

export interface ProjectPreviewQueryResult<T> extends ProjectPreviewQueryState<T> {
  readonly refetch: () => Promise<{ readonly data: T | null }>;
}

/**
 * Atom-backed replacement for PreviewPanel's `useQuery(listEntries)`.
 *
 * Preserves keep-previous-data while refetching, imperative `refetch`, and
 * sorted entry ordering from the former `select` transform.
 */
export function useProjectListEntries(
  input: ProjectListEntriesInput,
): ProjectPreviewQueryResult<ProjectListEntriesResult> {
  const { environmentId, cwd, enabled } = input;
  const cacheKey = projectListEntriesQuery.keyOf(input);

  useEffect(
    () =>
      projectListEntriesQuery.watch({
        environmentId,
        cwd,
        ...(enabled !== undefined ? { enabled } : {}),
      }),
    [environmentId, cwd, enabled],
  );

  const state = useAtomValue(projectListEntriesQuery.getAtom(cacheKey));
  const sortedData = useMemo(() => {
    if (!state.data) {
      return null;
    }
    return {
      ...state.data,
      entries: state.data.entries.toSorted((left, right) =>
        left.path.localeCompare(right.path, undefined, { numeric: true, sensitivity: "base" }),
      ),
    };
  }, [state.data]);

  const refetch = useCallback(async () => {
    const next = await projectListEntriesQuery.refreshAsync(cacheKey);
    const data =
      next.data === null
        ? null
        : {
            ...next.data,
            entries: next.data.entries.toSorted((left, right) =>
              left.path.localeCompare(right.path, undefined, {
                numeric: true,
                sensitivity: "base",
              }),
            ),
          };
    return { data };
  }, [cacheKey]);

  return {
    data: sortedData,
    isLoading: state.isLoading,
    isFetching: state.isFetching,
    error: state.error,
    refetch,
  };
}

/**
 * Atom-backed replacement for PreviewPanel's `useQuery(readFile)`.
 *
 * Preserves keep-previous-data while refetching and imperative `refetch`.
 */
export function useProjectReadFile(
  input: ProjectReadFileInput,
): ProjectPreviewQueryResult<ProjectReadFileResult> {
  const { environmentId, cwd, relativePath, enabled } = input;
  const cacheKey = projectReadFileQuery.keyOf(input);

  useEffect(
    () =>
      projectReadFileQuery.watch({
        environmentId,
        cwd,
        relativePath,
        ...(enabled !== undefined ? { enabled } : {}),
      }),
    [environmentId, cwd, relativePath, enabled],
  );

  const state = useAtomValue(projectReadFileQuery.getAtom(cacheKey));

  const refetch = useCallback(async () => {
    const next = await projectReadFileQuery.refreshAsync(cacheKey);
    return { data: next.data };
  }, [cacheKey]);

  return {
    data: state.data,
    isLoading: state.isLoading,
    isFetching: state.isFetching,
    error: state.error,
    refetch,
  };
}
