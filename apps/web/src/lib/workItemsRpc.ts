import type {
  AtlassianConnectionId,
  EnvironmentId,
  ProjectId,
  WorkItemStateFilter,
} from "@ryco/contracts";
import { queryOptions } from "@tanstack/react-query";
import { requireEnvironmentConnection } from "~/environments/runtime";

export const workItemsQueryKeys = {
  all: ["workItems"] as const,
  projectLink: (environmentId: EnvironmentId | null, projectId: ProjectId | null) =>
    ["workItems", "projectLink", environmentId ?? null, projectId ?? null] as const,
  projects: (
    environmentId: EnvironmentId | null,
    connectionId: AtlassianConnectionId | null,
    siteUrl: string,
  ) =>
    ["workItems", environmentId ?? null, "projects", connectionId ?? null, siteUrl.trim()] as const,
  list: (
    environmentId: EnvironmentId | null,
    projectId: ProjectId | null,
    state: WorkItemStateFilter,
    limit?: number,
  ) =>
    ["workItems", environmentId ?? null, projectId ?? null, "list", state, limit ?? null] as const,
  search: (
    environmentId: EnvironmentId | null,
    projectId: ProjectId | null,
    query: string,
    limit?: number,
  ) =>
    [
      "workItems",
      environmentId ?? null,
      projectId ?? null,
      "search",
      query,
      limit ?? null,
    ] as const,
  detail: (
    environmentId: EnvironmentId | null,
    projectId: ProjectId | null,
    key: string,
    fullContent: boolean = false,
  ) =>
    [
      "workItems",
      environmentId ?? null,
      projectId ?? null,
      "detail",
      key,
      fullContent ? "full" : "truncated",
    ] as const,
};

export function workItemProjectsQueryOptions(input: {
  readonly environmentId: EnvironmentId | null;
  readonly connectionId: AtlassianConnectionId | null;
  readonly siteUrl?: string;
  readonly enabled?: boolean;
}) {
  const siteUrl = input.siteUrl?.trim() ?? "";
  return queryOptions({
    queryKey: workItemsQueryKeys.projects(input.environmentId, input.connectionId, siteUrl),
    queryFn: async () => {
      if (!input.environmentId || !input.connectionId) {
        throw new Error("Jira project discovery is unavailable.");
      }
      const client = requireEnvironmentConnection(input.environmentId).client;
      return client.workItems.listProjects({
        connectionId: input.connectionId,
        ...(siteUrl.length > 0 ? { siteUrl } : {}),
      });
    },
    enabled: (input.enabled ?? true) && input.environmentId !== null && input.connectionId !== null,
    staleTime: 5 * 60_000,
  });
}

export function workItemListQueryOptions(input: {
  readonly environmentId: EnvironmentId | null;
  readonly projectId: ProjectId | null;
  readonly state: WorkItemStateFilter;
  readonly limit?: number;
  readonly enabled?: boolean;
}) {
  return queryOptions({
    queryKey: workItemsQueryKeys.list(
      input.environmentId,
      input.projectId,
      input.state,
      input.limit,
    ),
    queryFn: async () => {
      if (!input.environmentId || !input.projectId) {
        throw new Error("Jira work items are unavailable.");
      }
      const client = requireEnvironmentConnection(input.environmentId).client;
      return client.workItems.list({
        projectId: input.projectId,
        state: input.state,
        ...(input.limit !== undefined ? { limit: input.limit } : {}),
      });
    },
    enabled: (input.enabled ?? true) && input.environmentId !== null && input.projectId !== null,
    staleTime: 60_000,
  });
}

export function workItemSearchQueryOptions(input: {
  readonly environmentId: EnvironmentId | null;
  readonly projectId: ProjectId | null;
  readonly query: string;
  readonly limit?: number;
  readonly enabled?: boolean;
}) {
  return queryOptions({
    queryKey: workItemsQueryKeys.search(
      input.environmentId,
      input.projectId,
      input.query,
      input.limit,
    ),
    queryFn: async () => {
      if (!input.environmentId || !input.projectId || input.query.trim().length === 0) {
        throw new Error("Jira work item search is unavailable.");
      }
      const client = requireEnvironmentConnection(input.environmentId).client;
      return client.workItems.search({
        projectId: input.projectId,
        query: input.query.trim(),
        ...(input.limit !== undefined ? { limit: input.limit } : {}),
      });
    },
    enabled:
      (input.enabled ?? true) &&
      input.environmentId !== null &&
      input.projectId !== null &&
      input.query.trim().length > 0,
    staleTime: 30_000,
  });
}

export function workItemDetailQueryOptions(input: {
  readonly environmentId: EnvironmentId | null;
  readonly projectId: ProjectId | null;
  readonly key: string;
  readonly fullContent?: boolean;
  readonly enabled?: boolean;
}) {
  return queryOptions({
    queryKey: workItemsQueryKeys.detail(
      input.environmentId,
      input.projectId,
      input.key,
      input.fullContent ?? false,
    ),
    queryFn: async () => {
      if (!input.environmentId || !input.projectId || input.key.trim().length === 0) {
        throw new Error("Jira work item detail is unavailable.");
      }
      const client = requireEnvironmentConnection(input.environmentId).client;
      return client.workItems.get({
        projectId: input.projectId,
        key: input.key,
        fullContent: input.fullContent ?? false,
      });
    },
    enabled:
      (input.enabled ?? true) &&
      input.environmentId !== null &&
      input.projectId !== null &&
      input.key.trim().length > 0,
    staleTime: 60_000,
  });
}
