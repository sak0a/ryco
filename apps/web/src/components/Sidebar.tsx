import {
  ArchiveIcon,
  CloudIcon,
  CopyIcon,
  Edit3Icon,
  FolderPlusIcon,
  FolderOpenIcon,
  MoreHorizontalIcon,
  PlusIcon,
  SettingsIcon,
  TerminalIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import {
  ChangeRequestStatusIcon,
  prStatusIndicator,
  resolveThreadPr,
  terminalStatusFromRunningIds,
  ThreadStatusLabel,
} from "./ThreadStatusIndicators";
import { ProjectFavicon } from "./ProjectFavicon";
import {
  AzureDevOpsIcon,
  AtlassianJiraIcon,
  BitbucketIcon,
  ForgejoIcon,
  GitHubIcon,
  GitIcon,
  GitLabIcon,
  type Icon,
} from "./Icons";
import { autoAnimate, type AnimationController } from "@formkit/auto-animate";
import React, { useCallback, useEffect, memo, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  type DragCancelEvent,
  type CollisionDetection,
  PointerSensor,
  type DragStartEvent,
  closestCorners,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  type ContextMenuItem,
  type DesktopUpdateState,
  ProjectId,
  type RepositoryIdentity,
  type ScopedThreadRef,
  type SidebarProjectGroupingMode,
  type ThreadEnvMode,
  ThreadId,
  WorktreeId,
} from "@ryco/contracts";
import {
  parseScopedThreadKey,
  scopedProjectKey,
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@ryco/client-runtime";
import { useNavigate, useParams, useRouter } from "@tanstack/react-router";
import { useQueries } from "@tanstack/react-query";
import { type SidebarThreadSortOrder } from "@ryco/contracts/settings";
import { usePrimaryEnvironmentId } from "../environments/primary";
import { isElectron } from "../env";
import { isTerminalFocused } from "../lib/terminalFocus";
import { PREFERS_REDUCED_MOTION_QUERY, shouldEnableAutoAnimate } from "../lib/perf/motion";
import { cn, isMacPlatform, newCommandId } from "../lib/utils";
import {
  selectProjectByRef,
  selectProjectsAcrossEnvironments,
  selectSidebarThreadsForProjectRefs,
  selectSidebarThreadsAcrossEnvironments,
  selectSidebarWorktreesAcrossEnvironments,
  selectSidebarWorktreesForProjectRefs,
  selectThreadByRef,
  useStore,
} from "../store";
import { selectThreadTerminalState, useTerminalStateStore } from "../terminalStateStore";
import {
  parseProjectTreeItemId,
  projectFolderTreeItemId,
  projectTreeItemId,
  type UiProjectTreeItemId,
  useUiStateStore,
} from "../uiStateStore";
import {
  resolveShortcutCommand,
  hasNoShortcutModifiers,
  hasOpenDialogShortcutTarget,
  shouldIgnoreGlobalNavigationShortcut,
  shortcutLabelForCommand,
  shouldShowThreadJumpHintsForModifiers,
  threadJumpCommandForIndex,
  threadJumpIndexFromCommand,
  threadTraversalDirectionFromCommand,
} from "../keybindings";
import { useModelPickerOpen } from "../modelPickerOpenState";
import { useShortcutModifierState } from "../shortcutModifierState";
import { useGitStatus, type GitStatusState } from "../lib/gitStatusState";
import { resolveJiraProjectOpenUrl } from "../lib/workItemLocalLinks";
import { readLocalApi } from "../localApi";
import { useComposerDraftStore, type DraftId } from "../composerDraftStore";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { retainThreadDetailSubscription } from "../environments/runtime/service";
import { useMediaQuery } from "../hooks/useMediaQuery";

import { useThreadActions } from "../hooks/useThreadActions";
import {
  buildThreadRouteParams,
  resolveThreadRouteRef,
  resolveThreadRouteTarget,
} from "../threadRoutes";
import {
  markSidebarExpandClick,
  markSidebarExpandFirstPaint,
  usePerfMark,
} from "../perf/tabSwitchInstrumentation";
import { stackedThreadToast, toastManager } from "./ui/toast";
import { formatRelativeTimeLabel } from "../timestampFormat";
import {
  getArm64IntelBuildWarningDescription,
  getDesktopUpdateActionError,
  getDesktopUpdateInstallConfirmationMessage,
  isDesktopUpdateButtonDisabled,
  resolveDesktopUpdateButtonAction,
  shouldShowArm64IntelBuildWarning,
  shouldToastDesktopUpdateActionResult,
} from "./desktopUpdate.logic";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Menu, MenuGroup, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "./ui/menu";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "./ui/select";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import {
  SidebarMenuButton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarSeparator,
  useSidebar,
} from "./ui/sidebar";
import { useThreadSelectionStore } from "../threadSelectionStore";
import { useCommandPaletteStore } from "../commandPaletteStore";
import {
  getSidebarThreadIdsToPrewarm,
  canArchiveSidebarThread,
  resolveAdjacentThreadId,
  isContextMenuPointerDown,
  resolveProjectStatusIndicator,
  resolveSidebarNewThreadSeedContext,
  resolveSidebarNewThreadEnvMode,
  resolveThreadRowClassName,
  resolveThreadStatusPill,
  orderItemsByPreferredIds,
  shouldAutoAnimateSidebarProjectList,
  shouldAutoAnimateSidebarThreadLists,
  shouldClearThreadSelectionOnMouseDown,
  shouldConfirmSidebarThreadArchive,
  shouldConfirmSidebarThreadDelete,
  shouldConfirmSidebarThreadSelectionDelete,
  shouldQuerySidebarSourceControlCounts,
  sortProjectsForSidebar,
  useThreadJumpHintVisibility,
  ThreadStatusPill,
} from "./Sidebar.logic";
import { sortThreads } from "../lib/threadSort";
import {
  SidebarWorktreeList,
  type SidebarThreadGitStatusTarget,
} from "./sidebar/SidebarWorktreeList";
import {
  resolveSidebarStatusTextStyle,
  resolveThreadStatusTextClassName,
} from "./sidebar/sidebarStatusText";
import { ProjectSettingsDialog } from "./sidebar/ProjectSettingsDialog";
import {
  adaptProjectForSidebarTree,
  createSidebarProjectDraftThreadsSelector,
} from "./sidebar/sidebarTreeAdapters";
import {
  composeSidebarTree,
  isSyntheticWorktreeId,
  useSidebarTree,
  type SidebarTreeThread,
  type SidebarTreeWorktree,
} from "./sidebar/hooks/useSidebarTree";
import {
  SidebarProjectsContent,
  PROJECT_ROOT_DROP_ID,
  type SortableProjectHandleProps,
} from "./sidebar/SidebarProjectList";
import { SidebarChromeHeader, SidebarChromeFooter } from "./sidebar/SidebarChrome";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { openInPreferredEditor } from "../editorPreferences";
import { readEnvironmentApi } from "../environmentApi";
import { useSettings, useUpdateSettings } from "~/hooks/useSettings";
import {
  ProjectExplorerDialog,
  type ProjectExplorerTabId,
} from "./projectExplorer/ProjectExplorerDialog";
import { NewWorktreeDialog, type NewWorktreeDialogTab } from "./worktrees/NewWorktreeDialog";
import { workItemsQueryKeys } from "~/lib/workItemsRpc";
import { useServerKeybindings } from "../rpc/serverState";
import {
  derivePhysicalProjectKey,
  deriveProjectGroupingOverrideKey,
  getProjectOrderKey,
} from "../logicalProject";
import {
  readEnvironmentConnection,
  useSavedEnvironmentRegistryStore,
  useSavedEnvironmentRuntimeStore,
  resolveEnvironmentHttpUrl,
} from "../environments/runtime";
import type { SidebarThreadSummary } from "../types";
import {
  buildPhysicalToLogicalProjectKeyMap,
  buildSidebarProjectSnapshots,
  type SidebarProjectGroupMember,
  type SidebarProjectSnapshot,
} from "../sidebarProjectGrouping";
import { buildSidebarProjectFolderTree } from "../sidebarProjectFolders";
const THREAD_PREVIEW_LIMIT = 6;

const PROJECT_GROUPING_MODE_LABELS: Record<SidebarProjectGroupingMode, string> = {
  repository: "Group by repository",
  repository_path: "Group by repository path",
  separate: "Keep separate",
};

const SIDEBAR_LIST_ANIMATION_OPTIONS = {
  duration: 180,
  easing: "ease-out",
} as const;
type SidebarAutoAnimateControllers = Map<HTMLElement, AnimationController>;
const EMPTY_THREAD_JUMP_LABELS = new Map<string, string>();

function formatProjectMemberActionLabel(
  member: SidebarProjectGroupMember,
  groupedProjectCount: number,
): string {
  if (groupedProjectCount <= 1) {
    return member.name;
  }

  return member.environmentLabel ? `${member.environmentLabel} — ${member.cwd}` : member.cwd;
}

function projectGroupingModeDescription(mode: SidebarProjectGroupingMode): string {
  switch (mode) {
    case "repository":
      return "Projects from the same repository share one sidebar row.";
    case "repository_path":
      return "Projects group only when both the repository and repo-relative path match.";
    case "separate":
      return "Every project path gets its own sidebar row.";
  }
}

function pruneDisconnectedSidebarAutoAnimateControllers(
  controllers: SidebarAutoAnimateControllers,
) {
  for (const [node] of controllers) {
    if (!node.isConnected) {
      controllers.delete(node);
    }
  }
}

function setSidebarAutoAnimateControllersEnabled(
  controllers: SidebarAutoAnimateControllers,
  enabled: boolean,
) {
  pruneDisconnectedSidebarAutoAnimateControllers(controllers);
  for (const controller of controllers.values()) {
    if (enabled) {
      controller.enable();
    } else {
      controller.disable();
    }
  }
}

function attachSidebarAutoAnimateNode(
  controllers: SidebarAutoAnimateControllers,
  node: HTMLElement | null,
  enabled: boolean,
) {
  if (node === null) {
    return;
  }
  pruneDisconnectedSidebarAutoAnimateControllers(controllers);
  let controller = controllers.get(node);
  if (controller === undefined) {
    if (!enabled) {
      return;
    }
    controller = autoAnimate(node, SIDEBAR_LIST_ANIMATION_OPTIONS);
    controllers.set(node, controller);
  }
  if (enabled) {
    controller.enable();
  } else {
    controller.disable();
  }
}

function buildThreadJumpLabelMap(input: {
  keybindings: ReturnType<typeof useServerKeybindings>;
  platform: string;
  terminalOpen: boolean;
  threadJumpCommandByKey: ReadonlyMap<
    string,
    NonNullable<ReturnType<typeof threadJumpCommandForIndex>>
  >;
}): ReadonlyMap<string, string> {
  if (input.threadJumpCommandByKey.size === 0) {
    return EMPTY_THREAD_JUMP_LABELS;
  }

  const shortcutLabelOptions = {
    platform: input.platform,
    context: {
      terminalFocus: false,
      terminalOpen: input.terminalOpen,
    },
  } as const;
  const mapping = new Map<string, string>();
  for (const [threadKey, command] of input.threadJumpCommandByKey) {
    const label = shortcutLabelForCommand(input.keybindings, command, shortcutLabelOptions);
    if (label) {
      mapping.set(threadKey, label);
    }
  }
  return mapping.size > 0 ? mapping : EMPTY_THREAD_JUMP_LABELS;
}

interface SidebarThreadRowProps {
  thread: SidebarThreadSummary & { draftId?: DraftId | undefined };
  projectCwd: string | null;
  gitStatus?: GitStatusState | null | undefined;
  orderedProjectThreadKeys: readonly string[];
  isActive: boolean;
  isTreeChild?: boolean | undefined;
  jumpLabel: string | null;
  appSettingsConfirmThreadArchive: boolean;
  renamingThreadKey: string | null;
  renamingTitle: string;
  setRenamingTitle: (title: string) => void;
  renamingInputRef: React.RefObject<HTMLInputElement | null>;
  renamingCommittedRef: React.RefObject<boolean>;
  confirmingArchiveThreadKey: string | null;
  setConfirmingArchiveThreadKey: React.Dispatch<React.SetStateAction<string | null>>;
  confirmArchiveButtonRefs: React.RefObject<Map<string, HTMLButtonElement>>;
  handleThreadClick: (
    event: React.MouseEvent,
    threadRef: ScopedThreadRef,
    orderedProjectThreadKeys: readonly string[],
  ) => void;
  navigateToThread: (threadRef: ScopedThreadRef) => void;
  navigateToDraft: (draftId: DraftId, threadRef: ScopedThreadRef) => void;
  handleMultiSelectContextMenu: (position: { x: number; y: number }) => Promise<void>;
  handleThreadContextMenu: (
    threadRef: ScopedThreadRef,
    position: { x: number; y: number },
  ) => Promise<void>;
  closeThread: (
    thread: SidebarThreadSummary & { draftId?: DraftId | undefined },
    opts?: { deletedThreadKeys?: ReadonlySet<string> },
  ) => Promise<void>;
  clearSelection: () => void;
  commitRename: (
    threadRef: ScopedThreadRef,
    newTitle: string,
    originalTitle: string,
  ) => Promise<void>;
  cancelRename: () => void;
  attemptArchiveThread: (threadRef: ScopedThreadRef) => Promise<void>;
  openPrLink: (event: React.MouseEvent<HTMLElement>, prUrl: string) => void;
}

const SidebarThreadRow = memo(function SidebarThreadRow(props: SidebarThreadRowProps) {
  if (props.gitStatus !== undefined) {
    return <SidebarThreadRowContent {...props} gitStatus={props.gitStatus} />;
  }

  return <SidebarThreadRowWithGitStatusFallback {...props} />;
});

function SidebarThreadRowWithGitStatusFallback(props: SidebarThreadRowProps) {
  const { thread } = props;
  // For grouped projects, the thread may belong to a different environment
  // than the representative project.  Look up the thread's own project cwd
  // so git status (and thus PR detection) queries the correct path.
  const threadProjectCwd = useStore(
    useMemo(
      () => (state: import("../store").AppState) =>
        selectProjectByRef(state, scopeProjectRef(thread.environmentId, thread.projectId))?.cwd ??
        null,
      [thread.environmentId, thread.projectId],
    ),
  );
  const gitCwd = thread.worktreePath ?? threadProjectCwd ?? props.projectCwd;
  const gitStatus = useGitStatus({
    environmentId: thread.environmentId,
    cwd: thread.branch != null ? gitCwd : null,
  });

  return <SidebarThreadRowContent {...props} gitStatus={gitStatus} />;
}

const SidebarThreadRowContent = memo(function SidebarThreadRowContent(
  props: SidebarThreadRowProps & { gitStatus: GitStatusState | null },
) {
  const {
    orderedProjectThreadKeys,
    isActive,
    jumpLabel,
    appSettingsConfirmThreadArchive,
    renamingThreadKey,
    renamingTitle,
    setRenamingTitle,
    renamingInputRef,
    renamingCommittedRef,
    confirmingArchiveThreadKey,
    setConfirmingArchiveThreadKey,
    confirmArchiveButtonRefs,
    handleThreadClick,
    navigateToThread,
    navigateToDraft,
    handleMultiSelectContextMenu,
    handleThreadContextMenu,
    closeThread,
    clearSelection,
    commitRename,
    cancelRename,
    attemptArchiveThread,
    openPrLink,
    thread,
  } = props;
  const gitStatus = props.gitStatus;
  const threadRef = scopeThreadRef(thread.environmentId, thread.id);
  const threadKey = scopedThreadKey(threadRef);
  const draftId = thread.draftId ?? null;
  const lastVisitedAt = useUiStateStore((state) => state.threadLastVisitedAtById[threadKey]);
  const isSelected = useThreadSelectionStore((state) => state.selectedThreadKeys.has(threadKey));
  const hasSelection = useThreadSelectionStore((state) => state.selectedThreadKeys.size > 0);
  const runningTerminalIds = useTerminalStateStore(
    (state) =>
      selectThreadTerminalState(state.terminalStateByThreadKey, threadRef).runningTerminalIds,
  );
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const isRemoteThread =
    primaryEnvironmentId !== null && thread.environmentId !== primaryEnvironmentId;
  const remoteEnvLabel = useSavedEnvironmentRuntimeStore(
    (s) => s.byId[thread.environmentId]?.descriptor?.label ?? null,
  );
  const remoteEnvSavedLabel = useSavedEnvironmentRegistryStore(
    (s) => s.byId[thread.environmentId]?.label ?? null,
  );
  const threadEnvironmentLabel = isRemoteThread
    ? (remoteEnvLabel ?? remoteEnvSavedLabel ?? "Remote")
    : null;
  const isHighlighted = isActive || isSelected;
  const isThreadRunning =
    thread.session?.status === "running" && thread.session.activeTurnId != null;
  const threadStatus = resolveThreadStatusPill({
    thread: {
      ...thread,
      lastVisitedAt,
    },
  });
  const pr = gitStatus ? resolveThreadPr(thread.branch, gitStatus.data) : null;
  const prStatus = prStatusIndicator(pr, gitStatus?.data?.sourceControlProvider);
  const terminalStatus = terminalStatusFromRunningIds(runningTerminalIds);
  const isConfirmingArchive = confirmingArchiveThreadKey === threadKey && !isThreadRunning;
  const canArchiveThread = !draftId && canArchiveSidebarThread(thread);
  const canCloseThread = props.isTreeChild && !isThreadRunning;
  const threadMetaClassName = isConfirmingArchive
    ? "pointer-events-none opacity-0"
    : !isThreadRunning
      ? "pointer-events-none transition-opacity duration-150 max-sm:pr-10 group-hover/menu-sub-item:opacity-0 group-focus-within/menu-sub-item:opacity-0"
      : "pointer-events-none";
  const threadStatusTextStyle = useMemo(
    () => (threadStatus ? resolveSidebarStatusTextStyle(thread.title) : undefined),
    [thread.title, threadStatus],
  );
  const clearConfirmingArchive = useCallback(() => {
    setConfirmingArchiveThreadKey((current) => (current === threadKey ? null : current));
  }, [setConfirmingArchiveThreadKey, threadKey]);
  const handleMouseLeave = useCallback(() => {
    clearConfirmingArchive();
  }, [clearConfirmingArchive]);
  const handleBlurCapture = useCallback(
    (event: React.FocusEvent<HTMLLIElement>) => {
      const currentTarget = event.currentTarget;
      requestAnimationFrame(() => {
        if (currentTarget.contains(document.activeElement)) {
          return;
        }
        clearConfirmingArchive();
      });
    },
    [clearConfirmingArchive],
  );
  const handleRowClick = useCallback(
    (event: React.MouseEvent) => {
      if (draftId) {
        const isMac = isMacPlatform(navigator.platform);
        if ((isMac ? event.metaKey : event.ctrlKey) || event.shiftKey) {
          event.preventDefault();
          return;
        }
        navigateToDraft(draftId, threadRef);
        return;
      }
      handleThreadClick(event, threadRef, orderedProjectThreadKeys);
    },
    [draftId, handleThreadClick, navigateToDraft, orderedProjectThreadKeys, threadRef],
  );
  const handleRowKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      if (draftId) {
        navigateToDraft(draftId, threadRef);
        return;
      }
      navigateToThread(threadRef);
    },
    [draftId, navigateToDraft, navigateToThread, threadRef],
  );
  const handleRowContextMenu = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      if (draftId) {
        if (hasSelection) {
          clearSelection();
        }
        return;
      }
      if (hasSelection && isSelected) {
        void handleMultiSelectContextMenu({
          x: event.clientX,
          y: event.clientY,
        });
        return;
      }

      if (hasSelection) {
        clearSelection();
      }
      void handleThreadContextMenu(threadRef, {
        x: event.clientX,
        y: event.clientY,
      });
    },
    [
      clearSelection,
      handleMultiSelectContextMenu,
      handleThreadContextMenu,
      draftId,
      hasSelection,
      isSelected,
      threadRef,
    ],
  );
  const handlePrClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      if (!prStatus) return;
      openPrLink(event, prStatus.url);
    },
    [openPrLink, prStatus],
  );
  const handleRenameInputRef = useCallback(
    (element: HTMLInputElement | null) => {
      if (element && renamingInputRef.current !== element) {
        renamingInputRef.current = element;
        element.focus();
        element.select();
      }
    },
    [renamingInputRef],
  );
  const handleRenameInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setRenamingTitle(event.target.value);
    },
    [setRenamingTitle],
  );
  const handleRenameInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      event.stopPropagation();
      if (event.key === "Enter") {
        event.preventDefault();
        renamingCommittedRef.current = true;
        void commitRename(threadRef, renamingTitle, thread.title);
      } else if (event.key === "Escape") {
        event.preventDefault();
        renamingCommittedRef.current = true;
        cancelRename();
      }
    },
    [cancelRename, commitRename, renamingCommittedRef, renamingTitle, thread.title, threadRef],
  );
  const handleRenameInputBlur = useCallback(() => {
    if (!renamingCommittedRef.current) {
      void commitRename(threadRef, renamingTitle, thread.title);
    }
  }, [commitRename, renamingCommittedRef, renamingTitle, thread.title, threadRef]);
  const handleRenameInputClick = useCallback((event: React.MouseEvent<HTMLInputElement>) => {
    event.stopPropagation();
  }, []);
  const handleConfirmArchiveRef = useCallback(
    (element: HTMLButtonElement | null) => {
      if (element) {
        confirmArchiveButtonRefs.current.set(threadKey, element);
      } else {
        confirmArchiveButtonRefs.current.delete(threadKey);
      }
    },
    [confirmArchiveButtonRefs, threadKey],
  );
  const stopPropagationOnPointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      event.stopPropagation();
    },
    [],
  );
  const handleConfirmArchiveClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      clearConfirmingArchive();
      void attemptArchiveThread(threadRef);
    },
    [attemptArchiveThread, clearConfirmingArchive, threadRef],
  );
  const handleStartArchiveConfirmation = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setConfirmingArchiveThreadKey(threadKey);
      requestAnimationFrame(() => {
        confirmArchiveButtonRefs.current.get(threadKey)?.focus();
      });
    },
    [confirmArchiveButtonRefs, setConfirmingArchiveThreadKey, threadKey],
  );
  const handleArchiveImmediateClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      void attemptArchiveThread(threadRef);
    },
    [attemptArchiveThread, threadRef],
  );
  const handleCloseClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      void closeThread(thread);
    },
    [closeThread, thread],
  );
  const rowButtonRender = useMemo(() => <div role="button" tabIndex={0} />, []);

  return (
    <SidebarMenuSubItem
      className={cn(
        "w-full",
        props.isTreeChild &&
          "pl-5 before:absolute before:top-0 before:bottom-0 before:left-2 before:w-px before:bg-sidebar-border/70 after:absolute after:left-2 after:top-1/2 after:h-px after:w-3 after:bg-sidebar-border/70",
      )}
      data-thread-item
      onMouseLeave={handleMouseLeave}
      onBlurCapture={handleBlurCapture}
    >
      <SidebarMenuSubButton
        render={rowButtonRender}
        size="sm"
        isActive={isActive}
        data-testid={`thread-row-${thread.id}`}
        className={`${resolveThreadRowClassName({
          isActive,
          isSelected,
        })} relative isolate`}
        onClick={handleRowClick}
        onKeyDown={handleRowKeyDown}
        onContextMenu={handleRowContextMenu}
      >
        <div className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
          {prStatus && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label={prStatus.tooltip}
                    className={`inline-flex items-center justify-center ${prStatus.colorClass} cursor-pointer rounded-sm outline-hidden focus-visible:ring-1 focus-visible:ring-ring`}
                    onClick={handlePrClick}
                  >
                    <ChangeRequestStatusIcon className="size-3" />
                  </button>
                }
              />
              <TooltipPopup side="top">{prStatus.tooltip}</TooltipPopup>
            </Tooltip>
          )}
          {renamingThreadKey === threadKey ? (
            <input
              ref={handleRenameInputRef}
              className="min-w-0 flex-1 truncate text-base sm:text-xs bg-transparent outline-none border border-ring rounded px-0.5"
              value={renamingTitle}
              onChange={handleRenameInputChange}
              onKeyDown={handleRenameInputKeyDown}
              onBlur={handleRenameInputBlur}
              onClick={handleRenameInputClick}
            />
          ) : (
            <Tooltip>
              <TooltipTrigger
                render={
                  <span
                    className={resolveThreadStatusTextClassName(
                      threadStatus,
                      "min-w-0 flex-1 truncate text-xs",
                    )}
                    aria-label={
                      threadStatus ? `${threadStatus.label}: ${thread.title}` : thread.title
                    }
                    style={threadStatusTextStyle}
                    data-testid={`thread-title-${thread.id}`}
                  >
                    {thread.title}
                  </span>
                }
              />
              <TooltipPopup side="top" className="max-w-80 whitespace-normal leading-tight">
                {threadStatus ? `${threadStatus.label}: ${thread.title}` : thread.title}
              </TooltipPopup>
            </Tooltip>
          )}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {terminalStatus && (
            <span
              role="img"
              aria-label={terminalStatus.label}
              title={terminalStatus.label}
              className={`inline-flex items-center justify-center ${terminalStatus.colorClass}`}
            >
              <TerminalIcon className={`size-3 ${terminalStatus.pulse ? "animate-pulse" : ""}`} />
            </span>
          )}
          <div
            className={`flex min-w-12 justify-end ${
              isRemoteThread ? "max-sm:min-w-24" : "max-sm:min-w-20"
            }`}
          >
            {isConfirmingArchive ? (
              <button
                ref={handleConfirmArchiveRef}
                type="button"
                data-thread-selection-safe
                data-testid={`thread-archive-confirm-${thread.id}`}
                aria-label={`Confirm archive ${thread.title}`}
                className="absolute top-1/2 right-1 inline-flex h-5 -translate-y-1/2 cursor-pointer items-center rounded-full bg-destructive/12 px-2 text-[10px] font-medium text-destructive transition-colors hover:bg-destructive/18 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-destructive/40"
                onPointerDown={stopPropagationOnPointerDown}
                onClick={handleConfirmArchiveClick}
              >
                Confirm
              </button>
            ) : canCloseThread || (canArchiveThread && !isThreadRunning) ? (
              <div className="pointer-events-none absolute top-1/2 right-1 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity duration-150 max-sm:pointer-events-auto max-sm:opacity-100 group-hover/menu-sub-item:pointer-events-auto group-hover/menu-sub-item:opacity-100 group-focus-within/menu-sub-item:pointer-events-auto group-focus-within/menu-sub-item:opacity-100">
                {canCloseThread ? (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <button
                          type="button"
                          data-thread-selection-safe
                          data-testid={`thread-close-${thread.id}`}
                          aria-label={`Close ${thread.title}`}
                          className="inline-flex size-5 cursor-pointer items-center justify-center text-muted-foreground/60 transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                          onPointerDown={stopPropagationOnPointerDown}
                          onClick={handleCloseClick}
                        >
                          <XIcon className="size-3.5" />
                        </button>
                      }
                    />
                    <TooltipPopup side="top">Close</TooltipPopup>
                  </Tooltip>
                ) : null}
                {canArchiveThread && !isThreadRunning && appSettingsConfirmThreadArchive ? (
                  <button
                    type="button"
                    data-thread-selection-safe
                    data-testid={`thread-archive-${thread.id}`}
                    aria-label={`Archive ${thread.title}`}
                    className="inline-flex size-5 cursor-pointer items-center justify-center text-muted-foreground/60 transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                    onPointerDown={stopPropagationOnPointerDown}
                    onClick={handleStartArchiveConfirmation}
                  >
                    <ArchiveIcon className="size-3.5" />
                  </button>
                ) : null}
                {canArchiveThread && !isThreadRunning && !appSettingsConfirmThreadArchive ? (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <button
                          type="button"
                          data-thread-selection-safe
                          data-testid={`thread-archive-${thread.id}`}
                          aria-label={`Archive ${thread.title}`}
                          className="inline-flex size-5 cursor-pointer items-center justify-center text-muted-foreground/60 transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                          onPointerDown={stopPropagationOnPointerDown}
                          onClick={handleArchiveImmediateClick}
                        >
                          <ArchiveIcon className="size-3.5" />
                        </button>
                      }
                    />
                    <TooltipPopup side="top">Archive</TooltipPopup>
                  </Tooltip>
                ) : null}
              </div>
            ) : null}
            <span className={threadMetaClassName}>
              <span className="inline-flex items-center gap-1">
                {isRemoteThread && (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <span
                          aria-label={threadEnvironmentLabel ?? "Remote"}
                          className="inline-flex h-5 items-center justify-center"
                        />
                      }
                    >
                      <CloudIcon className="block size-3 text-muted-foreground/60" />
                    </TooltipTrigger>
                    <TooltipPopup side="top">{threadEnvironmentLabel}</TooltipPopup>
                  </Tooltip>
                )}
                {jumpLabel ? (
                  <span
                    className="inline-flex h-5 items-center rounded-full border border-border/80 bg-background/90 px-1.5 font-mono text-[10px] font-medium tracking-tight text-foreground shadow-sm"
                    title={jumpLabel}
                  >
                    {jumpLabel}
                  </span>
                ) : (
                  <span
                    className={`text-[10px] ${
                      isHighlighted
                        ? "text-foreground/72 dark:text-foreground/82"
                        : "text-muted-foreground/40"
                    }`}
                  >
                    {formatRelativeTimeLabel(
                      thread.latestUserMessageAt ?? thread.updatedAt ?? thread.createdAt,
                    )}
                  </span>
                )}
              </span>
            </span>
          </div>
        </div>
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
  );
});

