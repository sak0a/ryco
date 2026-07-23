import { useMemo } from "react";
import { scopedProjectKey, scopeProjectRef } from "@ryco/client-runtime/scoped";
import { resolveJiraProjectOpenUrl } from "../../../lib/workItemLocalLinks";
import { shouldQuerySidebarSourceControlCounts } from "../../Sidebar.logic";
import type { SidebarProjectSnapshot } from "../../../sidebarProjectGrouping";
import { useAtlassianConnectionsBatch, useAtlassianProjectLinkBatch } from "~/rpc/useAtlassian";

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
  const projectLinkInputs = useMemo(
    () =>
      project.memberProjects.map((member) => ({
        environmentId: member.environmentId,
        projectId: member.id,
        enabled: shouldQueryProjectIntegrations,
      })),
    [project.memberProjects, shouldQueryProjectIntegrations],
  );
  const atlassianProjectLinkQueries = useAtlassianProjectLinkBatch(projectLinkInputs);
  const atlassianConnectionEnvironmentIds = useMemo(
    () => Array.from(new Set(project.memberProjects.map((member) => member.environmentId))),
    [project.memberProjects],
  );
  const atlassianConnectionQueries = useAtlassianConnectionsBatch(
    atlassianConnectionEnvironmentIds,
    shouldQueryProjectIntegrations,
  );
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
