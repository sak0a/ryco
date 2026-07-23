import { useCallback } from "react";
import { scopeThreadRef } from "@ryco/client-runtime/scoped";
import { type ScopedThreadRef, type ThreadEnvMode, WorktreeId } from "@ryco/contracts";
import { newCommandId } from "../../../lib/utils";
import { readEnvironmentApi } from "../../../environmentApi";
import { readLocalApi } from "../../../localApi";
import { useStore } from "../../../store";
import { openInPreferredEditor } from "../../../editorPreferences";
import type { useThreadActions } from "../../../hooks/useThreadActions";
import { stackedThreadToast, toastManager } from "../../ui/toast";
import type {
  SidebarProjectGroupMember,
  SidebarProjectSnapshot,
} from "../../../sidebarProjectGrouping";
import { isSyntheticWorktreeId, type SidebarTreeWorktree } from "./useSidebarTree";

export function useSidebarWorktreeActions(params: {
  project: SidebarProjectSnapshot;
  deleteThread: ReturnType<typeof useThreadActions>["deleteThread"];
  navigateToThread: (threadRef: ScopedThreadRef) => void;
  createThreadForProjectMember: (
    member: SidebarProjectGroupMember,
    seedOverride?: {
      branch?: string | null;
      envMode: ThreadEnvMode;
      worktreePath?: string | null;
    },
  ) => void;
  copyPathToClipboard: (value: string, ctx: { path: string }) => void;
}) {
  const {
    project,
    deleteThread,
    navigateToThread,
    createThreadForProjectMember,
    copyPathToClipboard,
  } = params;

  const createThreadInWorktree = useCallback(
    (worktreeNode: SidebarTreeWorktree) => {
      const targetMember = project.memberProjects[0];
      if (!targetMember) {
        return;
      }
      createThreadForProjectMember(targetMember, {
        branch: worktreeNode.worktree.branch,
        envMode: worktreeNode.worktree.worktreePath ? "worktree" : "local",
        worktreePath: worktreeNode.worktree.worktreePath,
      });
    },
    [createThreadForProjectMember, project.memberProjects],
  );

  const openWorktree = useCallback(
    (worktreeNode: SidebarTreeWorktree) => {
      const activeThreads = worktreeNode.sessions.toSorted(
        (left, right) =>
          Date.parse(right.updatedAt ?? right.createdAt) -
          Date.parse(left.updatedAt ?? left.createdAt),
      );
      const targetThread = activeThreads[0];
      if (targetThread) {
        navigateToThread(scopeThreadRef(targetThread.environmentId, targetThread.id));
        return;
      }
      createThreadInWorktree(worktreeNode);
    },
    [createThreadInWorktree, navigateToThread],
  );

  const resolveWorktreeFilesystemPath = useCallback(
    (worktreeNode: SidebarTreeWorktree) => worktreeNode.worktree.worktreePath ?? project.cwd,
    [project.cwd],
  );

  const copyWorktreePath = useCallback(
    (worktreeNode: SidebarTreeWorktree) => {
      const path = resolveWorktreeFilesystemPath(worktreeNode);
      if (!path) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Path unavailable",
            description: "This worktree does not have a workspace path to copy.",
          }),
        );
        return;
      }
      copyPathToClipboard(path, { path });
    },
    [copyPathToClipboard, resolveWorktreeFilesystemPath],
  );

  const openWorktreeInEditor = useCallback(
    (worktreeNode: SidebarTreeWorktree) => {
      const path = resolveWorktreeFilesystemPath(worktreeNode);
      const api = readLocalApi();
      if (!api || !path) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Unable to open worktree",
            description: "No local editor bridge is available.",
          }),
        );
        return;
      }
      void openInPreferredEditor(api, path).catch((error: unknown) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Unable to open worktree",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      });
    },
    [resolveWorktreeFilesystemPath],
  );

  const archiveWorktree = useCallback(
    (worktreeNode: SidebarTreeWorktree) => {
      const api = readEnvironmentApi(project.environmentId);
      const archive = api?.git.archiveWorktree;
      if (!archive) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Archive unavailable",
            description: "This environment does not support worktree archiving.",
          }),
        );
        return;
      }
      void archive({
        worktreeId: WorktreeId.make(worktreeNode.worktree.worktreeId),
        deleteBranch: false,
      }).catch((error: unknown) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to archive worktree",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      });
    },
    [project.environmentId],
  );

  const deleteWorktree = useCallback(
    (worktreeNode: SidebarTreeWorktree) => {
      void (async () => {
        const localApi = readLocalApi();
        if (localApi) {
          const confirmed = await localApi.dialogs.confirm(
            [
              `Delete worktree "${worktreeNode.worktree.branch}"?`,
              "This permanently removes the worktree and its sessions.",
            ].join("\n"),
          );
          if (!confirmed) {
            return;
          }
        }
        const api = readEnvironmentApi(project.environmentId);
        if (!api) {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Delete unavailable",
              description: "This environment is not connected.",
            }),
          );
          return;
        }
        const worktreeIdRaw = worktreeNode.worktree.worktreeId;

        const threadIds = [
          ...worktreeNode.sessions.map((thread) => thread.id),
          ...worktreeNode.archivedSessions.map((thread) => thread.id),
        ];
        for (const threadId of threadIds) {
          const threadRef = scopeThreadRef(project.environmentId, threadId);
          await deleteThread(threadRef, { optimistic: true });
        }

        if (isSyntheticWorktreeId(worktreeIdRaw)) {
          return;
        }

        const deleteRpc = api.git.deleteWorktree;
        if (!deleteRpc) {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Delete unavailable",
              description: "This environment does not support worktree deletion.",
            }),
          );
          return;
        }
        try {
          await deleteRpc({
            worktreeId: WorktreeId.make(worktreeIdRaw),
            deleteBranch: false,
          });
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : "An error occurred.";
          const fallbackToastId = toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Failed to delete worktree",
              description: `${message}\n\nIf the worktree no longer exists on disk and isn't tracked by git, force-remove it from the list.`,
              actionVariant: "destructive",
              actionProps: {
                children: "Force delete from list",
                onClick: () => {
                  toastManager.close(fallbackToastId);
                  void (async () => {
                    await deleteRpc({
                      worktreeId: WorktreeId.make(worktreeIdRaw),
                      deleteBranch: false,
                      force: true,
                    });
                  })().catch((forceError: unknown) => {
                    toastManager.add(
                      stackedThreadToast({
                        type: "error",
                        title: "Failed to force delete worktree",
                        description:
                          forceError instanceof Error ? forceError.message : "An error occurred.",
                      }),
                    );
                  });
                },
              },
            }),
          );
        }
      })().catch((error: unknown) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to delete worktree",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      });
    },
    [deleteThread, project.environmentId],
  );

  const restoreWorktree = useCallback(
    (worktreeNode: SidebarTreeWorktree) => {
      const api = readEnvironmentApi(project.environmentId);
      const restore = api?.git.restoreWorktree;
      if (!restore) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Restore unavailable",
            description: "This environment does not support worktree restore.",
          }),
        );
        return;
      }
      void restore({
        worktreeId: WorktreeId.make(worktreeNode.worktree.worktreeId),
      }).catch((error: unknown) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to restore worktree",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      });
    },
    [project.environmentId],
  );

  const renameWorktree = useCallback(
    async (worktreeNode: SidebarTreeWorktree, title: string) => {
      const trimmed = title.trim();
      if (trimmed.length === 0) {
        toastManager.add({
          type: "warning",
          title: "Worktree title cannot be empty",
        });
        return;
      }

      const api = readEnvironmentApi(project.environmentId);
      if (!api) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to rename worktree",
            description: "Project API unavailable.",
          }),
        );
        return;
      }

      try {
        const changedAt = new Date().toISOString();
        const worktreeId = WorktreeId.make(worktreeNode.worktree.worktreeId);
        await api.orchestration.dispatchCommand({
          type: "worktree.meta.update",
          commandId: newCommandId(),
          worktreeId,
          title: trimmed,
          changedAt,
        });
        useStore
          .getState()
          .setSidebarWorktreeTitle(project.environmentId, worktreeId, trimmed, changedAt);
      } catch (error) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to rename worktree",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
    },
    [project.environmentId],
  );

  return {
    createThreadInWorktree,
    openWorktree,
    resolveWorktreeFilesystemPath,
    copyWorktreePath,
    openWorktreeInEditor,
    archiveWorktree,
    deleteWorktree,
    restoreWorktree,
    renameWorktree,
  };
}