interface SidebarProjectThreadListProps {
  projectKey: string;
  projectExpanded: boolean;
  hasOverflowingThreads: boolean;
  hiddenThreadStatus: ThreadStatusPill | null;
  orderedProjectThreadKeys: readonly string[];
  renderedThreads: readonly SidebarThreadSummary[];
  showEmptyThreadState: boolean;
  shouldShowThreadPanel: boolean;
  isThreadListExpanded: boolean;
  projectCwd: string;
  activeRouteThreadKey: string | null;
  threadJumpLabelByKey: ReadonlyMap<string, string>;
  appSettingsConfirmThreadArchive: boolean;
  renamingThreadKey: string | null;
  renamingTitle: string;
  setRenamingTitle: (title: string) => void;
  renamingInputRef: React.RefObject<HTMLInputElement | null>;
  renamingCommittedRef: React.RefObject<boolean>;
  confirmingArchiveThreadKey: string | null;
  setConfirmingArchiveThreadKey: React.Dispatch<React.SetStateAction<string | null>>;
  confirmArchiveButtonRefs: React.RefObject<Map<string, HTMLButtonElement>>;
  attachThreadListAutoAnimateRef: (node: HTMLElement | null) => void;
  handleThreadClick: (
    event: React.MouseEvent,
    threadRef: ScopedThreadRef,
    orderedProjectThreadKeys: readonly string[],
  ) => void;
  navigateToThread: (threadRef: ScopedThreadRef) => void;
  navigateToDraft: (draftId: DraftId, threadRef: ScopedThreadRef) => void;
  handleMultiSelectContextMenu: (position: { x: number; y: number }) => Promise<void>;
  handleThreadContextMenu: (
    threadRef: ScopedThreadRef,
    position: { x: number; y: number },
  ) => Promise<void>;
  closeThread: (
    thread: SidebarThreadSummary & { draftId?: DraftId | undefined },
    opts?: { deletedThreadKeys?: ReadonlySet<string> },
  ) => Promise<void>;
  clearSelection: () => void;
  commitRename: (
    threadRef: ScopedThreadRef,
    newTitle: string,
    originalTitle: string,
  ) => Promise<void>;
  cancelRename: () => void;
  attemptArchiveThread: (threadRef: ScopedThreadRef) => Promise<void>;
  openPrLink: (event: React.MouseEvent<HTMLElement>, prUrl: string) => void;
  expandThreadListForProject: (projectKey: string) => void;
  collapseThreadListForProject: (projectKey: string) => void;
}

