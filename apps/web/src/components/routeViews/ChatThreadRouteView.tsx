import type { ScopedThreadRef } from "@ryco/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";

import ChatView from "../ChatView";
import { threadHasStarted } from "../ChatView.logic";
import { LazyRightPanel, RightPanelInlineSidebar, closeRightPanelSearch } from "../ChatRightPanel";
import { finalizePromotedDraftThreadByRef, useComposerDraftStore } from "../../composerDraftStore";
import { buildOpenDiffSearch } from "../../diffRouteSearch";
import { buildOpenPreviewSearch } from "../../previewRouteSearch";
import {
  getRightPanelMode,
  type RightPanelMode,
  type RightPanelRouteSearch,
} from "../../rightPanelRouteSearch";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useSettings } from "../../hooks/useSettings";
import { sortThreads } from "../../lib/threadSort";
import { RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY } from "../../rightPanelLayout";
import { selectEnvironmentState, selectThreadExistsByRef, useStore } from "../../store";
import { createThreadSelectorByRef } from "../../storeSelectors";
import { getThreadFromEnvironmentState } from "../../threadDerivation";
import { buildThreadRouteParams } from "../../threadRoutes";
import { RightPanelSheet } from "../RightPanelSheet";
import { SidebarInset } from "~/components/ui/sidebar";

