import type { EnvironmentId, ProjectId } from "@ryco/contracts";

/**
 * React Query keys for Atlassian/Jira work item data that is still served
 * through React Query. The work item read queries (projects, list, search,
 * detail) and their mutations now live in `~/rpc/workItemsAtoms`; only the
 * project-link lookup (`client.atlassian.getProjectLink`) remains here.
 */
export const workItemsQueryKeys = {
  projectLink: (environmentId: EnvironmentId | null, projectId: ProjectId | null) =>
    ["workItems", "projectLink", environmentId ?? null, projectId ?? null] as const,
};
