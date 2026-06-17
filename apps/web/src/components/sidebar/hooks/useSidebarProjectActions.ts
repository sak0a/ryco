import { useCallback } from "react";
import { scopedProjectKey, scopeProjectRef } from "@ryco/client-runtime";
import { newCommandId } from "../../../lib/utils";
import { readEnvironmentApi } from "../../../environmentApi";
import { readLocalApi } from "../../../localApi";
import { useComposerDraftStore } from "../../../composerDraftStore";
import { selectSidebarThreadsForProjectRefs, useStore } from "../../../store";
import type { SidebarProjectGroupMember } from "../../../sidebarProjectGrouping";
import { stackedThreadToast, toastManager } from "../../ui/toast";
import { resolveProjectRemoteLink } from "../sidebarProjectRemoteLink";

export function useSidebarProjectActions(params: {
  memberThreadCountByPhysicalKey: ReadonlyMap<string, number>;
  jiraProjectOpenUrlByProjectKey: ReadonlyMap<string, string>;
}) {
  const { memberThreadCountByPhysicalKey, jiraProjectOpenUrlByProjectKey } = params;

  const openProjectRemoteLink = useCallback((member: SidebarProjectGroupMember) => {
    const remoteLink = resolveProjectRemoteLink(
      member.repositoryIdentity,
      member.preferredRemoteName,
    );
    if (!remoteLink) {
      toastManager.add({
        type: "warning",
        title: "No remote link available",
      });
      return;
    }

    const api = readLocalApi();
    if (!api) {
      toastManager.add({
        type: "error",
        title: "Link opening is unavailable.",
      });
      return;
    }

    void api.shell.openExternal(remoteLink.url).catch((error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Unable to open remote repository",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    });
  }, []);

  const openProjectJiraLink = useCallback(
    (member: SidebarProjectGroupMember) => {
      const url =
        jiraProjectOpenUrlByProjectKey.get(
          scopedProjectKey(scopeProjectRef(member.environmentId, member.id)),
        ) ?? null;
      if (!url) {
        toastManager.add({
          type: "warning",
          title: "No Jira project link available",
        });
        return;
      }

      const api = readLocalApi();
      if (!api) {
        toastManager.add({
          type: "error",
          title: "Link opening is unavailable.",
        });
        return;
      }

      void api.shell.openExternal(url).catch((error) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Unable to open Jira project",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      });
    },
    [jiraProjectOpenUrlByProjectKey],
  );

  const removeProject = useCallback(
    async (member: SidebarProjectGroupMember, options: { force?: boolean } = {}): Promise<void> => {
      const memberProjectRef = scopeProjectRef(member.environmentId, member.id);
      const draftStore = useComposerDraftStore.getState();
      const projectDraftThread = draftStore.getDraftThreadByProjectRef(memberProjectRef);
      if (projectDraftThread) {
        draftStore.clearDraftThread(projectDraftThread.draftId);
      }
      draftStore.clearProjectDraftThreadId(memberProjectRef);

      const projectApi = readEnvironmentApi(member.environmentId);
      if (!projectApi) {
        throw new Error("Project API unavailable.");
      }

      await projectApi.orchestration.dispatchCommand({
        type: "project.delete",
        commandId: newCommandId(),
        projectId: member.id,
        ...(options.force === true ? { force: true } : {}),
      });
    },
    [],
  );

  const handleRemoveProject = useCallback(
    async (member: SidebarProjectGroupMember) => {
      const api = readLocalApi();
      if (!api) {
        return;
      }

      const memberProjectRef = scopeProjectRef(member.environmentId, member.id);
      const memberThreadCount = memberThreadCountByPhysicalKey.get(member.physicalProjectKey) ?? 0;
      if (memberThreadCount > 0) {
        const warningToastId = toastManager.add(
          stackedThreadToast({
            type: "warning",
            title: "Project is not empty",
            description: "Delete all threads in this project before removing it.",
            actionVariant: "destructive",
            actionProps: {
              children: "Delete anyway",
              onClick: () => {
                void (async () => {
                  toastManager.close(warningToastId);
                  await new Promise<void>((resolve) => {
                    window.setTimeout(resolve, 180);
                  });

                  const latestProjectThreads = selectSidebarThreadsForProjectRefs(
                    useStore.getState(),
                    [memberProjectRef],
                  );
                  const confirmed = await api.dialogs.confirm(
                    latestProjectThreads.length > 0
                      ? [
                          `Remove project "${member.name}" and delete its ${latestProjectThreads.length} thread${
                            latestProjectThreads.length === 1 ? "" : "s"
                          }?`,
                          `Path: ${member.cwd}`,
                          ...(member.environmentLabel
                            ? [`Environment: ${member.environmentLabel}`]
                            : []),
                          "This permanently clears conversation history for those threads.",
                          "This removes only this project entry.",
                          "This action cannot be undone.",
                        ].join("\n")
                      : [
                          `Remove project "${member.name}"?`,
                          `Path: ${member.cwd}`,
                          ...(member.environmentLabel
                            ? [`Environment: ${member.environmentLabel}`]
                            : []),
                          "This removes only this project entry.",
                        ].join("\n"),
                  );
                  if (!confirmed) {
                    return;
                  }

                  await removeProject(member, { force: true });
                })().catch((error) => {
                  const message =
                    error instanceof Error ? error.message : "Unknown error removing project.";
                  console.error("Failed to remove project", {
                    projectId: member.id,
                    environmentId: member.environmentId,
                    error,
                  });
                  toastManager.add(
                    stackedThreadToast({
                      type: "error",
                      title: `Failed to remove "${member.name}"`,
                      description: message,
                    }),
                  );
                });
              },
            },
          }),
        );
        return;
      }

      const message = [
        `Remove project "${member.name}"?`,
        `Path: ${member.cwd}`,
        ...(member.environmentLabel ? [`Environment: ${member.environmentLabel}`] : []),
        "This removes only this project entry.",
      ].join("\n");
      const confirmed = await api.dialogs.confirm(message);
      if (!confirmed) {
        return;
      }

      try {
        await removeProject(member);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error removing project.";
        console.error("Failed to remove project", {
          projectId: member.id,
          environmentId: member.environmentId,
          error,
        });
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: `Failed to remove "${member.name}"`,
            description: message,
          }),
        );
      }
    },
    [memberThreadCountByPhysicalKey, removeProject],
  );

  return {
    openProjectRemoteLink,
    openProjectJiraLink,
    removeProject,
    handleRemoveProject,
  };
}
