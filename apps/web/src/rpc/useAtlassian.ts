import { useAtomValue } from "@effect/atom-react";
import type { AtlassianConnectionSummary, AtlassianProjectLink } from "@ryco/contracts";
import { useCallback, useEffect } from "react";

import {
  type AtlassianConnectionsInput,
  type AtlassianProjectLinkInput,
  type AtlassianQueryState,
  atlassianConnectionsQuery,
  atlassianProjectLinkQuery,
} from "./atlassianAtoms";

export {
  invalidateAtlassian,
  type AtlassianConnectionsInput,
  type AtlassianProjectLinkInput,
  type AtlassianQueryState,
} from "./atlassianAtoms";

export interface AtlassianQueryResult<T> extends AtlassianQueryState<T> {
  readonly refetch: () => void;
}

/**
 * Atom-backed replacement for `useQuery({ queryKey: ["atlassian", "connections", ...] })`.
 */
export function useAtlassianConnections(
  input: AtlassianConnectionsInput,
): AtlassianQueryResult<ReadonlyArray<AtlassianConnectionSummary>> {
  const { environmentId, enabled } = input;
  const cacheKey = atlassianConnectionsQuery.keyOf(input);

  useEffect(
    () =>
      atlassianConnectionsQuery.watch({
        environmentId,
        ...(enabled !== undefined ? { enabled } : {}),
      }),
    [environmentId, enabled],
  );

  const state = useAtomValue(atlassianConnectionsQuery.getAtom(cacheKey));
  const refetch = useCallback(() => atlassianConnectionsQuery.refresh(cacheKey), [cacheKey]);
  return { ...state, refetch };
}

/**
 * Atom-backed replacement for `useQuery({ queryKey: ["atlassian", "project-link", ...] })`.
 */
export function useAtlassianProjectLink(
  input: AtlassianProjectLinkInput,
): AtlassianQueryResult<AtlassianProjectLink | null> {
  const { environmentId, projectId, enabled } = input;
  const cacheKey = atlassianProjectLinkQuery.keyOf(input);

  useEffect(
    () =>
      atlassianProjectLinkQuery.watch({
        environmentId,
        projectId,
        ...(enabled !== undefined ? { enabled } : {}),
      }),
    [environmentId, projectId, enabled],
  );

  const state = useAtomValue(atlassianProjectLinkQuery.getAtom(cacheKey));
  const refetch = useCallback(() => atlassianProjectLinkQuery.refresh(cacheKey), [cacheKey]);
  return { ...state, refetch };
}
