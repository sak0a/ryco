import React, { useCallback, useRef, useState } from "react";
import {
  scopedProjectKey,
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@ryco/client-runtime";
import { type ScopedThreadRef, type ThreadEnvMode, type ThreadId } from "@ryco/contracts";
import { isMacPlatform, newCommandId } from "../../../lib/utils";
import { readEnvironmentApi } from "../../../environmentApi";
import { readLocalApi } from "../../../localApi";
import { useComposerDraftStore, type DraftId } from "../../../composerDraftStore";
import { selectThreadByRef, useStore } from "../../../store";
import { buildThreadRouteParams, resolveThreadRouteTarget } from "../../../threadRoutes";
import { useThreadSelectionStore } from "../../../threadSelectionStore";
import { useUiStateStore } from "../../../uiStateStore";
import type { useRouter } from "@tanstack/react-router";
import type { useNewThreadHandler } from "../../../hooks/useHandleNewThread";
import type { useThreadActions } from "../../../hooks/useThreadActions";
import {
  canArchiveSidebarThread,
  isTrailingDoubleClick,
  resolveSidebarNewThreadSeedContext,
  resolveSidebarNewThreadEnvMode,
  shouldConfirmSidebarThreadArchive,
  shouldConfirmSidebarThreadDelete,
  shouldConfirmSidebarThreadSelectionDelete,
} from "../../Sidebar.logic";
import { stackedThreadToast, toastManager } from "../../ui/toast";
import type { SidebarThreadSummary } from "../../../types";
import type { SidebarProjectGroupMember } from "../../../sidebarProjectGrouping";

export type ThreadMenuActionId =
  | "pin"
  | "unpin"
  | "rename"
  | "mark-unread"
  | "copy-path"
  | "copy-thread-id"
  | "archive"
  | "close";

export interface ThreadMenuActionItem {
  readonly id: ThreadMenuActionId;
  readonly label: string;
  readonly destructive?: boolean;
}

export function useSidebarThreadActions(params: {
  router: ReturnType<typeof useRouter>;
  isMobile: boolean;
  setOpenMobile: (open: boolean) => void;
  clearSelection: () => void;
  setSelectionAnchor: (threadKey: string) => void;
  toggleThreadSelection: (threadKey: string) => void;
  rangeSelectTo: (threadKey: string, orderedThreadKeys: readonly string[]) => void;
  removeFromSelection: (threadKeys: readonly string[]) => void;
  selectedThreadCount: number;
  appSettingsConfirmThreadDelete: boolean;
  appSettingsConfirmThreadArchive: boolean;
  defaultThreadEnvMode: ThreadEnvMode;
  deleteThread: ReturnType<typeof useThreadActions>["deleteThread"];
  archiveThread: ReturnType<typeof useThreadActions>["archiveThread"];
  handleNewThread: ReturnType<typeof useNewThreadHandler>["handleNewThread"];
  markThreadUnread: (threadId: string, latestTurnCompletedAt: string | null | undefined) => void;
  copyPathToClipboard: (value: string, ctx: { path: string }) => void;
  copyThreadIdToClipboard: (value: string, ctx: { threadId: ThreadId }) => void;
  sidebarThreadByKeyRef: React.RefObject<ReadonlyMap<string, SidebarThreadSummary>>;
  memberProjectByScopedKey: ReadonlyMap<string, SidebarProjectGroupMember>;
  projectCwd: string | null | undefined;
}) {
  const {
    router,
    isMobile,
    setOpenMobile,
    clearSelection,
    setSelectionAnchor,
    toggleThreadSelection,
    rangeSelectTo,
    removeFromSelection,
    selectedThreadCount,
    appSettingsConfirmThreadDelete,
    appSettingsConfirmThreadArchive,
    defaultThreadEnvMode,
    deleteThread,
    archiveThread,
    handleNewThread,
    markThreadUnread,
    copyPathToClipboard,
    copyThreadIdToClipboard,
    sidebarThreadByKeyRef,
    memberProjectByScopedKey,
    projectCwd,
  } = params;

  const [renamingThreadKey, setRenamingThreadKey] = useState<string | null>(null);
  const [renamingTitle, setRenamingTitle] = useState("");
  const renamingCommittedRef = useRef(false);
  const renamingInputRef = useRef<HTMLInputElement | null>(null);

  const navigateToThread = useCallback(
    (threadRef: ScopedThreadRef) => {
      if (useThreadSelectionStore.getState().selectedThreadKeys.size > 0) {
        clearSelection();
      }
      setSelectionAnchor(scopedThreadKey(threadRef));
      if (isMobile) {
        setOpenMobile(false);
      }
      void router.navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(threadRef),
      });
    },
    [clearSelection, isMobile, router, setOpenMobile, setSelectionAnchor],
  );

  const navigateToDraft = useCallback(
    (draftId: DraftId, threadRef: ScopedThreadRef) => {
      if (useThreadSelectionStore.getState().selectedThreadKeys.size > 0) {
        clearSelection();
      }
      setSelectionAnchor(scopedThreadKey(threadRef));
      if (isMobile) {
        setOpenMobile(false);
      }
      void router.navigate({
        to: "/draft/$draftId",
        params: { draftId },
      });
    },
    [clearSelection, isMobile, router, setOpenMobile, setSelectionAnchor],
  );

  const closeThread = useCallback(
    async (
      thread: SidebarThreadSummary & { draftId?: DraftId | undefined },
      opts: { deletedThreadKeys?: ReadonlySet<string> } = {},
    ) => {
      if (thread.draftId) {
        const draftStore = useComposerDraftStore.getState();
        draftStore.clearDraftThread(thread.draftId);
        const currentRouteParams =
          router.state.matches[router.state.matches.length - 1]?.params ?? {};
        const currentRouteTarget = resolveThreadRouteTarget(currentRouteParams);
        if (currentRouteTarget?.kind === "draft" && currentRouteTarget.draftId === thread.draftId) {
          await router.navigate({ to: "/", replace: true });
        }
        return;
      }
      const threadRef = scopeThreadRef(thread.environmentId, thread.id);
      const shouldConfirmClose = shouldConfirmSidebarThreadDelete({
        confirmThreadDelete: appSettingsConfirmThreadDelete,
        thread,
      });
      if (shouldConfirmClose) {
        const message = [
          `Close session "${thread.title}"?`,
          "This permanently clears conversation history for this thread.",
        ].join("\n");
        const localApi = readLocalApi();
        const confirmed = localApi
          ? await localApi.dialogs.confirm(message)
          : window.confirm(message);
        if (!confirmed) {
          return;
        }
      }
      await deleteThread(threadRef, {
        ...opts,
        // Always optimistic after the (synchronous) confirmation. The
        // non-optimistic branch awaits the WS round-trip before touching
        // the UI — perceived as a multi-second freeze. The optimistic
        // branch already toasts errors if the server delete fails.
        optimistic: true,
      });
    },
    [appSettingsConfirmThreadDelete, deleteThread, router],
  );

  const handleThreadClick = useCallback(
    (
      event: React.MouseEvent,
      threadRef: ScopedThreadRef,
      orderedProjectThreadKeys: readonly string[],
    ) => {
      const isMac = isMacPlatform(navigator.platform);
      const isModClick = isMac ? event.metaKey : event.ctrlKey;
      const isShiftClick = event.shiftKey;
      const threadKey = scopedThreadKey(threadRef);
      const currentSelectionCount = useThreadSelectionStore.getState().selectedThreadKeys.size;

      if (isModClick) {
        event.preventDefault();
        toggleThreadSelection(threadKey);
        return;
      }

      if (isShiftClick) {
        event.preventDefault();
        rangeSelectTo(threadKey, orderedProjectThreadKeys);
        return;
      }

      // Ignore the trailing click of a plain double-click so it doesn't navigate
      // while a double-click is starting an inline rename. Placed after the
      // modifier branches so cmd/shift selection still processes every click.
      if (isTrailingDoubleClick(event.detail)) {
        return;
      }

      if (currentSelectionCount > 0) {
        clearSelection();
      }
      setSelectionAnchor(threadKey);
      if (isMobile) {
        setOpenMobile(false);
      }
      void router.navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(threadRef),
      });
    },
    [
      clearSelection,
      isMobile,
      rangeSelectTo,
      router,
      setOpenMobile,
      setSelectionAnchor,
      toggleThreadSelection,
    ],
  );

  const handleMultiSelectContextMenu = useCallback(
    async (position: { x: number; y: number }) => {
      const api = readLocalApi();
      if (!api) return;
      const threadKeys = [...useThreadSelectionStore.getState().selectedThreadKeys];
      if (threadKeys.length === 0) return;
      const count = threadKeys.length;

      const clicked = await api.contextMenu.show(
        [
          { id: "mark-unread", label: `Mark unread (${count})` },
          { id: "delete", label: `Delete (${count})`, destructive: true },
        ],
        position,
      );

      if (clicked === "mark-unread") {
        for (const threadKey of threadKeys) {
          const thread = sidebarThreadByKeyRef.current.get(threadKey);
          markThreadUnread(threadKey, thread?.latestTurn?.completedAt);
        }
        clearSelection();
        return;
      }

      if (clicked !== "delete") return;

      const shouldConfirmDelete = shouldConfirmSidebarThreadSelectionDelete({
        confirmThreadDelete: appSettingsConfirmThreadDelete,
        threads: threadKeys.map((threadKey) => sidebarThreadByKeyRef.current.get(threadKey)),
      });

      if (shouldConfirmDelete) {
        const confirmed = await api.dialogs.confirm(
          [
            `Delete ${count} thread${count === 1 ? "" : "s"}?`,
            "This permanently clears conversation history for these threads.",
          ].join("\n"),
        );
        if (!confirmed) return;
      }

      const deletedThreadKeys = new Set(threadKeys);
      for (const threadKey of threadKeys) {
        const thread = sidebarThreadByKeyRef.current.get(threadKey);
        if (!thread) continue;
        await deleteThread(scopeThreadRef(thread.environmentId, thread.id), {
          deletedThreadKeys,
        });
      }
      removeFromSelection(threadKeys);
    },
    [
      appSettingsConfirmThreadDelete,
      clearSelection,
      deleteThread,
      markThreadUnread,
      removeFromSelection,
      sidebarThreadByKeyRef,
    ],
  );

  const createThreadForProjectMember = useCallback(
    (
      member: SidebarProjectGroupMember,
      seedOverride?: {
        branch?: string | null;
        envMode: ThreadEnvMode;
        worktreePath?: string | null;
      },
    ) => {
      const currentRouteParams =
        router.state.matches[router.state.matches.length - 1]?.params ?? {};
      const currentRouteTarget = resolveThreadRouteTarget(currentRouteParams);
      const currentActiveThread =
        currentRouteTarget?.kind === "server"
          ? (selectThreadByRef(useStore.getState(), currentRouteTarget.threadRef) ?? null)
          : null;
      const draftStore = useComposerDraftStore.getState();
      const currentActiveDraftThread =
        currentRouteTarget?.kind === "server"
          ? (draftStore.getDraftThread(currentRouteTarget.threadRef) ?? null)
          : currentRouteTarget?.kind === "draft"
            ? (draftStore.getDraftSession(currentRouteTarget.draftId) ?? null)
            : null;
      const seedContext =
        seedOverride ??
        resolveSidebarNewThreadSeedContext({
          projectId: member.id,
          defaultEnvMode: resolveSidebarNewThreadEnvMode({
            defaultEnvMode: defaultThreadEnvMode,
          }),
          activeThread:
            currentActiveThread && currentActiveThread.projectId === member.id
              ? {
                  projectId: currentActiveThread.projectId,
                  branch: currentActiveThread.branch,
                  worktreePath: currentActiveThread.worktreePath,
                }
              : null,
          activeDraftThread:
            currentActiveDraftThread && currentActiveDraftThread.projectId === member.id
              ? {
                  projectId: currentActiveDraftThread.projectId,
                  branch: currentActiveDraftThread.branch,
                  worktreePath: currentActiveDraftThread.worktreePath,
                  envMode: currentActiveDraftThread.envMode,
                }
              : null,
        });
      if (isMobile) {
        setOpenMobile(false);
      }
      void handleNewThread(scopeProjectRef(member.environmentId, member.id), {
        ...(seedContext.branch !== undefined ? { branch: seedContext.branch } : {}),
        ...(seedContext.worktreePath !== undefined
          ? { worktreePath: seedContext.worktreePath }
          : {}),
        envMode: seedContext.envMode,
      });
    },
    [defaultThreadEnvMode, handleNewThread, isMobile, router, setOpenMobile],
  );

  const attemptArchiveThread = useCallback(
    async (threadRef: ScopedThreadRef) => {
      try {
        const thread = sidebarThreadByKeyRef.current.get(scopedThreadKey(threadRef)) ?? null;
        if (thread && !canArchiveSidebarThread(thread)) {
          toastManager.add({
            type: "warning",
            title: "Send a message before archiving",
          });
          return;
        }
        await archiveThread(threadRef);
      } catch (error) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to archive thread",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
    },
    [archiveThread, sidebarThreadByKeyRef],
  );

  const startThreadRename = useCallback((threadKey: string, title: string) => {
    setRenamingThreadKey(threadKey);
    setRenamingTitle(title);
    renamingCommittedRef.current = false;
  }, []);

  const cancelRename = useCallback(() => {
    setRenamingThreadKey(null);
    renamingInputRef.current = null;
  }, []);

  const commitRename = useCallback(
    async (threadRef: ScopedThreadRef, newTitle: string, originalTitle: string) => {
      const threadKey = scopedThreadKey(threadRef);
      const finishRename = () => {
        setRenamingThreadKey((current) => {
          if (current !== threadKey) return current;
          renamingInputRef.current = null;
          return null;
        });
      };

      const trimmed = newTitle.trim();
      if (trimmed.length === 0) {
        toastManager.add({
          type: "warning",
          title: "Thread title cannot be empty",
        });
        finishRename();
        return;
      }
      if (trimmed === originalTitle) {
        finishRename();
        return;
      }
      const api = readEnvironmentApi(threadRef.environmentId);
      if (!api) {
        finishRename();
        return;
      }
      try {
        await api.orchestration.dispatchCommand({
          type: "thread.meta.update",
          commandId: newCommandId(),
          threadId: threadRef.threadId,
          title: trimmed,
        });
      } catch (error) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to rename thread",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
      finishRename();
    },
    [],
  );

  // The single thread action inventory, as data. Both presenters — the DOM
  // context menu (desktop right-click) and the phone bottom-sheet kebab —
  // render this inventory and dispatch through `performThreadMenuAction`, so
  // the handlers are never forked.
  const listThreadMenuActions = useCallback(
    (threadKey: string): ThreadMenuActionItem[] => {
      const thread = sidebarThreadByKeyRef.current.get(threadKey) ?? null;
      if (!thread) return [];
      const draftId = (thread as SidebarThreadSummary & { draftId?: DraftId | undefined }).draftId;
      if (draftId) {
        return [{ id: "close", label: "Close session" }];
      }
      const archiveAvailable = canArchiveSidebarThread(thread);
      const isPinned = useUiStateStore.getState().pinnedThreadKeys[threadKey] === true;
      return [
        { id: isPinned ? "unpin" : "pin", label: isPinned ? "Unpin thread" : "Pin thread" },
        { id: "rename", label: "Rename thread" },
        { id: "mark-unread", label: "Mark unread" },
        { id: "copy-path", label: "Copy Path" },
        { id: "copy-thread-id", label: "Copy Thread ID" },
        ...(archiveAvailable
          ? [{ id: "archive", label: "Archive session" } satisfies ThreadMenuActionItem]
          : []),
        {
          id: "close",
          label: thread.worktreeId || thread.worktreePath ? "Close session" : "Delete thread",
          destructive: true,
        },
      ];
    },
    [sidebarThreadByKeyRef],
  );

  const performThreadMenuAction = useCallback(
    async (threadRef: ScopedThreadRef, actionId: ThreadMenuActionId) => {
      const threadKey = scopedThreadKey(threadRef);
      const thread = sidebarThreadByKeyRef.current.get(threadKey) ?? null;
      if (!thread) return;
      const draftId = (thread as SidebarThreadSummary & { draftId?: DraftId | undefined }).draftId;
      const archiveAvailable = !draftId && canArchiveSidebarThread(thread);
      const threadProject = memberProjectByScopedKey.get(
        scopedProjectKey(scopeProjectRef(thread.environmentId, thread.projectId)),
      );
      const threadWorkspacePath = thread.worktreePath ?? threadProject?.cwd ?? projectCwd ?? null;

      if (actionId === "rename") {
        startThreadRename(threadKey, thread.title);
        return;
      }

      if (actionId === "pin" || actionId === "unpin") {
        useUiStateStore.getState().setThreadPinned(threadKey, actionId === "pin");
        return;
      }

      if (actionId === "mark-unread") {
        markThreadUnread(threadKey, thread.latestTurn?.completedAt);
        return;
      }
      if (actionId === "copy-path") {
        if (!threadWorkspacePath) {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Path unavailable",
              description: "This thread does not have a workspace path to copy.",
            }),
          );
          return;
        }
        copyPathToClipboard(threadWorkspacePath, { path: threadWorkspacePath });
        return;
      }
      if (actionId === "copy-thread-id") {
        copyThreadIdToClipboard(thread.id, { threadId: thread.id });
        return;
      }
      if (actionId === "archive") {
        if (
          shouldConfirmSidebarThreadArchive({
            archiveAvailable,
            confirmThreadArchive: appSettingsConfirmThreadArchive,
          })
        ) {
          const message = [
            `Archive session "${thread.title}"?`,
            "You can restore archived sessions from Settings > Archive.",
          ].join("\n");
          const localApi = readLocalApi();
          const confirmed = localApi
            ? await localApi.dialogs.confirm(message)
            : window.confirm(message);
          if (!confirmed) return;
        }
        await attemptArchiveThread(threadRef);
        return;
      }
      if (actionId !== "close") return;
      await closeThread(thread);
    },
    [
      attemptArchiveThread,
      appSettingsConfirmThreadArchive,
      closeThread,
      copyPathToClipboard,
      copyThreadIdToClipboard,
      markThreadUnread,
      memberProjectByScopedKey,
      projectCwd,
      sidebarThreadByKeyRef,
      startThreadRename,
    ],
  );

  const handleThreadContextMenu = useCallback(
    async (threadRef: ScopedThreadRef, position: { x: number; y: number }) => {
      const api = readLocalApi();
      if (!api) return;
      const threadKey = scopedThreadKey(threadRef);
      const thread = sidebarThreadByKeyRef.current.get(threadKey) ?? null;
      if (!thread) return;
      const draftId = (thread as SidebarThreadSummary & { draftId?: DraftId | undefined }).draftId;
      if (draftId && selectedThreadCount > 0) {
        clearSelection();
      }
      const items = listThreadMenuActions(threadKey);
      if (items.length === 0) return;
      const clicked = await api.contextMenu.show(
        items.map((item) =>
          item.destructive
            ? { id: item.id, label: item.label, destructive: true }
            : { id: item.id, label: item.label },
        ),
        position,
      );
      if (!clicked) return;
      await performThreadMenuAction(threadRef, clicked as ThreadMenuActionId);
    },
    [
      clearSelection,
      listThreadMenuActions,
      performThreadMenuAction,
      selectedThreadCount,
      sidebarThreadByKeyRef,
    ],
  );

  return {
    renamingThreadKey,
    renamingTitle,
    setRenamingTitle,
    renamingCommittedRef,
    renamingInputRef,
    navigateToThread,
    navigateToDraft,
    closeThread,
    handleThreadClick,
    handleMultiSelectContextMenu,
    createThreadForProjectMember,
    attemptArchiveThread,
    startThreadRename,
    cancelRename,
    commitRename,
    listThreadMenuActions,
    performThreadMenuAction,
    handleThreadContextMenu,
  };
}
