import { useAtomValue } from "@effect/atom-react";
import type {
  WorkItemDetail as WorkItemDetailModel,
  WorkItemProject,
  WorkItemSummary,
} from "@ryco/contracts";
import { useCallback, useEffect } from "react";

import {
  type WorkItemDetailInput,
  type WorkItemListInput,
  type WorkItemProjectsInput,
  type WorkItemQueryState,
  type WorkItemSearchInput,
  workItemDetailQuery,
  workItemListQuery,
  workItemProjectsQuery,
  workItemSearchQuery,
} from "./workItemsAtoms";

export {
  invalidateWorkItems,
  setWorkItemDetailCache,
  type WorkItemDetailInput,
  type WorkItemListInput,
  type WorkItemProjectsInput,
  type WorkItemQueryState,
  type WorkItemSearchInput,
} from "./workItemsAtoms";

export interface WorkItemQueryResult<T> extends WorkItemQueryState<T> {
  readonly refetch: () => void;
}

/**
 * Atom-backed replacement for `useQuery(workItemProjectsQueryOptions(...))`.
 */
export function useWorkItemProjects(
  input: WorkItemProjectsInput,
): WorkItemQueryResult<ReadonlyArray<WorkItemProject>> {
  const { environmentId, connectionId, siteUrl, enabled } = input;
  const cacheKey = workItemProjectsQuery.keyOf(input);

  useEffect(
    () =>
      workItemProjectsQuery.watch({
        environmentId,
        connectionId,
        ...(siteUrl !== undefined ? { siteUrl } : {}),
        ...(enabled !== undefined ? { enabled } : {}),
      }),
    [environmentId, connectionId, siteUrl, enabled],
  );

  const state = useAtomValue(workItemProjectsQuery.getAtom(cacheKey));
  const refetch = useCallback(() => workItemProjectsQuery.refresh(cacheKey), [cacheKey]);
  return { ...state, refetch };
}

/**
 * Atom-backed replacement for `useQuery(workItemListQueryOptions(...))`.
 */
export function useWorkItemList(
  input: WorkItemListInput,
): WorkItemQueryResult<ReadonlyArray<WorkItemSummary>> {
  const { environmentId, projectId, state: stateFilter, limit, enabled } = input;
  const cacheKey = workItemListQuery.keyOf(input);

  useEffect(
    () =>
      workItemListQuery.watch({
        environmentId,
        projectId,
        state: stateFilter,
        ...(limit !== undefined ? { limit } : {}),
        ...(enabled !== undefined ? { enabled } : {}),
      }),
    [environmentId, projectId, stateFilter, limit, enabled],
  );

  const state = useAtomValue(workItemListQuery.getAtom(cacheKey));
  const refetch = useCallback(() => workItemListQuery.refresh(cacheKey), [cacheKey]);
  return { ...state, refetch };
}

/**
 * Atom-backed replacement for `useQuery(workItemSearchQueryOptions(...))`.
 */
export function useWorkItemSearch(
  input: WorkItemSearchInput,
): WorkItemQueryResult<ReadonlyArray<WorkItemSummary>> {
  const { environmentId, projectId, query, limit, enabled } = input;
  const cacheKey = workItemSearchQuery.keyOf(input);

  useEffect(
    () =>
      workItemSearchQuery.watch({
        environmentId,
        projectId,
        query,
        ...(limit !== undefined ? { limit } : {}),
        ...(enabled !== undefined ? { enabled } : {}),
      }),
    [environmentId, projectId, query, limit, enabled],
  );

  const state = useAtomValue(workItemSearchQuery.getAtom(cacheKey));
  const refetch = useCallback(() => workItemSearchQuery.refresh(cacheKey), [cacheKey]);
  return { ...state, refetch };
}

/**
 * Atom-backed replacement for `useQuery(workItemDetailQueryOptions(...))`.
 */
export function useWorkItemDetail(
  input: WorkItemDetailInput,
): WorkItemQueryResult<WorkItemDetailModel> {
  const { environmentId, projectId, key: workItemKey, fullContent, enabled } = input;
  const cacheKey = workItemDetailQuery.keyOf(input);

  useEffect(
    () =>
      workItemDetailQuery.watch({
        environmentId,
        projectId,
        key: workItemKey,
        ...(fullContent !== undefined ? { fullContent } : {}),
        ...(enabled !== undefined ? { enabled } : {}),
      }),
    [environmentId, projectId, workItemKey, fullContent, enabled],
  );

  const state = useAtomValue(workItemDetailQuery.getAtom(cacheKey));
  const refetch = useCallback(() => workItemDetailQuery.refresh(cacheKey), [cacheKey]);
  return { ...state, refetch };
}