const SidebarProjectThreadList = memo(function SidebarProjectThreadList(
  props: SidebarProjectThreadListProps,
) {
  const {
    projectKey,
    projectExpanded,
    hasOverflowingThreads,
    hiddenThreadStatus,
    orderedProjectThreadKeys,
    renderedThreads,
    showEmptyThreadState,
    shouldShowThreadPanel,
    isThreadListExpanded,
    projectCwd,
    activeRouteThreadKey,
    threadJumpLabelByKey,
    appSettingsConfirmThreadArchive,
    renamingThreadKey,
    renamingTitle,
    setRenamingTitle,
    renamingInputRef,
    renamingCommittedRef,
    confirmingArchiveThreadKey,
    setConfirmingArchiveThreadKey,
    confirmArchiveButtonRefs,
    attachThreadListAutoAnimateRef,
    handleThreadClick,
    navigateToThread,
    navigateToDraft,
    handleMultiSelectContextMenu,
    handleThreadContextMenu,
    closeThread,
    clearSelection,
    commitRename,
    cancelRename,
    attemptArchiveThread,
    openPrLink,
    expandThreadListForProject,
    collapseThreadListForProject,
  } = props;
  const showMoreButtonRender = useMemo(() => <button type="button" />, []);
  const showLessButtonRender = useMemo(() => <button type="button" />, []);

  useEffect(() => {
    if (!projectExpanded || !shouldShowThreadPanel) {
      return;
    }
    queueMicrotask(() => markSidebarExpandFirstPaint(projectKey));
  }, [projectExpanded, projectKey, shouldShowThreadPanel]);

  return (
    <SidebarMenuSub
      ref={attachThreadListAutoAnimateRef}
      className="mx-1 my-0 w-full translate-x-0 gap-0.5 overflow-hidden px-1.5 py-0"
    >
      {shouldShowThreadPanel && showEmptyThreadState ? (
        <SidebarMenuSubItem className="w-full" data-thread-selection-safe>
          <div
            data-thread-selection-safe
            className="flex h-6 w-full translate-x-0 items-center px-2 text-left text-[10px] text-muted-foreground/60"
          >
            <span>No threads yet</span>
          </div>
        </SidebarMenuSubItem>
      ) : null}
      {shouldShowThreadPanel &&
        renderedThreads.map((thread) => {
          const threadKey = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
          return (
            <SidebarThreadRow
              key={threadKey}
              thread={thread}
              projectCwd={projectCwd}
              orderedProjectThreadKeys={orderedProjectThreadKeys}
              isActive={activeRouteThreadKey === threadKey}
              jumpLabel={threadJumpLabelByKey.get(threadKey) ?? null}
              appSettingsConfirmThreadArchive={appSettingsConfirmThreadArchive}
              renamingThreadKey={renamingThreadKey}
              renamingTitle={renamingTitle}
              setRenamingTitle={setRenamingTitle}
              renamingInputRef={renamingInputRef}
              renamingCommittedRef={renamingCommittedRef}
              confirmingArchiveThreadKey={confirmingArchiveThreadKey}
              setConfirmingArchiveThreadKey={setConfirmingArchiveThreadKey}
              confirmArchiveButtonRefs={confirmArchiveButtonRefs}
              handleThreadClick={handleThreadClick}
              navigateToThread={navigateToThread}
              navigateToDraft={navigateToDraft}
              handleMultiSelectContextMenu={handleMultiSelectContextMenu}
              handleThreadContextMenu={handleThreadContextMenu}
              closeThread={closeThread}
              clearSelection={clearSelection}
              commitRename={commitRename}
              cancelRename={cancelRename}
              attemptArchiveThread={attemptArchiveThread}
              openPrLink={openPrLink}
            />
          );
        })}

      {projectExpanded && hasOverflowingThreads && !isThreadListExpanded && (
        <SidebarMenuSubItem className="w-full">
          <SidebarMenuSubButton
            render={showMoreButtonRender}
            data-thread-selection-safe
            size="sm"
            className="h-6 w-full translate-x-0 justify-start px-2 text-left text-[10px] text-muted-foreground/60 hover:bg-accent hover:text-muted-foreground/80"
            onClick={() => {
              expandThreadListForProject(projectKey);
            }}
          >
            <span className="flex min-w-0 flex-1 items-center gap-2">
              {hiddenThreadStatus && <ThreadStatusLabel status={hiddenThreadStatus} compact />}
              <span>Show more</span>
            </span>
          </SidebarMenuSubButton>
        </SidebarMenuSubItem>
      )}
      {projectExpanded && hasOverflowingThreads && isThreadListExpanded && (
        <SidebarMenuSubItem className="w-full">
          <SidebarMenuSubButton
            render={showLessButtonRender}
            data-thread-selection-safe
            size="sm"
            className="h-6 w-full translate-x-0 justify-start px-2 text-left text-[10px] text-muted-foreground/60 hover:bg-accent hover:text-muted-foreground/80"
            onClick={() => {
              collapseThreadListForProject(projectKey);
            }}
          >
            <span>Show less</span>
          </SidebarMenuSubButton>
        </SidebarMenuSubItem>
      )}
    </SidebarMenuSub>
  );
});

interface SidebarProjectItemProps {
  project: SidebarProjectSnapshot;
  isThreadListExpanded: boolean;
  activeRouteThreadKey: string | null;
  newThreadShortcutLabel: string | null;
  handleNewThread: ReturnType<typeof useNewThreadHandler>["handleNewThread"];
  archiveThread: ReturnType<typeof useThreadActions>["archiveThread"];
  deleteThread: ReturnType<typeof useThreadActions>["deleteThread"];
  threadJumpLabelByKey: ReadonlyMap<string, string>;
  attachThreadListAutoAnimateRef: (node: HTMLElement | null) => void;
  expandThreadListForProject: (projectKey: string) => void;
  collapseThreadListForProject: (projectKey: string) => void;
  onNewFolderWithProject: (project: SidebarProjectSnapshot) => void;
  dragInProgressRef: React.RefObject<boolean>;
  suppressProjectClickAfterDragRef: React.RefObject<boolean>;
  suppressProjectClickForContextMenuRef: React.RefObject<boolean>;
  isManualProjectSorting: boolean;
  dragHandleProps: SortableProjectHandleProps | null;
}

