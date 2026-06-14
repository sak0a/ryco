import { useMemo } from "react";
import { useQueries } from "~/rpc/queryClient";
import { scopedProjectKey, scopeProjectRef } from "@ryco/client-runtime";
import { workItemsQueryKeys } from "~/lib/workItemsRpc";
import { resolveJiraProjectOpenUrl } from "../../../lib/workItemLocalLinks";
import { readEnvironmentConnection } from "../../../environments/runtime";
import { shouldQuerySidebarSourceControlCounts } from "../../Sidebar.logic";
import type { SidebarProjectSnapshot } from "../../../sidebarProjectGrouping";

export function useSidebarProjectJiraLinks(params: {
  project: SidebarProjectSnapshot;
  explorerOpen: boolean;
  projectVisible: boolean;
}): ReadonlyMap<string, string> {
  const { project, explorerOpen, projectVisible } = params;
  const shouldQueryProjectIntegrations = shouldQuerySidebarSourceControlCounts({
    explorerOpen,
    projectVisible,
  });
  const atlassianProjectLinkQueries = useQueries({
    queries: project.memberProjects.map((member) => ({
      queryKey: workItemsQueryKeys.projectLink(member.environmentId, member.id),
      queryFn: async () => {
        const environmentConnection = readEnvironmentConnection(member.environmentId);
        if (!environmentConnection) return null;
        return environmentConnection.client.atlassian.getProjectLink({ projectId: member.id });
      },
      enabled: shouldQueryProjectIntegrations,
      staleTime: 60_000,
    })),
  });
  const atlassianConnectionEnvironmentIds = useMemo(
    () => Array.from(new Set(project.memberProjects.map((member) => member.environmentId))),
    [project.memberProjects],
  );
  const atlassianConnectionQueries = useQueries({
    queries: atlassianConnectionEnvironmentIds.map((environmentId) => ({
      queryKey: ["atlassian", "connections", environmentId] as const,
      queryFn: async () => {
        const environmentConnection = readEnvironmentConnection(environmentId);
        if (!environmentConnection) return [];
        return environmentConnection.client.atlassian.listConnections();
      },
      enabled: shouldQueryProjectIntegrations,
      staleTime: 60_000,
    })),
  });
  const atlassianConnectionsByEnvironmentId = useMemo(
    () =>
      new Map(
        atlassianConnectionEnvironmentIds.map(
          (environmentId, index) =>
            [environmentId, atlassianConnectionQueries[index]?.data ?? []] as const,
        ),
      ),
    [atlassianConnectionEnvironmentIds, atlassianConnectionQueries],
  );
  return useMemo(() => {
    const urls = new Map<string, string>();
    project.memberProjects.forEach((member, index) => {
      const url = resolveJiraProjectOpenUrl({
        link: atlassianProjectLinkQueries[index]?.data ?? null,
        connections: atlassianConnectionsByEnvironmentId.get(member.environmentId) ?? [],
      });
      if (url) {
        urls.set(scopedProjectKey(scopeProjectRef(member.environmentId, member.id)), url);
      }
    });
    return urls;
  }, [atlassianConnectionsByEnvironmentId, atlassianProjectLinkQueries, project.memberProjects]);
}