export function ChatThreadRouteView({
  threadRef,
  search,
}: {
  threadRef: ScopedThreadRef | null;
  search: RightPanelRouteSearch;
}) {
  const navigate = useNavigate();
  const bootstrapComplete = useStore(
    (store) => selectEnvironmentState(store, threadRef?.environmentId ?? null).bootstrapComplete,
  );
  const serverThread = useStore(useMemo(() => createThreadSelectorByRef(threadRef), [threadRef]));
  const threadExists = useStore((store) => selectThreadExistsByRef(store, threadRef));
  const environmentState = useStore((store) =>
    selectEnvironmentState(store, threadRef?.environmentId ?? null),
  );
  const environmentHasServerThreads = environmentState.threadIds.length > 0;
  const environmentThreads = useMemo(
    () =>
      environmentState.threadIds.flatMap((threadId) => {
        const thread = getThreadFromEnvironmentState(environmentState, threadId);
        return thread ? [thread] : [];
      }),
    [environmentState],
  );
  const sidebarThreadSortOrder = useSettings((settings) => settings.sidebarThreadSortOrder);
  const draftThreadExists = useComposerDraftStore((store) =>
    threadRef ? store.getDraftThreadByRef(threadRef) !== null : false,
  );
  const draftThread = useComposerDraftStore((store) =>
    threadRef ? store.getDraftThreadByRef(threadRef) : null,
  );
  const environmentHasDraftThreads = useComposerDraftStore((store) => {
    if (!threadRef) {
      return false;
    }
    return store.hasDraftThreadsInEnvironment(threadRef.environmentId);
  });
  const routeThreadExists = threadExists || draftThreadExists;
  const serverThreadStarted = threadHasStarted(serverThread);
  const environmentHasAnyThreads = environmentHasServerThreads || environmentHasDraftThreads;
  const diffOpen = search.diff === "1";
  const previewOpen = search.preview === "1";
  const rightPanelMode: RightPanelMode | null = getRightPanelMode(search);
  const rightPanelOpen = rightPanelMode !== null;
  const shouldUseDiffSheet = useMediaQuery(RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY);
  const currentThreadKey = threadRef ? `${threadRef.environmentId}:${threadRef.threadId}` : null;
  const [diffPanelMountState, setDiffPanelMountState] = useState(() => ({
    threadKey: currentThreadKey,
    hasOpenedDiff: diffOpen,
    hasOpenedPreview: previewOpen,
  }));
  const hasOpenedDiff =
    diffPanelMountState.threadKey === currentThreadKey
      ? diffPanelMountState.hasOpenedDiff
      : diffOpen;
  const hasOpenedPreview =
    diffPanelMountState.threadKey === currentThreadKey
      ? diffPanelMountState.hasOpenedPreview
      : previewOpen;
  const [lastOpenedRightPanelMode, setLastOpenedRightPanelMode] = useState<RightPanelMode>(
    () => rightPanelMode ?? "diff",
  );
  const markRightPanelOpened = useCallback(
    (panelMode: RightPanelMode) => {
      setLastOpenedRightPanelMode(panelMode);
      setDiffPanelMountState((previous) => {
        const nextState = {
          threadKey: currentThreadKey,
          hasOpenedDiff:
            (previous.threadKey === currentThreadKey ? previous.hasOpenedDiff : diffOpen) ||
            panelMode === "diff",
          hasOpenedPreview:
            (previous.threadKey === currentThreadKey ? previous.hasOpenedPreview : previewOpen) ||
            panelMode === "preview",
        };
        if (
          previous.threadKey === nextState.threadKey &&
          previous.hasOpenedDiff === nextState.hasOpenedDiff &&
          previous.hasOpenedPreview === nextState.hasOpenedPreview
        ) {
          return previous;
        }
        return nextState;
      });
    },
    [currentThreadKey, diffOpen, previewOpen],
  );
  const closeRightPanel = useCallback(() => {
    if (!threadRef) {
      return;
    }
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(threadRef),
      search: (previous) => closeRightPanelSearch(previous),
    });
  }, [navigate, threadRef]);
  const openDiff = useCallback(() => {
    if (!threadRef) {
      return;
    }
    markRightPanelOpened("diff");
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(threadRef),
      search: (previous) => buildOpenDiffSearch(previous),
    });
  }, [markRightPanelOpened, navigate, threadRef]);
  const openPreview = useCallback(() => {
    if (!threadRef) {
      return;
    }
    markRightPanelOpened("preview");
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(threadRef),
      search: (previous) => buildOpenPreviewSearch(previous),
    });
  }, [markRightPanelOpened, navigate, threadRef]);
  const openRightPanel = useCallback(() => {
    if (lastOpenedRightPanelMode === "preview") {
      openPreview();
      return;
    }
    openDiff();
  }, [lastOpenedRightPanelMode, openDiff, openPreview]);

  useEffect(() => {
    if (rightPanelMode !== null) {
      setLastOpenedRightPanelMode(rightPanelMode);
    }
  }, [rightPanelMode]);

  useEffect(() => {
    if (!threadRef || !bootstrapComplete) {
      return;
    }

    if (!routeThreadExists && environmentHasAnyThreads) {
      const fallbackThread = sortThreads(environmentThreads, sidebarThreadSortOrder)[0];
      if (fallbackThread) {
        void navigate({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams({
            environmentId: fallbackThread.environmentId,
            threadId: fallbackThread.id,
          }),
          replace: true,
        });
      } else {
        void navigate({ to: "/", replace: true });
      }
    }
  }, [
    bootstrapComplete,
    environmentHasAnyThreads,
    environmentThreads,
    navigate,
    routeThreadExists,
    sidebarThreadSortOrder,
    threadRef,
  ]);

  useEffect(() => {
    if (!threadRef || !serverThreadStarted || !draftThread?.promotedTo) {
      return;
    }
    finalizePromotedDraftThreadByRef(threadRef);
  }, [draftThread?.promotedTo, serverThreadStarted, threadRef]);

  if (!threadRef || !bootstrapComplete || !routeThreadExists) {
    return null;
  }

  const shouldRenderRightPanelContent =
    rightPanelMode === "diff" || hasOpenedDiff || rightPanelMode === "preview" || hasOpenedPreview;
  const mountedRightPanelMode: RightPanelMode = rightPanelMode ?? lastOpenedRightPanelMode;

  if (!shouldUseDiffSheet) {
    return (
      <>
        <SidebarInset className="h-svh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground md:h-dvh">
          <ChatView
            environmentId={threadRef.environmentId}
            threadId={threadRef.threadId}
            onDiffPanelOpen={() => markRightPanelOpened("diff")}
            onPreviewPanelOpen={() => markRightPanelOpened("preview")}
            reserveTitleBarControlInset={!rightPanelOpen}
            routeKind="server"
          />
        </SidebarInset>
        <RightPanelInlineSidebar
          open={rightPanelOpen}
          panelMode={mountedRightPanelMode}
          onClose={closeRightPanel}
          onOpen={openRightPanel}
          renderContent={shouldRenderRightPanelContent}
        />
      </>
    );
  }

  return (
    <>
      <SidebarInset className="h-svh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground md:h-dvh">
        <ChatView
          environmentId={threadRef.environmentId}
          threadId={threadRef.threadId}
          onDiffPanelOpen={() => markRightPanelOpened("diff")}
          onPreviewPanelOpen={() => markRightPanelOpened("preview")}
          routeKind="server"
        />
      </SidebarInset>
      <RightPanelSheet open={rightPanelOpen} onClose={closeRightPanel}>
        {shouldRenderRightPanelContent ? (
          <LazyRightPanel mode="sheet" panelMode={mountedRightPanelMode} />
        ) : null}
      </RightPanelSheet>
    </>
  );
}
