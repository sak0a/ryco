import { useMemo } from "react";
import { scopedThreadKey, scopeThreadRef } from "@ryco/client-runtime/scoped";
import { type SidebarThreadSortOrder } from "@ryco/contracts/settings";
import {
  resolveProjectStatusIndicator,
  resolveThreadStatusPill,
  sortThreadsWithPinned,
} from "../../Sidebar.logic";
import { adaptProjectForSidebarTree } from "../sidebarTreeAdapters";
import { useSidebarTree } from "./useSidebarTree";
import type { SidebarThreadSummary, SidebarWorktreeSummary } from "../../../types";
import type { SidebarProjectSnapshot } from "../../../sidebarProjectGrouping";
import { useUiStateStore } from "../../../uiStateStore";

const THREAD_PREVIEW_LIMIT = 6;

export function useSidebarProjectThreadPresentation(params: {
  project: SidebarProjectSnapshot;
  projectThreads: ReadonlyArray<SidebarThreadSummary>;
  sidebarWorktrees: ReadonlyArray<SidebarWorktreeSummary>;
  lastVisitedAtByThreadKey: ReadonlyMap<string, string | null>;
  threadSortOrder: SidebarThreadSortOrder;
  activeRouteThreadKey: string | null;
  projectExpanded: boolean;
  isThreadListExpanded: boolean;
}) {
  const {
    project,
    projectThreads,
    sidebarWorktrees,
    lastVisitedAtByThreadKey,
    threadSortOrder,
    activeRouteThreadKey,
    projectExpanded,
    isThreadListExpanded,
  } = params;
  const pinnedThreadKeysRecord = useUiStateStore((state) => state.pinnedThreadKeys);
  const pinnedThreadKeys = useMemo(
    () =>
      new Set(
        Object.entries(pinnedThreadKeysRecord).flatMap(([threadKey, pinned]) =>
          pinned ? [threadKey] : [],
        ),
      ),
    [pinnedThreadKeysRecord],
  );

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
    const visibleProjectThreads = sortThreadsWithPinned({
      threads: projectThreads.filter((thread) => thread.archivedAt === null),
      sortOrder: threadSortOrder,
      pinnedThreadKeys,
      getThreadKey: (thread) => scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
    });
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
  }, [lastVisitedAtByThreadKey, pinnedThreadKeys, projectThreads, threadSortOrder]);

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
      threads: sortThreadsWithPinned({
        threads: projectThreads,
        sortOrder: threadSortOrder,
        pinnedThreadKeys,
        getThreadKey: (thread) => scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
      }),
      worktrees: sidebarWorktrees,
    });
  }, [
    lastVisitedAtByThreadKey,
    pinnedThreadKeys,
    project,
    projectThreads,
    sidebarWorktrees,
    threadSortOrder,
  ]);
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

  return {
    projectStatus,
    orderedProjectThreadKeys,
    hasOverflowingThreads,
    hiddenThreadStatus,
    renderedThreads,
    showEmptyThreadState,
    shouldShowThreadPanel,
    treeProject,
    visibleTreeThreadKeys,
  };
}