function useHasIntersectedViewport(
  rootMargin = "160px 0px",
): [(node: HTMLElement | null) => void, boolean] {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [hasIntersected, setHasIntersected] = useState(false);

  useEffect(() => {
    if (hasIntersected || node === null) {
      return;
    }
    if (typeof IntersectionObserver === "undefined") {
      setHasIntersected(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setHasIntersected(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasIntersected, node, rootMargin]);

  return [setNode, hasIntersected];
}

interface ProjectRemoteLink {
  readonly label: string;
  readonly provider: string | undefined;
  readonly providerLabel: string;
  readonly url: string;
}

function formatRepositoryProviderLabel(provider: string | undefined): string {
  switch (provider) {
    case "github":
      return "GitHub";
    case "gitlab":
      return "GitLab";
    case "forgejo":
      return "Forgejo";
    case "azure-devops":
      return "Azure DevOps";
    case "bitbucket":
      return "Bitbucket";
    default:
      return "Remote";
  }
}

function resolveRepositoryProviderIcon(provider: string | undefined): Icon {
  switch (provider) {
    case "github":
      return GitHubIcon;
    case "gitlab":
      return GitLabIcon;
    case "forgejo":
      return ForgejoIcon;
    case "azure-devops":
      return AzureDevOpsIcon;
    case "bitbucket":
      return BitbucketIcon;
    default:
      return GitIcon;
  }
}

function stripGitSuffix(path: string): string {
  return path.replace(/\/+$/g, "").replace(/\.git$/i, "");
}

function rewriteAzureDevOpsBrowserUrl(host: string, pathSegments: string[]): string | null {
  // Azure DevOps SSH form: ssh://git@ssh.dev.azure.com/v3/<org>/<project>/<repo>
  // scp form:              git@ssh.dev.azure.com:v3/<org>/<project>/<repo>
  // Both produce pathSegments starting with "v3". The browse URL is
  // https://dev.azure.com/<org>/<project>/_git/<repo>.
  if (host !== "ssh.dev.azure.com") {
    return null;
  }
  const v3Index = pathSegments.indexOf("v3");
  if (v3Index === -1 || pathSegments.length < v3Index + 4) {
    return null;
  }
  const org = pathSegments[v3Index + 1];
  const project = pathSegments[v3Index + 2];
  const repo = pathSegments[v3Index + 3];
  if (!org || !project || !repo) return null;
  return `https://dev.azure.com/${org}/${project}/_git/${repo}`;
}

function resolveRemoteUrlToBrowserUrl(remoteUrl: string): string | null {
  const trimmed = remoteUrl.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      url.pathname = stripGitSuffix(url.pathname);
      url.search = "";
      url.hash = "";
      return url.toString();
    } catch {
      return null;
    }
  }

  if (/^(?:ssh|git):\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      const segments = stripGitSuffix(url.pathname)
        .split("/")
        .filter((segment) => segment.length > 0);
      const azureBrowserUrl = rewriteAzureDevOpsBrowserUrl(url.hostname, segments);
      if (azureBrowserUrl) return azureBrowserUrl;
      const repositoryPath = segments.join("/");
      return url.hostname && repositoryPath ? `https://${url.hostname}/${repositoryPath}` : null;
    } catch {
      return null;
    }
  }

  const scpStyleRemote = /^git@([^:/\s]+)[:/]([^#?\s]+)$/i.exec(trimmed);
  if (scpStyleRemote?.[1] && scpStyleRemote[2]) {
    const host = scpStyleRemote[1];
    const path = stripGitSuffix(scpStyleRemote[2]);
    const segments = path.split("/").filter((s) => s.length > 0);
    const azureBrowserUrl = rewriteAzureDevOpsBrowserUrl(host, segments);
    if (azureBrowserUrl) return azureBrowserUrl;
    return `https://${host}/${path}`;
  }

  return null;
}

function resolveProjectRemoteLink(
  repositoryIdentity: RepositoryIdentity | null | undefined,
  preferredRemoteName: string | null | undefined,
): ProjectRemoteLink | null {
  if (!repositoryIdentity) return null;

  const candidate = (() => {
    if (preferredRemoteName) {
      const match = (repositoryIdentity.remotes ?? []).find(
        (remote) => remote.name === preferredRemoteName,
      );
      if (match) {
        return {
          url: match.url,
          label: match.ownerRepo ?? match.url,
          provider: match.provider ?? undefined,
        };
      }
    }
    const locatorUrl = repositoryIdentity.locator.remoteUrl;
    return {
      url: locatorUrl,
      label: repositoryIdentity.displayName ?? repositoryIdentity.canonicalKey,
      provider: repositoryIdentity.provider ?? undefined,
    };
  })();

  const url = resolveRemoteUrlToBrowserUrl(candidate.url);
  if (!url) return null;
  return {
    url,
    label: candidate.label,
    provider: candidate.provider,
    providerLabel: formatRepositoryProviderLabel(candidate.provider),
  };
}

function ProjectSettingsMenu(props: {
  jiraProjectOpenUrlByProjectKey: ReadonlyMap<string, string>;
  project: SidebarProjectSnapshot;
  onCopyPath: (member: SidebarProjectGroupMember) => void;
  onGrouping: (member: SidebarProjectGroupMember) => void;
  onNewFolderWithProject: (project: SidebarProjectSnapshot) => void;
  onOpenJiraProject: (member: SidebarProjectGroupMember) => void;
  onOpenOverview: () => void;
  onOpenRemote: (member: SidebarProjectGroupMember) => void;
  onRemove: (member: SidebarProjectGroupMember) => void;
  onRename: (member: SidebarProjectGroupMember) => void;
  onSettings: (member: SidebarProjectGroupMember) => void;
}) {
  const renderActions = (member: SidebarProjectGroupMember) => {
    const remoteLink = resolveProjectRemoteLink(
      member.repositoryIdentity,
      member.preferredRemoteName,
    );
    const jiraProjectUrl =
      props.jiraProjectOpenUrlByProjectKey.get(
        scopedProjectKey(scopeProjectRef(member.environmentId, member.id)),
      ) ?? null;
    const RemoteIcon = resolveRepositoryProviderIcon(remoteLink?.provider);
    return (
      <>
        <MenuItem onClick={() => props.onSettings(member)} className="min-h-7 py-1 sm:text-xs">
          <SettingsIcon className="size-3.5" />
          Project settings
        </MenuItem>
        {remoteLink ? (
          <MenuItem onClick={() => props.onOpenRemote(member)} className="min-h-7 py-1 sm:text-xs">
            <RemoteIcon className="size-3.5" />
            Open remote
          </MenuItem>
        ) : null}
        {jiraProjectUrl ? (
          <MenuItem
            onClick={() => props.onOpenJiraProject(member)}
            className="min-h-7 py-1 sm:text-xs"
          >
            <AtlassianJiraIcon className="size-3.5" />
            Open Jira project
          </MenuItem>
        ) : null}
        <MenuSeparator />
        <MenuItem onClick={() => props.onRename(member)} className="min-h-7 py-1 sm:text-xs">
          <Edit3Icon className="size-3.5" />
          Rename project
        </MenuItem>
        <MenuItem onClick={() => props.onGrouping(member)} className="min-h-7 py-1 sm:text-xs">
          <SettingsIcon className="size-3.5" />
          Project grouping...
        </MenuItem>
        <MenuItem onClick={() => props.onCopyPath(member)} className="min-h-7 py-1 sm:text-xs">
          <CopyIcon className="size-3.5" />
          Copy Project Path
        </MenuItem>
        <MenuSeparator />
        <MenuItem
          onClick={() => props.onRemove(member)}
          variant="destructive"
          className="min-h-7 py-1 sm:text-xs"
        >
          <Trash2Icon className="size-3.5" />
          Remove project
        </MenuItem>
      </>
    );
  };

  if (props.project.memberProjects.length === 1) {
    return (
      <MenuGroup>
        <MenuItem onClick={props.onOpenOverview} className="min-h-7 py-1 sm:text-xs">
          <FolderOpenIcon className="size-3.5" />
          Project overview
        </MenuItem>
        <MenuItem
          onClick={() => props.onNewFolderWithProject(props.project)}
          className="min-h-7 py-1 sm:text-xs"
        >
          <FolderPlusIcon className="size-3.5" />
          New folder with project
        </MenuItem>
        <MenuSeparator />
        {renderActions(props.project.memberProjects[0]!)}
      </MenuGroup>
    );
  }

  return (
    <>
      <MenuGroup>
        <MenuItem onClick={props.onOpenOverview} className="min-h-7 py-1 sm:text-xs">
          <FolderOpenIcon className="size-3.5" />
          Project overview
        </MenuItem>
        <MenuItem
          onClick={() => props.onNewFolderWithProject(props.project)}
          className="min-h-7 py-1 sm:text-xs"
        >
          <FolderPlusIcon className="size-3.5" />
          New folder with grouped project
        </MenuItem>
      </MenuGroup>
      <MenuSeparator />
      {props.project.memberProjects.map((member, index) => (
        <MenuGroup key={member.physicalProjectKey}>
          <div className="px-2 py-1 text-[10px] font-medium text-muted-foreground">
            {formatProjectMemberActionLabel(member, props.project.groupedProjectCount)}
          </div>
          {renderActions(member)}
          {index < props.project.memberProjects.length - 1 ? <MenuSeparator /> : null}
        </MenuGroup>
      ))}
    </>
  );
}

const SidebarProjectItem = memo(function SidebarProjectItem(props: SidebarProjectItemProps) {
  const {
    project,
    isThreadListExpanded,
    activeRouteThreadKey,
    handleNewThread,
    archiveThread,
    deleteThread,
    threadJumpLabelByKey,
    attachThreadListAutoAnimateRef,
    expandThreadListForProject,
    collapseThreadListForProject,
    onNewFolderWithProject,
    dragInProgressRef,
    suppressProjectClickAfterDragRef,
    suppressProjectClickForContextMenuRef,
    isManualProjectSorting,
    dragHandleProps,
  } = props;
  const threadSortOrder = useSettings<SidebarThreadSortOrder>(
    (settings) => settings.sidebarThreadSortOrder,
  );
  const appSettingsConfirmThreadDelete = useSettings<boolean>(
    (settings) => settings.confirmThreadDelete,
  );
  const appSettingsConfirmThreadArchive = useSettings<boolean>(
    (settings) => settings.confirmThreadArchive,
  );
  const defaultThreadEnvMode = useSettings<ThreadEnvMode>(
    (settings) => settings.defaultThreadEnvMode,
  );
  const projectGroupingSettings = useSettings((settings) => ({
    sidebarProjectGroupingMode: settings.sidebarProjectGroupingMode,
    sidebarProjectGroupingOverrides: settings.sidebarProjectGroupingOverrides,
  }));
  const { updateSettings } = useUpdateSettings();
  const router = useRouter();
  const { isMobile, setOpenMobile } = useSidebar();
  const markThreadUnread = useUiStateStore((state) => state.markThreadUnread);
  const toggleProject = useUiStateStore((state) => state.toggleProject);
  const toggleThreadSelection = useThreadSelectionStore((state) => state.toggleThread);
  const rangeSelectTo = useThreadSelectionStore((state) => state.rangeSelectTo);
  const clearSelection = useThreadSelectionStore((state) => state.clearSelection);
  const removeFromSelection = useThreadSelectionStore((state) => state.removeFromSelection);
  const setSelectionAnchor = useThreadSelectionStore((state) => state.setAnchor);
  const selectedThreadCount = useThreadSelectionStore((state) => state.selectedThreadKeys.size);
  const { copyToClipboard: copyThreadIdToClipboard } = useCopyToClipboard<{
    threadId: ThreadId;
  }>({
    onCopy: (ctx) => {
      toastManager.add({
        type: "success",
        title: "Thread ID copied",
        description: ctx.threadId,
      });
    },
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Failed to copy thread ID",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    },
  });
  const { copyToClipboard: copyPathToClipboard } = useCopyToClipboard<{
    path: string;
  }>({
    onCopy: (ctx) => {
      toastManager.add({
        type: "success",
        title: "Path copied",
        description: ctx.path,
      });
    },
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Failed to copy path",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    },
  });
  const openPrLink = useCallback((event: React.MouseEvent<HTMLElement>, prUrl: string) => {
    event.preventDefault();
    event.stopPropagation();

    const api = readLocalApi();
    if (!api) {
      toastManager.add({
        type: "error",
        title: "Link opening is unavailable.",
      });
      return;
    }

    void api.shell.openExternal(prUrl).catch((error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Unable to open pull request link",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    });
  }, []);
  const sidebarThreads = useStore(
    useShallow(
      useMemo(
        () => (state: import("../store").AppState) =>
          selectSidebarThreadsForProjectRefs(state, project.memberProjectRefs),
        [project.memberProjectRefs],
      ),
    ),
  );
  const sidebarWorktrees = useStore(
    useShallow(
      useMemo(
        () => (state: import("../store").AppState) =>
          selectSidebarWorktreesForProjectRefs(state, project.memberProjectRefs),
        [project.memberProjectRefs],
      ),
    ),
  );
  const projectDraftThreads = useComposerDraftStore(
    useMemo(() => createSidebarProjectDraftThreadsSelector(project), [project]),
  );
  const sidebarThreadByKey = useMemo(
    () =>
      new Map(
        sidebarThreads.map(
          (thread) =>
            [scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)), thread] as const,
        ),
      ),
    [sidebarThreads],
  );
  // Keep a ref so callbacks can read the latest map without appearing in
  // dependency arrays (avoids invalidating every thread-row memo on each
  // thread-list change).
  const sidebarThreadByKeyRef = useRef(sidebarThreadByKey);
  sidebarThreadByKeyRef.current = sidebarThreadByKey;
  const projectThreads = useMemo(
    () => [...sidebarThreads, ...projectDraftThreads],
    [projectDraftThreads, sidebarThreads],
  );
  const projectExpanded = useUiStateStore(
    (state) => state.projectExpandedById[project.projectKey] ?? true,
  );
  const threadLastVisitedAts = useUiStateStore(
    useShallow((state) =>
      projectThreads.map(
        (thread) =>
          state.threadLastVisitedAtById[
            scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))
          ] ?? null,
      ),
    ),
  );
  const lastVisitedAtByThreadKey = useMemo(
    () =>
      new Map(
        projectThreads.map((thread, index) => [
          scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
          threadLastVisitedAts[index] ?? null,
        ]),
      ),
    [projectThreads, threadLastVisitedAts],
  );
  const [renamingThreadKey, setRenamingThreadKey] = useState<string | null>(null);
  const [renamingTitle, setRenamingTitle] = useState("");
  const [confirmingArchiveThreadKey, setConfirmingArchiveThreadKey] = useState<string | null>(null);
  const [newWorktreeDialogOpen, setNewWorktreeDialogOpen] = useState(false);
  const [newWorktreeInitialTab, setNewWorktreeInitialTab] =
    useState<NewWorktreeDialogTab>("branches");
  const [explorerDialog, setExplorerDialog] = useState<{
    open: boolean;
    initialTab: ProjectExplorerTabId;
  }>({ open: false, initialTab: "overview" });
  const [setProjectHeaderVisibilityNode, projectHeaderHasIntersected] = useHasIntersectedViewport();
  const [projectRenameTarget, setProjectRenameTarget] = useState<SidebarProjectGroupMember | null>(
    null,
  );
  const [projectRenameTitle, setProjectRenameTitle] = useState("");
  const [projectGroupingTarget, setProjectGroupingTarget] =
    useState<SidebarProjectGroupMember | null>(null);
  const [projectGroupingSelection, setProjectGroupingSelection] = useState<
    SidebarProjectGroupingMode | "inherit"
  >("inherit");
  const [projectSettingsTarget, setProjectSettingsTarget] =
    useState<SidebarProjectGroupMember | null>(null);
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false);
  const projectSettingsTargetRef = useRef<SidebarProjectGroupMember | null>(null);
  const projectSettingsOpenFrameRef = useRef<number | null>(null);
  const projectSettingsCleanupTimeoutRef = useRef<number | null>(null);
  useEffect(() => {
    projectSettingsTargetRef.current = projectSettingsTarget;
  }, [projectSettingsTarget]);
  const clearProjectSettingsTimers = useCallback(() => {
    if (projectSettingsOpenFrameRef.current !== null) {
      window.cancelAnimationFrame(projectSettingsOpenFrameRef.current);
      projectSettingsOpenFrameRef.current = null;
    }
    if (projectSettingsCleanupTimeoutRef.current !== null) {
      window.clearTimeout(projectSettingsCleanupTimeoutRef.current);
      projectSettingsCleanupTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => () => clearProjectSettingsTimers(), [clearProjectSettingsTimers]);
  const [projectSettingsTitle, setProjectSettingsTitle] = useState("");
  const [projectSettingsWorkspaceRoot, setProjectSettingsWorkspaceRoot] = useState("");
  const [projectSettingsCustomSystemPrompt, setProjectSettingsCustomSystemPrompt] = useState("");
  const [projectSettingsSaving, setProjectSettingsSaving] = useState(false);
  const [projectSettingsCustomAvatarContentHash, setProjectSettingsCustomAvatarContentHash] =
    useState<string | null>(null);
  const [projectSettingsPreferredRemoteName, setProjectSettingsPreferredRemoteName] = useState<
    string | null
  >(null);
  const renamingCommittedRef = useRef(false);
  const renamingInputRef = useRef<HTMLInputElement | null>(null);
  const confirmArchiveButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const memberProjectByScopedKey = useMemo(
    () =>
      new Map(
        project.memberProjects.map((member) => [
          scopedProjectKey(scopeProjectRef(member.environmentId, member.id)),
          member,
        ]),
      ),
    [project.memberProjects],
  );
  const resolveThreadGitStatusTarget = useCallback(
    (
      thread: Pick<
        SidebarTreeThread,
        "branch" | "environmentId" | "projectId" | "sourceProjectId" | "worktreePath"
      >,
    ): SidebarThreadGitStatusTarget | null => {
      if (thread.branch === null) {
        return null;
      }
      const sourceProjectId = thread.sourceProjectId ?? thread.projectId;
      const memberProject = memberProjectByScopedKey.get(
        scopedProjectKey(scopeProjectRef(thread.environmentId, sourceProjectId)),
      );
      const cwd = thread.worktreePath ?? memberProject?.cwd ?? project.cwd;
      return cwd ? { environmentId: thread.environmentId, cwd } : null;
    },
    [memberProjectByScopedKey, project.cwd],
  );
  const memberThreadCountByPhysicalKey = useMemo(() => {
    const counts = new Map<string, number>(
      project.memberProjects.map((member) => [member.physicalProjectKey, 0] as const),
    );
    for (const thread of projectThreads) {
      const member = memberProjectByScopedKey.get(
        scopedProjectKey(scopeProjectRef(thread.environmentId, thread.projectId)),
      );
      if (!member) {
        continue;
      }
      counts.set(member.physicalProjectKey, (counts.get(member.physicalProjectKey) ?? 0) + 1);
    }
    return counts;
  }, [memberProjectByScopedKey, project.memberProjects, projectThreads]);
  const shouldQueryProjectIntegrations = shouldQuerySidebarSourceControlCounts({
    explorerOpen: explorerDialog.open,
    projectVisible: projectHeaderHasIntersected,
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
  const jiraProjectOpenUrlByProjectKey = useMemo(() => {
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

  const { projectStatus, visibleProjectThreads, orderedProjectThreadKeys } = useMemo(() => {
    const resolveProjectThreadStatus = (thread: SidebarThreadSummary) => {
      const lastVisitedAt = lastVisitedAtByThreadKey.get(
        scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
      );
      return resolveThreadStatusPill({
        thread: {
          ...thread,
          ...(lastVisitedAt !== null && lastVisitedAt !== undefined ? { lastVisitedAt } : {}),
        },
      });
    };
    const visibleProjectThreads = sortThreads(
      projectThreads.filter((thread) => thread.archivedAt === null),
      threadSortOrder,
    );
    const projectStatus = resolveProjectStatusIndicator(
      visibleProjectThreads.map((thread) => resolveProjectThreadStatus(thread)),
    );
    return {
      orderedProjectThreadKeys: visibleProjectThreads.map((thread) =>
        scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
      ),
      projectStatus,
      visibleProjectThreads,
    };
  }, [lastVisitedAtByThreadKey, projectThreads, threadSortOrder]);

  const pinnedCollapsedThread = useMemo(() => {
    const activeThreadKey = activeRouteThreadKey ?? undefined;
    if (!activeThreadKey || projectExpanded) {
      return null;
    }
    return (
      visibleProjectThreads.find(
        (thread) =>
          scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)) === activeThreadKey,
      ) ?? null
    );
  }, [activeRouteThreadKey, projectExpanded, visibleProjectThreads]);

  const {
    hasOverflowingThreads,
    hiddenThreadStatus,
    renderedThreads,
    showEmptyThreadState,
    shouldShowThreadPanel,
  } = useMemo(() => {
    const resolveProjectThreadStatus = (thread: SidebarThreadSummary) => {
      const lastVisitedAt = lastVisitedAtByThreadKey.get(
        scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
      );
      return resolveThreadStatusPill({
        thread: {
          ...thread,
          ...(lastVisitedAt !== null && lastVisitedAt !== undefined ? { lastVisitedAt } : {}),
        },
      });
    };
    const hasOverflowingThreads = visibleProjectThreads.length > THREAD_PREVIEW_LIMIT;
    const previewThreads =
      isThreadListExpanded || !hasOverflowingThreads
        ? visibleProjectThreads
        : visibleProjectThreads.slice(0, THREAD_PREVIEW_LIMIT);
    const visibleThreadKeys = new Set(
      [...previewThreads, ...(pinnedCollapsedThread ? [pinnedCollapsedThread] : [])].map((thread) =>
        scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
      ),
    );
    const renderedThreads = pinnedCollapsedThread
      ? [pinnedCollapsedThread]
      : visibleProjectThreads.filter((thread) =>
          visibleThreadKeys.has(scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))),
        );
    const hiddenThreads = visibleProjectThreads.filter(
      (thread) =>
        !visibleThreadKeys.has(scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))),
    );
    return {
      hasOverflowingThreads,
      hiddenThreadStatus: resolveProjectStatusIndicator(
        hiddenThreads.map((thread) => resolveProjectThreadStatus(thread)),
      ),
      renderedThreads,
      showEmptyThreadState: projectExpanded && visibleProjectThreads.length === 0,
      shouldShowThreadPanel: projectExpanded || pinnedCollapsedThread !== null,
    };
  }, [
    isThreadListExpanded,
    lastVisitedAtByThreadKey,
    pinnedCollapsedThread,
    projectExpanded,
    visibleProjectThreads,
  ]);
  const sidebarTreeInput = useMemo(() => {
    return adaptProjectForSidebarTree({
      lastVisitedAtByThreadKey,
      project,
      threads: sortThreads(projectThreads, threadSortOrder),
      worktrees: sidebarWorktrees,
    });
  }, [lastVisitedAtByThreadKey, project, projectThreads, sidebarWorktrees, threadSortOrder]);
  const sidebarTree = useSidebarTree({
    projects: [sidebarTreeInput.project],
    threads: sidebarTreeInput.threads,
    worktrees: sidebarTreeInput.worktrees,
  });
  const treeProject = sidebarTree.projects[0] ?? null;
  const visibleTreeThreadKeys = useMemo(() => {
    if (projectExpanded) {
      return null;
    }
    if (!pinnedCollapsedThread) {
      return new Set<string>();
    }
    return new Set([
      scopedThreadKey(
        scopeThreadRef(pinnedCollapsedThread.environmentId, pinnedCollapsedThread.id),
      ),
    ]);
  }, [pinnedCollapsedThread, projectExpanded]);
  const handleProjectButtonClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      if (suppressProjectClickForContextMenuRef.current) {
        suppressProjectClickForContextMenuRef.current = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (dragInProgressRef.current) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (suppressProjectClickAfterDragRef.current) {
        suppressProjectClickAfterDragRef.current = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (selectedThreadCount > 0) {
        clearSelection();
      }
      if (!projectExpanded) {
        markSidebarExpandClick(project.projectKey);
      }
      toggleProject(project.projectKey);
    },
    [
      clearSelection,
      dragInProgressRef,
      project.projectKey,
      projectExpanded,
      selectedThreadCount,
      suppressProjectClickAfterDragRef,
      suppressProjectClickForContextMenuRef,
      toggleProject,
    ],
  );

  const handleProjectButtonKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      if (dragInProgressRef.current) {
        return;
      }
      if (!projectExpanded) {
        markSidebarExpandClick(project.projectKey);
      }
      toggleProject(project.projectKey);
    },
    [dragInProgressRef, project.projectKey, projectExpanded, toggleProject],
  );

  const handleProjectButtonPointerDownCapture = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      suppressProjectClickForContextMenuRef.current = false;
      if (
        isContextMenuPointerDown({
          button: event.button,
          ctrlKey: event.ctrlKey,
          isMac: isMacPlatform(navigator.platform),
        })
      ) {
        event.stopPropagation();
      }

      suppressProjectClickAfterDragRef.current = false;
    },
    [suppressProjectClickAfterDragRef, suppressProjectClickForContextMenuRef],
  );

  const openProjectRenameDialog = useCallback((member: SidebarProjectGroupMember) => {
    setProjectRenameTarget(member);
    setProjectRenameTitle(member.name);
  }, []);

  const openProjectGroupingDialog = useCallback(
    (member: SidebarProjectGroupMember) => {
      const overrideKey = deriveProjectGroupingOverrideKey(member);
      setProjectGroupingTarget(member);
      setProjectGroupingSelection(
        projectGroupingSettings.sidebarProjectGroupingOverrides?.[overrideKey] ?? "inherit",
      );
    },
    [projectGroupingSettings.sidebarProjectGroupingOverrides],
  );

  const openProjectSettingsDialog = useCallback(
    (member: SidebarProjectGroupMember) => {
      clearProjectSettingsTimers();
      setProjectSettingsOpen(false);
      setProjectSettingsTarget(member);
      setProjectSettingsTitle(member.name);
      setProjectSettingsWorkspaceRoot(member.cwd);
      setProjectSettingsCustomSystemPrompt(member.customSystemPrompt ?? "");
      setProjectSettingsSaving(false);
      setProjectSettingsCustomAvatarContentHash(member.customAvatarContentHash ?? null);
      setProjectSettingsPreferredRemoteName(member.preferredRemoteName ?? null);
      projectSettingsOpenFrameRef.current = window.requestAnimationFrame(() => {
        projectSettingsOpenFrameRef.current = null;
        setProjectSettingsOpen(true);
      });
    },
    [clearProjectSettingsTimers],
  );

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

  const handleProjectButtonContextMenu = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      suppressProjectClickForContextMenuRef.current = true;
      void (async () => {
        const api = readLocalApi();
        if (!api) return;

        const actionHandlers = new Map<string, () => Promise<void> | void>();
        actionHandlers.set("project-overview", () => {
          setExplorerDialog({ open: true, initialTab: "overview" });
        });
        const makeLeaf = (
          action:
            | "settings"
            | "open-remote"
            | "open-jira"
            | "rename"
            | "grouping"
            | "copy-path"
            | "delete",
          member: SidebarProjectGroupMember,
          options?: {
            destructive?: boolean;
            disabled?: boolean;
          },
        ): ContextMenuItem<string> => {
          const id = `${action}:${member.physicalProjectKey}`;
          actionHandlers.set(id, () => {
            switch (action) {
              case "settings":
                openProjectSettingsDialog(member);
                return;
              case "open-remote":
                openProjectRemoteLink(member);
                return;
              case "open-jira":
                openProjectJiraLink(member);
                return;
              case "rename":
                openProjectRenameDialog(member);
                return;
              case "grouping":
                openProjectGroupingDialog(member);
                return;
              case "copy-path":
                copyPathToClipboard(member.cwd, { path: member.cwd });
                return;
              case "delete":
                return handleRemoveProject(member);
            }
          });

          return {
            id,
            label: formatProjectMemberActionLabel(member, project.groupedProjectCount),
            ...(options?.destructive ? { destructive: true } : {}),
            ...(options?.disabled ? { disabled: true } : {}),
          };
        };

        const buildTargetedItem = (
          action:
            | "settings"
            | "open-remote"
            | "open-jira"
            | "rename"
            | "grouping"
            | "copy-path"
            | "delete",
          label: string,
          options?: {
            destructive?: boolean;
            isDisabled?: (member: SidebarProjectGroupMember) => boolean;
          },
        ): ContextMenuItem<string> => {
          if (project.memberProjects.length === 1) {
            const singleMember = project.memberProjects[0]!;
            return {
              ...makeLeaf(action, singleMember, {
                ...(options?.destructive ? { destructive: true } : {}),
                ...(options?.isDisabled?.(singleMember) ? { disabled: true } : {}),
              }),
              label,
            };
          }

          return {
            id: `${action}:submenu`,
            label,
            children: project.memberProjects.map((member) =>
              makeLeaf(action, member, {
                ...(options?.destructive ? { destructive: true } : {}),
                ...(options?.isDisabled?.(member) ? { disabled: true } : {}),
              }),
            ),
          };
        };

        const hasAnyRemoteLink = project.memberProjects.some(
          (member) =>
            resolveProjectRemoteLink(member.repositoryIdentity, member.preferredRemoteName) !==
            null,
        );
        const hasAnyJiraProjectLink = project.memberProjects.some((member) =>
          jiraProjectOpenUrlByProjectKey.has(
            scopedProjectKey(scopeProjectRef(member.environmentId, member.id)),
          ),
        );
        const menuItems: ContextMenuItem<string>[] = [
          { id: "project-overview", label: "Project overview" },
          buildTargetedItem("settings", "Project settings"),
          ...(hasAnyRemoteLink
            ? [
                buildTargetedItem("open-remote", "Open remote", {
                  isDisabled: (member) =>
                    resolveProjectRemoteLink(
                      member.repositoryIdentity,
                      member.preferredRemoteName,
                    ) === null,
                }),
              ]
            : []),
          ...(hasAnyJiraProjectLink
            ? [
                buildTargetedItem("open-jira", "Open Jira project", {
                  isDisabled: (member) =>
                    !jiraProjectOpenUrlByProjectKey.has(
                      scopedProjectKey(scopeProjectRef(member.environmentId, member.id)),
                    ),
                }),
              ]
            : []),
          buildTargetedItem("rename", "Rename project"),
          buildTargetedItem("grouping", "Project grouping…"),
          buildTargetedItem("copy-path", "Copy Project Path"),
          buildTargetedItem("delete", "Remove project", {
            destructive: true,
          }),
        ];

        const clicked = await api.contextMenu.show(menuItems, {
          x: event.clientX,
          y: event.clientY,
        });

        if (!clicked) {
          return;
        }

        await actionHandlers.get(clicked)?.();
      })();
    },
    [
      copyPathToClipboard,
      handleRemoveProject,
      jiraProjectOpenUrlByProjectKey,
      openProjectGroupingDialog,
      openProjectJiraLink,
      openProjectRemoteLink,
      openProjectRenameDialog,
      openProjectSettingsDialog,
      project.groupedProjectCount,
      project.memberProjects,
      suppressProjectClickForContextMenuRef,
    ],
  );

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

  const handleOpenNewWorktreeClick = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setNewWorktreeInitialTab("branches");
    setNewWorktreeDialogOpen(true);
  }, []);

  const handleOpenProjectOverviewClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setExplorerDialog({ open: true, initialTab: "overview" });
    },
    [],
  );

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
    [archiveThread],
  );

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

  const closeProjectRenameDialog = useCallback(() => {
    setProjectRenameTarget(null);
    setProjectRenameTitle("");
  }, []);

  const closeProjectSettingsDialog = useCallback(() => {
    if (projectSettingsOpenFrameRef.current !== null) {
      window.cancelAnimationFrame(projectSettingsOpenFrameRef.current);
      projectSettingsOpenFrameRef.current = null;
    }
    setProjectSettingsOpen(false);
    if (projectSettingsCleanupTimeoutRef.current !== null) {
      window.clearTimeout(projectSettingsCleanupTimeoutRef.current);
    }
    projectSettingsCleanupTimeoutRef.current = window.setTimeout(() => {
      projectSettingsCleanupTimeoutRef.current = null;
      setProjectSettingsTarget(null);
      setProjectSettingsTitle("");
      setProjectSettingsWorkspaceRoot("");
      setProjectSettingsCustomSystemPrompt("");
      setProjectSettingsSaving(false);
      setProjectSettingsCustomAvatarContentHash(null);
      setProjectSettingsPreferredRemoteName(null);
    }, 340);
  }, []);

  const pickProjectSettingsWorkspaceRoot = useCallback(async () => {
    const api = readLocalApi();
    if (!api) {
      toastManager.add({
        type: "error",
        title: "Folder picker is unavailable.",
      });
      return;
    }

    const picked = await api.dialogs.pickFolder({
      initialPath: projectSettingsWorkspaceRoot.trim() || projectSettingsTarget?.cwd || null,
    });
    if (picked) {
      setProjectSettingsWorkspaceRoot(picked);
    }
  }, [projectSettingsTarget?.cwd, projectSettingsWorkspaceRoot]);

  const submitProjectSettings = useCallback(async () => {
    if (!projectSettingsTarget || projectSettingsSaving) {
      return;
    }

    const title = projectSettingsTitle.trim();
    const workspaceRoot = projectSettingsWorkspaceRoot.trim();
    const customSystemPrompt = projectSettingsCustomSystemPrompt.trim();
    if (title.length === 0) {
      toastManager.add({
        type: "warning",
        title: "Project title cannot be empty",
      });
      return;
    }
    if (workspaceRoot.length === 0) {
      toastManager.add({
        type: "warning",
        title: "Project root cannot be empty",
      });
      return;
    }

    const titleChanged = title !== projectSettingsTarget.name;
    const workspaceRootChanged = workspaceRoot !== projectSettingsTarget.cwd;
    const currentCustomSystemPrompt = projectSettingsTarget.customSystemPrompt?.trim() ?? "";
    const customSystemPromptChanged = customSystemPrompt !== currentCustomSystemPrompt;
    const preferredRemoteNameChanged =
      projectSettingsPreferredRemoteName !== (projectSettingsTarget.preferredRemoteName ?? null);
    if (
      !titleChanged &&
      !workspaceRootChanged &&
      !customSystemPromptChanged &&
      !preferredRemoteNameChanged
    ) {
      closeProjectSettingsDialog();
      return;
    }

    const api = readEnvironmentApi(projectSettingsTarget.environmentId);
    if (!api) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Failed to update project",
          description: "Project API unavailable.",
        }),
      );
      return;
    }

    setProjectSettingsSaving(true);
    try {
      await api.orchestration.dispatchCommand({
        type: "project.meta.update",
        commandId: newCommandId(),
        projectId: projectSettingsTarget.id,
        ...(titleChanged ? { title } : {}),
        ...(workspaceRootChanged ? { workspaceRoot } : {}),
        ...(customSystemPromptChanged
          ? { customSystemPrompt: customSystemPrompt.length > 0 ? customSystemPrompt : null }
          : {}),
        ...(preferredRemoteNameChanged
          ? { preferredRemoteName: projectSettingsPreferredRemoteName }
          : {}),
      });
      closeProjectSettingsDialog();
    } catch (error) {
      setProjectSettingsSaving(false);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Failed to update project",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    }
  }, [
    closeProjectSettingsDialog,
    projectSettingsSaving,
    projectSettingsCustomSystemPrompt,
    projectSettingsPreferredRemoteName,
    projectSettingsTarget,
    projectSettingsTitle,
    projectSettingsWorkspaceRoot,
  ]);

  const submitProjectRename = useCallback(async () => {
    if (!projectRenameTarget) {
      return;
    }

    const trimmed = projectRenameTitle.trim();
    if (trimmed.length === 0) {
      toastManager.add({
        type: "warning",
        title: "Project title cannot be empty",
      });
      return;
    }

    if (trimmed === projectRenameTarget.name) {
      closeProjectRenameDialog();
      return;
    }

    const api = readEnvironmentApi(projectRenameTarget.environmentId);
    if (!api) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Failed to rename project",
          description: "Project API unavailable.",
        }),
      );
      return;
    }

    try {
      await api.orchestration.dispatchCommand({
        type: "project.meta.update",
        commandId: newCommandId(),
        projectId: projectRenameTarget.id,
        title: trimmed,
      });
      closeProjectRenameDialog();
    } catch (error) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Failed to rename project",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    }
  }, [closeProjectRenameDialog, projectRenameTarget, projectRenameTitle]);

  const uploadProjectAvatar = useCallback(
    async (file: File) => {
      const initiating = projectSettingsTarget;
      if (!initiating) return;
      const api = readEnvironmentApi(initiating.environmentId);
      if (!api) return;
      const httpUrl = resolveEnvironmentHttpUrl({
        environmentId: initiating.environmentId,
        pathname: "/api/project-avatar/upload",
        searchParams: { projectId: initiating.id },
      });
      const formData = new FormData();
      formData.append("avatar", file);
      try {
        const response = await fetch(httpUrl, {
          method: "POST",
          body: formData,
          credentials: "include",
        });
        if (!response.ok) {
          const text = await response.text().catch(() => "");
          throw new Error(text || `Upload failed: ${response.status}`);
        }
        const { contentHash } = (await response.json()) as { contentHash: string };
        await api.orchestration.dispatchCommand({
          type: "project.avatar.set",
          commandId: newCommandId(),
          projectId: initiating.id,
          contentHash,
        });
        if (projectSettingsTargetRef.current?.id === initiating.id) {
          setProjectSettingsCustomAvatarContentHash(contentHash);
        }
      } catch (error) {
        if (projectSettingsTargetRef.current?.id !== initiating.id) return;
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to upload avatar",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
    },
    [projectSettingsTarget],
  );

  const removeProjectAvatar = useCallback(async () => {
    const initiating = projectSettingsTarget;
    if (!initiating) return;
    const api = readEnvironmentApi(initiating.environmentId);
    if (!api) return;
    try {
      await api.orchestration.dispatchCommand({
        type: "project.avatar.set",
        commandId: newCommandId(),
        projectId: initiating.id,
        contentHash: null,
      });
      if (projectSettingsTargetRef.current?.id === initiating.id) {
        setProjectSettingsCustomAvatarContentHash(null);
      }
    } catch (error) {
      if (projectSettingsTargetRef.current?.id !== initiating.id) return;
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Failed to remove avatar",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    }
  }, [projectSettingsTarget]);

  const openProjectRemoteByName = useCallback(
    (member: SidebarProjectGroupMember, remoteName: string) => {
      const remote = (member.repositoryIdentity?.remotes ?? []).find((r) => r.name === remoteName);
      if (!remote) return;
      const url = resolveRemoteUrlToBrowserUrl(remote.url);
      if (!url) return;
      const api = readLocalApi();
      if (!api) return;
      void api.shell.openExternal(url).catch((error) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Unable to open remote repository",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      });
    },
    [],
  );

  const closeProjectGroupingDialog = useCallback(() => {
    setProjectGroupingTarget(null);
    setProjectGroupingSelection("inherit");
  }, []);

  const saveProjectGroupingPreference = useCallback(() => {
    if (!projectGroupingTarget) {
      return;
    }

    const overrideKey = deriveProjectGroupingOverrideKey(projectGroupingTarget);
    const nextOverrides = {
      ...projectGroupingSettings.sidebarProjectGroupingOverrides,
    };
    if (projectGroupingSelection === "inherit") {
      delete nextOverrides[overrideKey];
    } else {
      nextOverrides[overrideKey] = projectGroupingSelection;
    }
    updateSettings({
      sidebarProjectGroupingOverrides: nextOverrides,
    });
    closeProjectGroupingDialog();
  }, [
    closeProjectGroupingDialog,
    projectGroupingSelection,
    projectGroupingSettings.sidebarProjectGroupingOverrides,
    projectGroupingTarget,
    updateSettings,
  ]);

  const handleThreadContextMenu = useCallback(
    async (threadRef: ScopedThreadRef, position: { x: number; y: number }) => {
      const api = readLocalApi();
      if (!api) return;
      const threadKey = scopedThreadKey(threadRef);
      const thread = sidebarThreadByKeyRef.current.get(threadKey) ?? null;
      if (!thread) return;
      const draftId = (thread as SidebarThreadSummary & { draftId?: DraftId | undefined }).draftId;
      const archiveAvailable = !draftId && canArchiveSidebarThread(thread);
      const threadProject = memberProjectByScopedKey.get(
        scopedProjectKey(scopeProjectRef(thread.environmentId, thread.projectId)),
      );
      const threadWorkspacePath = thread.worktreePath ?? threadProject?.cwd ?? project.cwd ?? null;
      if (draftId) {
        if (selectedThreadCount > 0) {
          clearSelection();
        }
        const clicked = await api.contextMenu.show(
          [{ id: "close", label: "Close session" }],
          position,
        );
        if (clicked === "close") {
          await closeThread(thread);
        }
        return;
      }
      const clicked = await api.contextMenu.show(
        [
          { id: "rename", label: "Rename thread" },
          { id: "mark-unread", label: "Mark unread" },
          { id: "copy-path", label: "Copy Path" },
          { id: "copy-thread-id", label: "Copy Thread ID" },
          ...(archiveAvailable ? [{ id: "archive", label: "Archive session" }] : []),
          {
            id: "close",
            label: thread.worktreeId || thread.worktreePath ? "Close session" : "Delete thread",
            destructive: true,
          },
        ],
        position,
      );

      if (clicked === "rename") {
        setRenamingThreadKey(threadKey);
        setRenamingTitle(thread.title);
        renamingCommittedRef.current = false;
        return;
      }

      if (clicked === "mark-unread") {
        markThreadUnread(threadKey, thread.latestTurn?.completedAt);
        return;
      }
      if (clicked === "copy-path") {
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
      if (clicked === "copy-thread-id") {
        copyThreadIdToClipboard(thread.id, { threadId: thread.id });
        return;
      }
      if (clicked === "archive") {
        if (
          shouldConfirmSidebarThreadArchive({
            archiveAvailable,
            confirmThreadArchive: appSettingsConfirmThreadArchive,
          })
        ) {
          const confirmed = await api.dialogs.confirm(
            [
              `Archive session "${thread.title}"?`,
              "You can restore archived sessions from Settings > Archive.",
            ].join("\n"),
          );
          if (!confirmed) return;
        }
        await attemptArchiveThread(threadRef);
        return;
      }
      if (clicked !== "close") return;
      await closeThread(thread);
    },
    [
      attemptArchiveThread,
      appSettingsConfirmThreadArchive,
      clearSelection,
      closeThread,
      copyPathToClipboard,
      copyThreadIdToClipboard,
      markThreadUnread,
      memberProjectByScopedKey,
      project.cwd,
      selectedThreadCount,
    ],
  );

  return (
    <>
      <div ref={setProjectHeaderVisibilityNode} className="group/project-header relative">
        <SidebarMenuButton
          ref={dragHandleProps?.setActivatorNodeRef}
          size="sm"
          className={`gap-2 px-2 py-1.5 pr-20 text-left hover:bg-accent group-hover/project-header:bg-accent group-hover/project-header:text-sidebar-accent-foreground ${
            isManualProjectSorting ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
          }`}
          {...(dragHandleProps ? dragHandleProps.attributes : {})}
          {...(dragHandleProps ? dragHandleProps.listeners : {})}
          onPointerDownCapture={handleProjectButtonPointerDownCapture}
          onClick={handleProjectButtonClick}
          onKeyDown={handleProjectButtonKeyDown}
          onContextMenu={handleProjectButtonContextMenu}
        >
          {!projectExpanded && projectStatus ? (
            <span
              aria-hidden="true"
              title={projectStatus.label}
              className={`-ml-0.5 relative inline-flex size-3.5 shrink-0 items-center justify-center ${projectStatus.colorClass}`}
            >
              <span
                className={`size-[9px] rounded-full ${projectStatus.dotClass} ${
                  projectStatus.pulse ? "animate-pulse" : ""
                }`}
              />
            </span>
          ) : null}
          <ProjectFavicon
            environmentId={project.environmentId}
            cwd={project.cwd}
            projectId={project.id}
            customAvatarContentHash={project.customAvatarContentHash ?? null}
            className="size-[18px]"
          />
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground/90">
              {project.displayName}
            </span>
            {project.groupedProjectCount > 1 ? (
              <span className="shrink-0 text-[10px] text-muted-foreground/60">
                {project.groupedProjectCount} projects
              </span>
            ) : null}
          </span>
        </SidebarMenuButton>
        {/* Environment badge – visible by default, crossfades with the
            "new thread" button on hover using the same pointer-events +
            opacity pattern as the thread row archive/timestamp swap. */}
        {project.environmentPresence === "remote-only" && (
          <Tooltip>
            <TooltipTrigger
              render={
                <span
                  aria-label={
                    project.environmentPresence === "remote-only"
                      ? "Remote project"
                      : "Available in multiple environments"
                  }
                  className="pointer-events-none absolute top-1 right-1.5 inline-flex size-5 items-center justify-center rounded-md text-muted-foreground/60 transition-opacity duration-150 max-sm:right-7 group-hover/project-header:opacity-0 group-focus-within/project-header:opacity-0 max-sm:group-hover/project-header:opacity-100 max-sm:group-focus-within/project-header:opacity-100"
                />
              }
            >
              <CloudIcon className="size-3" />
            </TooltipTrigger>
            <TooltipPopup side="top">
              Remote environment: {project.remoteEnvironmentLabels.join(", ")}
            </TooltipPopup>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger
            render={
              <div className="pointer-events-none absolute top-1 right-[3.25rem] opacity-0 transition-opacity duration-150 max-sm:pointer-events-auto max-sm:opacity-100 group-hover/project-header:pointer-events-auto group-hover/project-header:opacity-100 group-focus-within/project-header:pointer-events-auto group-focus-within/project-header:opacity-100">
                <button
                  type="button"
                  aria-label={`Open project overview for ${project.displayName}`}
                  data-testid="project-overview-button"
                  className="inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground/60 hover:bg-secondary hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                  onClick={handleOpenProjectOverviewClick}
                >
                  <FolderOpenIcon className="size-3.5" />
                </button>
              </div>
            }
          />
          <TooltipPopup side="top">Project overview</TooltipPopup>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <div className="pointer-events-none absolute top-1 right-7 opacity-0 transition-opacity duration-150 max-sm:pointer-events-auto max-sm:opacity-100 group-hover/project-header:pointer-events-auto group-hover/project-header:opacity-100 group-focus-within/project-header:pointer-events-auto group-focus-within/project-header:opacity-100">
                <button
                  type="button"
                  aria-label={`Create new workspace in ${project.displayName}`}
                  data-testid="new-thread-button"
                  className="inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground/60 hover:bg-secondary hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                  onClick={handleOpenNewWorktreeClick}
                >
                  <PlusIcon className="size-3.5" />
                </button>
              </div>
            }
          />
          <TooltipPopup side="top">New workspace</TooltipPopup>
        </Tooltip>
        <Menu>
          <Tooltip>
            <TooltipTrigger
              render={
                <MenuTrigger
                  aria-label={`Open project settings for ${project.displayName}`}
                  className="pointer-events-none absolute top-1 right-1.5 inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground/60 opacity-0 transition-opacity duration-150 hover:bg-secondary hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring max-sm:pointer-events-auto max-sm:opacity-100 group-hover/project-header:pointer-events-auto group-hover/project-header:opacity-100 group-focus-within/project-header:pointer-events-auto group-focus-within/project-header:opacity-100"
                />
              }
            >
              <MoreHorizontalIcon className="size-3.5" />
            </TooltipTrigger>
            <TooltipPopup side="top">Project settings</TooltipPopup>
          </Tooltip>
          <MenuPopup align="end" side="bottom" className="min-w-48">
            <ProjectSettingsMenu
              jiraProjectOpenUrlByProjectKey={jiraProjectOpenUrlByProjectKey}
              project={project}
              onCopyPath={(member) => {
                copyPathToClipboard(member.cwd, { path: member.cwd });
              }}
              onGrouping={openProjectGroupingDialog}
              onNewFolderWithProject={onNewFolderWithProject}
              onOpenJiraProject={openProjectJiraLink}
              onOpenOverview={() => setExplorerDialog({ open: true, initialTab: "overview" })}
              onOpenRemote={openProjectRemoteLink}
              onRemove={(member) => {
                void handleRemoveProject(member);
              }}
              onRename={openProjectRenameDialog}
              onSettings={openProjectSettingsDialog}
            />
          </MenuPopup>
        </Menu>
      </div>

      {treeProject?.isGitRepo ? (
        <SidebarWorktreeList
          treeProject={treeProject}
          projectExpanded={projectExpanded}
          visibleThreadKeys={visibleTreeThreadKeys}
          attachThreadListAutoAnimateRef={attachThreadListAutoAnimateRef}
          resolveThreadGitStatusTarget={resolveThreadGitStatusTarget}
          onArchiveWorktree={archiveWorktree}
          onCopyWorktreePath={copyWorktreePath}
          onDeleteWorktree={deleteWorktree}
          onNewSession={createThreadInWorktree}
          onOpenInEditor={openWorktreeInEditor}
          onOpenWorktree={openWorktree}
          onRenameWorktree={renameWorktree}
          onRestoreWorktree={restoreWorktree}
          renderThread={(thread: SidebarTreeThread, treeThreadKeys, gitStatus) => {
            const threadKey = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
            return (
              <SidebarThreadRow
                key={threadKey}
                thread={thread}
                projectCwd={project.cwd}
                gitStatus={gitStatus}
                orderedProjectThreadKeys={treeThreadKeys}
                isActive={activeRouteThreadKey === threadKey}
                jumpLabel={threadJumpLabelByKey.get(threadKey) ?? null}
                appSettingsConfirmThreadArchive={appSettingsConfirmThreadArchive}
                renamingThreadKey={renamingThreadKey}
                renamingTitle={renamingTitle}
                setRenamingTitle={setRenamingTitle}
                renamingInputRef={renamingInputRef}
                renamingCommittedRef={renamingCommittedRef}
                confirmingArchiveThreadKey={confirmingArchiveThreadKey}
                setConfirmingArchiveThreadKey={setConfirmingArchiveThreadKey}
                confirmArchiveButtonRefs={confirmArchiveButtonRefs}
                handleThreadClick={handleThreadClick}
                navigateToThread={navigateToThread}
                navigateToDraft={navigateToDraft}
                handleMultiSelectContextMenu={handleMultiSelectContextMenu}
                handleThreadContextMenu={handleThreadContextMenu}
                closeThread={closeThread}
                clearSelection={clearSelection}
                commitRename={commitRename}
                cancelRename={cancelRename}
                attemptArchiveThread={attemptArchiveThread}
                openPrLink={openPrLink}
                isTreeChild
              />
            );
          }}
        />
      ) : (
        <SidebarProjectThreadList
          projectKey={project.projectKey}
          projectExpanded={projectExpanded}
          hasOverflowingThreads={hasOverflowingThreads}
          hiddenThreadStatus={hiddenThreadStatus}
          orderedProjectThreadKeys={orderedProjectThreadKeys}
          renderedThreads={renderedThreads}
          showEmptyThreadState={showEmptyThreadState}
          shouldShowThreadPanel={shouldShowThreadPanel}
          isThreadListExpanded={isThreadListExpanded}
          projectCwd={project.cwd}
          activeRouteThreadKey={activeRouteThreadKey}
          threadJumpLabelByKey={threadJumpLabelByKey}
          appSettingsConfirmThreadArchive={appSettingsConfirmThreadArchive}
          renamingThreadKey={renamingThreadKey}
          renamingTitle={renamingTitle}
          setRenamingTitle={setRenamingTitle}
          renamingInputRef={renamingInputRef}
          renamingCommittedRef={renamingCommittedRef}
          confirmingArchiveThreadKey={confirmingArchiveThreadKey}
          setConfirmingArchiveThreadKey={setConfirmingArchiveThreadKey}
          confirmArchiveButtonRefs={confirmArchiveButtonRefs}
          attachThreadListAutoAnimateRef={attachThreadListAutoAnimateRef}
          handleThreadClick={handleThreadClick}
          navigateToThread={navigateToThread}
          navigateToDraft={navigateToDraft}
          handleMultiSelectContextMenu={handleMultiSelectContextMenu}
          handleThreadContextMenu={handleThreadContextMenu}
          closeThread={closeThread}
          clearSelection={clearSelection}
          commitRename={commitRename}
          cancelRename={cancelRename}
          attemptArchiveThread={attemptArchiveThread}
          openPrLink={openPrLink}
          expandThreadListForProject={expandThreadListForProject}
          collapseThreadListForProject={collapseThreadListForProject}
        />
      )}

      <NewWorktreeDialog
        open={newWorktreeDialogOpen}
        environmentId={project.environmentId}
        projectId={project.id}
        cwd={project.cwd}
        initialTab={newWorktreeInitialTab}
        onCreated={(result) => {
          navigateToThread(scopeThreadRef(project.environmentId, result.sessionId));
        }}
        onOpenChange={setNewWorktreeDialogOpen}
      />

      <ProjectExplorerDialog
        open={explorerDialog.open}
        projectName={project.displayName}
        memberProjects={project.memberProjects}
        initialTab={explorerDialog.initialTab}
        onOpenChange={(open) => setExplorerDialog((prev) => ({ ...prev, open }))}
      />

      <ProjectSettingsDialog
        open={projectSettingsOpen}
        target={projectSettingsTarget}
        title={projectSettingsTitle}
        customAvatarContentHash={projectSettingsCustomAvatarContentHash}
        preferredRemoteName={projectSettingsPreferredRemoteName}
        workspaceRoot={projectSettingsWorkspaceRoot}
        customSystemPrompt={projectSettingsCustomSystemPrompt}
        saving={projectSettingsSaving}
        onClose={closeProjectSettingsDialog}
        onSave={() => void submitProjectSettings()}
        onTitleChange={setProjectSettingsTitle}
        onWorkspaceRootChange={setProjectSettingsWorkspaceRoot}
        onCustomSystemPromptChange={setProjectSettingsCustomSystemPrompt}
        onPreferredRemoteChange={setProjectSettingsPreferredRemoteName}
        onPickWorkspaceRoot={() => void pickProjectSettingsWorkspaceRoot()}
        onOpenRemote={openProjectRemoteByName}
        onUploadAvatar={uploadProjectAvatar}
        onRemoveAvatar={removeProjectAvatar}
      />

      <Dialog
        open={projectRenameTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            closeProjectRenameDialog();
          }
        }}
      >
        <DialogPopup className="project-glass-surface max-w-lg" surface="glass">
          <DialogHeader>
            <DialogTitle>Rename project</DialogTitle>
            <DialogDescription>
              {projectRenameTarget
                ? `Update the title for ${projectRenameTarget.cwd}.`
                : "Update the project title."}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-4">
            <div className="grid gap-1.5">
              <span className="text-xs font-medium text-foreground">Project title</span>
              <Input
                aria-label="Project title"
                value={projectRenameTitle}
                onChange={(event) => setProjectRenameTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && hasNoShortcutModifiers(event)) {
                    event.preventDefault();
                    void submitProjectRename();
                  }
                }}
              />
            </div>
            {projectRenameTarget?.environmentLabel ? (
              <p className="text-xs text-muted-foreground">
                Environment: {projectRenameTarget.environmentLabel}
              </p>
            ) : null}
          </DialogPanel>
          <DialogFooter>
            <Button variant="outline" onClick={closeProjectRenameDialog}>
              Cancel
            </Button>
            <Button onClick={() => void submitProjectRename()}>Save</Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      <Dialog
        open={projectGroupingTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            closeProjectGroupingDialog();
          }
        }}
      >
        <DialogPopup className="project-glass-surface max-w-lg" surface="glass">
          <DialogHeader>
            <DialogTitle>Project grouping</DialogTitle>
            <DialogDescription>
              {projectGroupingTarget
                ? `Choose how ${projectGroupingTarget.cwd} should be grouped in the sidebar.`
                : "Choose how this project should be grouped in the sidebar."}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-4">
            <div className="grid gap-1.5">
              <span className="text-xs font-medium text-foreground">Grouping rule</span>
              <Select
                value={projectGroupingSelection}
                onValueChange={(value) => {
                  if (
                    value === "inherit" ||
                    value === "repository" ||
                    value === "repository_path" ||
                    value === "separate"
                  ) {
                    setProjectGroupingSelection(value);
                  }
                }}
              >
                <SelectTrigger className="w-full" aria-label="Project grouping rule">
                  <SelectValue>
                    {projectGroupingSelection === "inherit"
                      ? `Use global default (${PROJECT_GROUPING_MODE_LABELS[projectGroupingSettings.sidebarProjectGroupingMode]})`
                      : PROJECT_GROUPING_MODE_LABELS[projectGroupingSelection]}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  <SelectItem hideIndicator value="inherit">
                    Use global default
                  </SelectItem>
                  <SelectItem hideIndicator value="repository">
                    {PROJECT_GROUPING_MODE_LABELS.repository}
                  </SelectItem>
                  <SelectItem hideIndicator value="repository_path">
                    {PROJECT_GROUPING_MODE_LABELS.repository_path}
                  </SelectItem>
                  <SelectItem hideIndicator value="separate">
                    {PROJECT_GROUPING_MODE_LABELS.separate}
                  </SelectItem>
                </SelectPopup>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              {projectGroupingSelection === "inherit"
                ? projectGroupingModeDescription(projectGroupingSettings.sidebarProjectGroupingMode)
                : projectGroupingModeDescription(projectGroupingSelection)}
            </p>
          </DialogPanel>
          <DialogFooter>
            <Button variant="outline" onClick={closeProjectGroupingDialog}>
              Cancel
            </Button>
            <Button onClick={saveProjectGroupingPreference}>Save</Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
});

export default function Sidebar() {
  usePerfMark("Sidebar");
  const projects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const sidebarThreads = useStore(useShallow(selectSidebarThreadsAcrossEnvironments));
  const sidebarWorktrees = useStore(useShallow(selectSidebarWorktreesAcrossEnvironments));
  const projectExpandedById = useUiStateStore((store) => store.projectExpandedById);
  const projectOrder = useUiStateStore((store) => store.projectOrder);
  const projectFoldersById = useUiStateStore((store) => store.projectFoldersById);
  const projectFolderOrder = useUiStateStore((store) => store.projectFolderOrder);
  const projectTreeOrder = useUiStateStore((store) => store.projectTreeOrder);
  const reorderProjects = useUiStateStore((store) => store.reorderProjects);
  const moveProjectsToFolder = useUiStateStore((store) => store.moveProjectsToFolder);
  const moveProjectsToRoot = useUiStateStore((store) => store.moveProjectsToRoot);
  const reorderProjectTreeItem = useUiStateStore((store) => store.reorderProjectTreeItem);
  const navigate = useNavigate();
  const sidebarThreadSortOrder = useSettings((s) => s.sidebarThreadSortOrder);
  const sidebarProjectSortOrder = useSettings((s) => s.sidebarProjectSortOrder);
  const sidebarProjectGroupingMode = useSettings((s) => s.sidebarProjectGroupingMode);
  const projectGroupingSettings = useSettings((settings) => ({
    sidebarProjectGroupingMode: settings.sidebarProjectGroupingMode,
    sidebarProjectGroupingOverrides: settings.sidebarProjectGroupingOverrides,
  }));
  const { updateSettings } = useUpdateSettings();
  const { handleNewThread } = useNewThreadHandler();
  const { archiveThread, deleteThread } = useThreadActions();
  const { isMobile, setOpenMobile } = useSidebar();
  const routeThreadRef = useParams({
    strict: false,
    select: (params) => resolveThreadRouteRef(params),
  });
  const routeDraftId = useParams({
    strict: false,
    select: (params) => (typeof params.draftId === "string" ? (params.draftId as DraftId) : null),
  });
  const routeThreadKey = routeThreadRef ? scopedThreadKey(routeThreadRef) : null;
  const routeDraftThread = useComposerDraftStore(
    useMemo(
      () => (store) =>
        routeDraftId ? (store.draftThreadsByThreadKey[routeDraftId] ?? null) : null,
      [routeDraftId],
    ),
  );
  const routeDraftThreadKey = routeDraftThread
    ? scopedThreadKey(scopeThreadRef(routeDraftThread.environmentId, routeDraftThread.threadId))
    : null;
  const activeRouteThreadKey = routeThreadKey ?? routeDraftThreadKey;
  const keybindings = useServerKeybindings();
  const openAddProjectCommandPalette = useCommandPaletteStore((store) => store.openAddProject);
  const [expandedThreadListsByProject, setExpandedThreadListsByProject] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const { showThreadJumpHints, updateThreadJumpHintsVisibility } = useThreadJumpHintVisibility();
  const dragInProgressRef = useRef(false);
  const suppressProjectClickAfterDragRef = useRef(false);
  const suppressProjectClickForContextMenuRef = useRef(false);
  const [desktopUpdateState, setDesktopUpdateState] = useState<DesktopUpdateState | null>(null);
  const selectedThreadCount = useThreadSelectionStore((s) => s.selectedThreadKeys.size);
  const clearSelection = useThreadSelectionStore((s) => s.clearSelection);
  const setSelectionAnchor = useThreadSelectionStore((s) => s.setAnchor);
  const platform = navigator.platform;
  const shortcutModifiers = useShortcutModifierState();
  const modelPickerOpen = useModelPickerOpen();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const savedEnvironmentRegistry = useSavedEnvironmentRegistryStore((s) => s.byId);
  const savedEnvironmentRuntimeById = useSavedEnvironmentRuntimeStore((s) => s.byId);
  const orderedProjects = useMemo(() => {
    return orderItemsByPreferredIds({
      items: projects,
      preferredIds: projectOrder,
      getId: getProjectOrderKey,
    });
  }, [projectOrder, projects]);

  // Build a mapping from physical project key → logical project key for
  // cross-environment grouping.  Projects that share a repositoryIdentity
  // canonicalKey are treated as one logical project in the sidebar.
  const physicalToLogicalKey = useMemo(() => {
    return buildPhysicalToLogicalProjectKeyMap({
      projects: orderedProjects,
      settings: projectGroupingSettings,
    });
  }, [orderedProjects, projectGroupingSettings]);
  const projectPhysicalKeyByScopedRef = useMemo(
    () =>
      new Map(
        orderedProjects.map((project) => [
          scopedProjectKey(scopeProjectRef(project.environmentId, project.id)),
          derivePhysicalProjectKey(project),
        ]),
      ),
    [orderedProjects],
  );

  const sidebarProjects = useMemo<SidebarProjectSnapshot[]>(() => {
    return buildSidebarProjectSnapshots({
      projects: orderedProjects,
      settings: projectGroupingSettings,
      primaryEnvironmentId,
      resolveEnvironmentLabel: (environmentId) => {
        const rt = savedEnvironmentRuntimeById[environmentId];
        const saved = savedEnvironmentRegistry[environmentId];
        return rt?.descriptor?.label ?? saved?.label ?? null;
      },
    });
  }, [
    orderedProjects,
    projectGroupingSettings,
    primaryEnvironmentId,
    savedEnvironmentRegistry,
    savedEnvironmentRuntimeById,
  ]);

  const sidebarProjectByKey = useMemo(
    () => new Map(sidebarProjects.map((project) => [project.projectKey, project] as const)),
    [sidebarProjects],
  );
  const sidebarThreadByKey = useMemo(
    () =>
      new Map(
        sidebarThreads.map(
          (thread) =>
            [scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)), thread] as const,
        ),
      ),
    [sidebarThreads],
  );
  // Resolve the active route's project key to a logical key so it matches the
  // sidebar's grouped project entries.
  const activeRouteProjectKey = useMemo(() => {
    if (!activeRouteThreadKey) {
      return null;
    }
    const activeThread =
      sidebarThreadByKey.get(activeRouteThreadKey) ??
      (routeDraftThread
        ? ({
            environmentId: routeDraftThread.environmentId,
            projectId: routeDraftThread.projectId,
          } as Pick<SidebarThreadSummary, "environmentId" | "projectId">)
        : null);
    if (!activeThread) return null;
    const physicalKey =
      projectPhysicalKeyByScopedRef.get(
        scopedProjectKey(scopeProjectRef(activeThread.environmentId, activeThread.projectId)),
      ) ?? scopedProjectKey(scopeProjectRef(activeThread.environmentId, activeThread.projectId));
    return physicalToLogicalKey.get(physicalKey) ?? physicalKey;
  }, [
    activeRouteThreadKey,
    routeDraftThread,
    sidebarThreadByKey,
    physicalToLogicalKey,
    projectPhysicalKeyByScopedRef,
  ]);

  // Group threads by logical project key so all threads from grouped projects
  // are displayed together.
  const threadsByProjectKey = useMemo(() => {
    const next = new Map<string, SidebarThreadSummary[]>();
    for (const thread of sidebarThreads) {
      const physicalKey =
        projectPhysicalKeyByScopedRef.get(
          scopedProjectKey(scopeProjectRef(thread.environmentId, thread.projectId)),
        ) ?? scopedProjectKey(scopeProjectRef(thread.environmentId, thread.projectId));
      const logicalKey = physicalToLogicalKey.get(physicalKey) ?? physicalKey;
      const existing = next.get(logicalKey);
      if (existing) {
        existing.push(thread);
      } else {
        next.set(logicalKey, [thread]);
      }
    }
    return next;
  }, [sidebarThreads, physicalToLogicalKey, projectPhysicalKeyByScopedRef]);
  const worktreesByProjectKey = useMemo(() => {
    const next = new Map<string, typeof sidebarWorktrees>();
    for (const worktree of sidebarWorktrees) {
      const physicalKey =
        projectPhysicalKeyByScopedRef.get(
          scopedProjectKey(scopeProjectRef(worktree.environmentId, worktree.projectId)),
        ) ?? scopedProjectKey(scopeProjectRef(worktree.environmentId, worktree.projectId));
      const logicalKey = physicalToLogicalKey.get(physicalKey) ?? physicalKey;
      const existing = next.get(logicalKey);
      if (existing) {
        existing.push(worktree);
      } else {
        next.set(logicalKey, [worktree]);
      }
    }
    return next;
  }, [sidebarWorktrees, physicalToLogicalKey, projectPhysicalKeyByScopedRef]);
  const getCurrentSidebarShortcutContext = useCallback(
    () => ({
      terminalFocus: isTerminalFocused(),
      terminalOpen: routeThreadRef
        ? selectThreadTerminalState(
            useTerminalStateStore.getState().terminalStateByThreadKey,
            routeThreadRef,
          ).terminalOpen
        : false,
      modelPickerOpen,
    }),
    [modelPickerOpen, routeThreadRef],
  );
  const newThreadShortcutLabelOptions = useMemo(
    () => ({
      platform,
      context: {
        terminalFocus: false,
        terminalOpen: false,
      },
    }),
    [platform],
  );
  const newThreadShortcutLabel =
    shortcutLabelForCommand(keybindings, "chat.newLocal", newThreadShortcutLabelOptions) ??
    shortcutLabelForCommand(keybindings, "chat.new", newThreadShortcutLabelOptions);

  const navigateToThread = useCallback(
    (threadRef: ScopedThreadRef) => {
      if (useThreadSelectionStore.getState().selectedThreadKeys.size > 0) {
        clearSelection();
      }
      setSelectionAnchor(scopedThreadKey(threadRef));
      if (isMobile) {
        setOpenMobile(false);
      }
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(threadRef),
      });
    },
    [clearSelection, isMobile, navigate, setOpenMobile, setSelectionAnchor],
  );

  const projectDnDSensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );
  const projectCollisionDetection = useCallback<CollisionDetection>((args) => {
    const pointerCollisions = pointerWithin(args);
    if (pointerCollisions.length > 0) {
      return pointerCollisions;
    }

    return closestCorners(args);
  }, []);

  const visibleThreads = useMemo(
    () => sidebarThreads.filter((thread) => thread.archivedAt === null),
    [sidebarThreads],
  );
  const sortedProjects = useMemo(() => {
    const sortableProjects = sidebarProjects.map((project) => ({
      ...project,
      id: project.projectKey,
    }));
    const sortableThreads = visibleThreads.map((thread) => {
      const physicalKey =
        projectPhysicalKeyByScopedRef.get(
          scopedProjectKey(scopeProjectRef(thread.environmentId, thread.projectId)),
        ) ?? scopedProjectKey(scopeProjectRef(thread.environmentId, thread.projectId));
      return {
        ...thread,
        projectId: (physicalToLogicalKey.get(physicalKey) ?? physicalKey) as ProjectId,
      };
    });
    return sortProjectsForSidebar(
      sortableProjects,
      sortableThreads,
      sidebarProjectSortOrder,
    ).flatMap((project) => {
      const resolvedProject = sidebarProjectByKey.get(project.id);
      return resolvedProject ? [resolvedProject] : [];
    });
  }, [
    sidebarProjectSortOrder,
    physicalToLogicalKey,
    projectPhysicalKeyByScopedRef,
    sidebarProjectByKey,
    sidebarProjects,
    visibleThreads,
  ]);
  const projectTreeRows = useMemo(
    () =>
      buildSidebarProjectFolderTree({
        projects: sortedProjects,
        projectFoldersById,
        projectFolderOrder,
        projectTreeOrder,
        projectSortOrder: sidebarProjectSortOrder,
      }),
    [
      projectFolderOrder,
      projectFoldersById,
      projectTreeOrder,
      sidebarProjectSortOrder,
      sortedProjects,
    ],
  );
  const projectTreeRowByItemId = useMemo(
    () => new Map(projectTreeRows.map((row) => [row.itemId, row] as const)),
    [projectTreeRows],
  );
  const folderIdByProjectTreeItemId = useMemo(() => {
    const next = new Map<string, string | null>();
    for (const row of projectTreeRows) {
      if (row.kind === "project") {
        next.set(row.itemId, null);
        continue;
      }
      for (const project of row.projects) {
        next.set(projectTreeItemId(project.projectKey), row.folder.id);
      }
    }
    return next;
  }, [projectTreeRows]);
  const isManualProjectSorting = sidebarProjectSortOrder === "manual";
  const handleProjectDragEnd = useCallback(
    (event: DragEndEvent) => {
      dragInProgressRef.current = false;
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const activeId = String(active.id);
      const overId = String(over.id);
      const activeParsed = parseProjectTreeItemId(activeId);

      if (activeParsed?.kind === "folder") {
        const overParsed = parseProjectTreeItemId(overId);
        if (isManualProjectSorting && overParsed) {
          reorderProjectTreeItem(activeId as UiProjectTreeItemId, overId as UiProjectTreeItemId);
        }
        return;
      }

      if (activeParsed?.kind !== "project") {
        return;
      }
      const activeProject = sidebarProjectByKey.get(activeParsed.projectKey);
      if (!activeProject) return;
      const activeMemberKeys = activeProject.memberProjects.map(
        (member) => member.physicalProjectKey,
      );

      if (overId === PROJECT_ROOT_DROP_ID) {
        moveProjectsToRoot(activeMemberKeys);
        return;
      }

      const overParsed = parseProjectTreeItemId(overId);
      if (!overParsed) {
        return;
      }

      if (overParsed.kind === "folder") {
        moveProjectsToFolder(activeMemberKeys, overParsed.folderId);
        return;
      }

      const overProject = sidebarProjectByKey.get(overParsed.projectKey);
      if (!overProject) return;
      const overMemberKeys = overProject.memberProjects.map((member) => member.physicalProjectKey);
      const activeFolderId = folderIdByProjectTreeItemId.get(activeId) ?? null;
      const overFolderId = folderIdByProjectTreeItemId.get(overId) ?? null;

      if (overFolderId) {
        const folderRow = projectTreeRowByItemId.get(projectFolderTreeItemId(overFolderId));
        const targetIndex =
          folderRow?.kind === "folder"
            ? folderRow.projects.findIndex(
                (project) => project.projectKey === overParsed.projectKey,
              )
            : undefined;
        if (activeFolderId !== overFolderId || isManualProjectSorting) {
          moveProjectsToFolder(
            activeMemberKeys,
            overFolderId,
            targetIndex !== undefined && targetIndex >= 0 ? targetIndex : undefined,
          );
        }
        return;
      }

      if (activeFolderId) {
        const targetIndex = projectTreeRows.findIndex((row) => row.itemId === overId);
        moveProjectsToRoot(activeMemberKeys, targetIndex >= 0 ? targetIndex : undefined);
        return;
      }

      if (isManualProjectSorting) {
        reorderProjectTreeItem(activeId as UiProjectTreeItemId, overId as UiProjectTreeItemId);
        reorderProjects(activeMemberKeys, overMemberKeys);
      }
    },
    [
      dragInProgressRef,
      folderIdByProjectTreeItemId,
      isManualProjectSorting,
      moveProjectsToFolder,
      moveProjectsToRoot,
      projectTreeRowByItemId,
      projectTreeRows,
      reorderProjectTreeItem,
      reorderProjects,
      sidebarProjectByKey,
    ],
  );

  const handleProjectDragStart = useCallback(
    (_event: DragStartEvent) => {
      dragInProgressRef.current = true;
      suppressProjectClickAfterDragRef.current = true;
    },
    [dragInProgressRef, suppressProjectClickAfterDragRef],
  );

  const handleProjectDragCancel = useCallback((_event: DragCancelEvent) => {
    dragInProgressRef.current = false;
  }, []);

  const visibleSidebarThreadKeys = useMemo(
    () =>
      projectTreeRows.flatMap((row) => {
        const projectsForRow =
          row.kind === "project" ? [row.project] : row.folder.expanded ? row.projects : [];
        return projectsForRow.flatMap((project) => {
          const projectThreads = sortThreads(
            threadsByProjectKey.get(project.projectKey) ?? [],
            sidebarThreadSortOrder,
          );
          const projectExpanded = projectExpandedById[project.projectKey] ?? true;
          const activeThreadKey = routeThreadKey ?? undefined;
          const pinnedCollapsedThreadKey =
            !projectExpanded && activeThreadKey
              ? projectThreads
                  .filter((thread) => thread.archivedAt === null)
                  .find(
                    (thread) =>
                      scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)) ===
                      activeThreadKey,
                  )
                ? activeThreadKey
                : null
              : null;
          if (!projectExpanded && !pinnedCollapsedThreadKey) {
            return [];
          }

          const treeInput = adaptProjectForSidebarTree({
            project,
            threads: projectThreads,
            worktrees: worktreesByProjectKey.get(project.projectKey) ?? [],
          });
          const treeProject = composeSidebarTree({
            nowMs: 0,
            projects: [treeInput.project],
            threads: treeInput.threads,
            worktrees: treeInput.worktrees,
          }).projects[0];
          if (!treeProject) {
            return [];
          }

          return treeProject.worktrees.flatMap((worktree) =>
            worktree.sessions
              .filter((thread) => thread.archivedAt === null)
              .map((thread) => scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)))
              .filter((threadKey) => projectExpanded || threadKey === pinnedCollapsedThreadKey),
          );
        });
      }),
    [
      sidebarThreadSortOrder,
      projectExpandedById,
      projectTreeRows,
      routeThreadKey,
      threadsByProjectKey,
      worktreesByProjectKey,
    ],
  );
  const prefersReducedMotion = useMediaQuery(PREFERS_REDUCED_MOTION_QUERY);
  const shouldAnimateProjectLists = shouldEnableAutoAnimate({
    prefersReducedMotion,
    withinThreshold: shouldAutoAnimateSidebarProjectList(sortedProjects.length),
  });
  const shouldAnimateThreadLists = shouldEnableAutoAnimate({
    prefersReducedMotion,
    withinThreshold: shouldAutoAnimateSidebarThreadLists({
      projectCount: sortedProjects.length,
      visibleThreadCount: visibleSidebarThreadKeys.length,
    }),
  });
  const projectListAnimationControllersRef = useRef<SidebarAutoAnimateControllers>(new Map());
  const attachProjectListAutoAnimateRef = useCallback(
    (node: HTMLElement | null) => {
      attachSidebarAutoAnimateNode(
        projectListAnimationControllersRef.current,
        node,
        shouldAnimateProjectLists,
      );
    },
    [shouldAnimateProjectLists],
  );
  useEffect(() => {
    setSidebarAutoAnimateControllersEnabled(
      projectListAnimationControllersRef.current,
      shouldAnimateProjectLists,
    );
  }, [shouldAnimateProjectLists]);

  const threadListAnimationControllersRef = useRef<SidebarAutoAnimateControllers>(new Map());
  const attachThreadListAutoAnimateRef = useCallback(
    (node: HTMLElement | null) => {
      attachSidebarAutoAnimateNode(
        threadListAnimationControllersRef.current,
        node,
        shouldAnimateThreadLists,
      );
    },
    [shouldAnimateThreadLists],
  );
  useEffect(() => {
    setSidebarAutoAnimateControllersEnabled(
      threadListAnimationControllersRef.current,
      shouldAnimateThreadLists,
    );
  }, [shouldAnimateThreadLists]);
  const threadJumpCommandByKey = useMemo(() => {
    const mapping = new Map<string, NonNullable<ReturnType<typeof threadJumpCommandForIndex>>>();
    for (const [visibleThreadIndex, threadKey] of visibleSidebarThreadKeys.entries()) {
      const jumpCommand = threadJumpCommandForIndex(visibleThreadIndex);
      if (!jumpCommand) {
        return mapping;
      }
      mapping.set(threadKey, jumpCommand);
    }

    return mapping;
  }, [visibleSidebarThreadKeys]);
  const threadJumpThreadKeys = useMemo(
    () => [...threadJumpCommandByKey.keys()],
    [threadJumpCommandByKey],
  );
  const sidebarShortcutContext = useMemo(
    () => ({
      terminalFocus: false,
      terminalOpen: routeThreadRef
        ? selectThreadTerminalState(
            useTerminalStateStore.getState().terminalStateByThreadKey,
            routeThreadRef,
          ).terminalOpen
        : false,
      modelPickerOpen,
    }),
    [modelPickerOpen, routeThreadRef],
  );
  const threadJumpLabelByKey = useMemo(
    () =>
      buildThreadJumpLabelMap({
        keybindings,
        platform,
        terminalOpen: sidebarShortcutContext.terminalOpen,
        threadJumpCommandByKey,
      }),
    [keybindings, platform, sidebarShortcutContext.terminalOpen, threadJumpCommandByKey],
  );
  const shouldShowThreadJumpHintsNow =
    !hasOpenDialogShortcutTarget() &&
    shouldShowThreadJumpHintsForModifiers(shortcutModifiers, keybindings, {
      platform,
      context: sidebarShortcutContext,
    });
  const visibleThreadJumpLabelByKey = showThreadJumpHints
    ? threadJumpLabelByKey
    : EMPTY_THREAD_JUMP_LABELS;
  const orderedSidebarThreadKeys = visibleSidebarThreadKeys;
  const prewarmedSidebarThreadKeys = useMemo(
    () => getSidebarThreadIdsToPrewarm(visibleSidebarThreadKeys),
    [visibleSidebarThreadKeys],
  );
  const prewarmedSidebarThreadRefs = useMemo(
    () =>
      prewarmedSidebarThreadKeys.flatMap((threadKey) => {
        const ref = parseScopedThreadKey(threadKey);
        return ref ? [ref] : [];
      }),
    [prewarmedSidebarThreadKeys],
  );

  useEffect(() => {
    const releases = prewarmedSidebarThreadRefs.map((ref) =>
      retainThreadDetailSubscription(ref.environmentId, ref.threadId),
    );

    return () => {
      for (const release of releases) {
        release();
      }
    };
  }, [prewarmedSidebarThreadRefs]);

  useEffect(() => {
    updateThreadJumpHintsVisibility(shouldShowThreadJumpHintsNow);
  }, [shouldShowThreadJumpHintsNow, updateThreadJumpHintsVisibility]);

  useEffect(() => {
    const onWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      const shortcutContext = getCurrentSidebarShortcutContext();

      if (event.defaultPrevented || event.repeat) {
        return;
      }
      if (shouldIgnoreGlobalNavigationShortcut(event)) {
        return;
      }

      const command = resolveShortcutCommand(event, keybindings, {
        platform,
        context: shortcutContext,
      });
      const traversalDirection = threadTraversalDirectionFromCommand(command);
      if (traversalDirection !== null) {
        const targetThreadKey = resolveAdjacentThreadId({
          threadIds: orderedSidebarThreadKeys,
          currentThreadId: routeThreadKey,
          direction: traversalDirection,
        });
        if (!targetThreadKey) {
          return;
        }
        const targetThread = sidebarThreadByKey.get(targetThreadKey);
        if (!targetThread) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        navigateToThread(scopeThreadRef(targetThread.environmentId, targetThread.id));
        return;
      }

      const jumpIndex = threadJumpIndexFromCommand(command ?? "");
      if (jumpIndex === null) {
        return;
      }

      const targetThreadKey = threadJumpThreadKeys[jumpIndex];
      if (!targetThreadKey) {
        return;
      }
      const targetThread = sidebarThreadByKey.get(targetThreadKey);
      if (!targetThread) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      navigateToThread(scopeThreadRef(targetThread.environmentId, targetThread.id));
    };

    window.addEventListener("keydown", onWindowKeyDown);

    return () => {
      window.removeEventListener("keydown", onWindowKeyDown);
    };
  }, [
    getCurrentSidebarShortcutContext,
    keybindings,
    navigateToThread,
    orderedSidebarThreadKeys,
    platform,
    routeThreadKey,
    sidebarThreadByKey,
    threadJumpThreadKeys,
  ]);

  useEffect(() => {
    const onMouseDown = (event: globalThis.MouseEvent) => {
      if (selectedThreadCount === 0) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (!shouldClearThreadSelectionOnMouseDown(target)) return;
      clearSelection();
    };

    window.addEventListener("mousedown", onMouseDown);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
    };
  }, [clearSelection, selectedThreadCount]);

  useEffect(() => {
    if (!isElectron) return;
    const bridge = window.desktopBridge;
    if (
      !bridge ||
      typeof bridge.getUpdateState !== "function" ||
      typeof bridge.onUpdateState !== "function"
    ) {
      return;
    }

    let disposed = false;
    let receivedSubscriptionUpdate = false;
    const unsubscribe = bridge.onUpdateState((nextState) => {
      if (disposed) return;
      receivedSubscriptionUpdate = true;
      setDesktopUpdateState(nextState);
    });

    void bridge
      .getUpdateState()
      .then((nextState) => {
        if (disposed || receivedSubscriptionUpdate) return;
        setDesktopUpdateState(nextState);
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  const desktopUpdateButtonDisabled = isDesktopUpdateButtonDisabled(desktopUpdateState);
  const desktopUpdateButtonAction = desktopUpdateState
    ? resolveDesktopUpdateButtonAction(desktopUpdateState)
    : "none";
  const showArm64IntelBuildWarning =
    isElectron && shouldShowArm64IntelBuildWarning(desktopUpdateState);
  const arm64IntelBuildWarningDescription =
    desktopUpdateState && showArm64IntelBuildWarning
      ? getArm64IntelBuildWarningDescription(desktopUpdateState)
      : null;
  const commandPaletteShortcutLabel = shortcutLabelForCommand(
    keybindings,
    "commandPalette.toggle",
    newThreadShortcutLabelOptions,
  );
  const handleDesktopUpdateButtonClick = useCallback(() => {
    const bridge = window.desktopBridge;
    if (!bridge || !desktopUpdateState) return;
    if (desktopUpdateButtonDisabled || desktopUpdateButtonAction === "none") return;

    if (desktopUpdateButtonAction === "download") {
      void bridge
        .downloadUpdate()
        .then((result) => {
          if (result.completed) {
            toastManager.add({
              type: "success",
              title: "Update downloaded",
              description: "Restart the app from the update button to install it.",
            });
          }
          if (!shouldToastDesktopUpdateActionResult(result)) return;
          const actionError = getDesktopUpdateActionError(result);
          if (!actionError) return;
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Could not download update",
              description: actionError,
            }),
          );
        })
        .catch((error) => {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Could not start update download",
              description: error instanceof Error ? error.message : "An unexpected error occurred.",
            }),
          );
        });
      return;
    }

    if (desktopUpdateButtonAction === "install") {
      const confirmed = window.confirm(
        getDesktopUpdateInstallConfirmationMessage(desktopUpdateState),
      );
      if (!confirmed) return;
      void bridge
        .installUpdate()
        .then((result) => {
          if (!shouldToastDesktopUpdateActionResult(result)) return;
          const actionError = getDesktopUpdateActionError(result);
          if (!actionError) return;
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Could not install update",
              description: actionError,
            }),
          );
        })
        .catch((error) => {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Could not install update",
              description: error instanceof Error ? error.message : "An unexpected error occurred.",
            }),
          );
        });
    }
  }, [desktopUpdateButtonAction, desktopUpdateButtonDisabled, desktopUpdateState]);

  const expandThreadListForProject = useCallback((projectKey: string) => {
    setExpandedThreadListsByProject((current) => {
      if (current.has(projectKey)) return current;
      const next = new Set(current);
      next.add(projectKey);
      return next;
    });
  }, []);

  const collapseThreadListForProject = useCallback((projectKey: string) => {
    setExpandedThreadListsByProject((current) => {
      if (!current.has(projectKey)) return current;
      const next = new Set(current);
      next.delete(projectKey);
      return next;
    });
  }, []);

  return (
    <>
      <SidebarChromeHeader isElectron={isElectron} />

      <SidebarProjectsContent
        showArm64IntelBuildWarning={showArm64IntelBuildWarning}
        arm64IntelBuildWarningDescription={arm64IntelBuildWarningDescription}
        desktopUpdateButtonAction={desktopUpdateButtonAction}
        desktopUpdateButtonDisabled={desktopUpdateButtonDisabled}
        handleDesktopUpdateButtonClick={handleDesktopUpdateButtonClick}
        projectSortOrder={sidebarProjectSortOrder}
        threadSortOrder={sidebarThreadSortOrder}
        projectGroupingMode={sidebarProjectGroupingMode}
        updateSettings={updateSettings}
        openAddProject={openAddProjectCommandPalette}
        isManualProjectSorting={isManualProjectSorting}
        projectDnDSensors={projectDnDSensors}
        projectCollisionDetection={projectCollisionDetection}
        handleProjectDragStart={handleProjectDragStart}
        handleProjectDragEnd={handleProjectDragEnd}
        handleProjectDragCancel={handleProjectDragCancel}
        projectTreeRows={projectTreeRows}
        commandPaletteShortcutLabel={commandPaletteShortcutLabel}
        attachProjectListAutoAnimateRef={attachProjectListAutoAnimateRef}
        projectsLength={projects.length}
        renderProjectRow={(project, dragHandleProps, onNewFolderWithProject) => (
          <SidebarProjectItem
            project={project}
            isThreadListExpanded={expandedThreadListsByProject.has(project.projectKey)}
            activeRouteThreadKey={
              activeRouteProjectKey === project.projectKey ? activeRouteThreadKey : null
            }
            newThreadShortcutLabel={newThreadShortcutLabel}
            handleNewThread={handleNewThread}
            archiveThread={archiveThread}
            deleteThread={deleteThread}
            threadJumpLabelByKey={visibleThreadJumpLabelByKey}
            attachThreadListAutoAnimateRef={attachThreadListAutoAnimateRef}
            expandThreadListForProject={expandThreadListForProject}
            collapseThreadListForProject={collapseThreadListForProject}
            onNewFolderWithProject={onNewFolderWithProject}
            dragInProgressRef={dragInProgressRef}
            suppressProjectClickAfterDragRef={suppressProjectClickAfterDragRef}
            suppressProjectClickForContextMenuRef={suppressProjectClickForContextMenuRef}
            isManualProjectSorting={isManualProjectSorting}
            dragHandleProps={dragHandleProps}
          />
        )}
      />

      <SidebarSeparator />
      <SidebarChromeFooter />
    </>
  );
}
