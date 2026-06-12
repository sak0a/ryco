import type { ScopedThreadRef } from "@ryco/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";

import { finalizePromotedDraftThreadByRef, useComposerDraftStore } from "../../composerDraftStore";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useSettings } from "../../hooks/useSettings";
import { usePerfMark } from "../../perf/tabSwitchInstrumentation";
import { RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY } from "../../rightPanelLayout";
import {
  getRightPanelMode,
  isRightPanelOpen,
  type RightPanelMode,
  type RightPanelRouteSearch,
} from "../../rightPanelRouteSearch";
import { selectEnvironmentState, selectThreadExistsByRef, useStore } from "../../store";
import {
  createEnvironmentFallbackThreadRefSelector,
  createThreadSelectorByRef,
} from "../../storeSelectors";
import { buildThreadRouteParams } from "../../threadRoutes";
import {
  buildOpenFilesSearch,
  buildOpenReviewSearch,
  buildOpenTerminalSearch,
  buildOpenWorkspaceSearch,
} from "../../workspaceRouteSearch";
import ChatView from "../ChatView";
import { threadHasStarted } from "../ChatView.logic";
import { LazyRightPanel, RightPanelInlineSidebar, closeRightPanelSearch } from "../ChatRightPanel";
import { RightPanelSheet } from "../RightPanelSheet";
import { SidebarInset } from "~/components/ui/sidebar";

export function ChatThreadRouteView({
  threadRef,
  search,
}: {
  threadRef: ScopedThreadRef | null;
  search: RightPanelRouteSearch;
}) {
  usePerfMark("ChatThreadRouteView");
  const navigate = useNavigate();
  const bootstrapComplete = useStore(
    (store) => selectEnvironmentState(store, threadRef?.environmentId ?? null).bootstrapComplete,
  );
  const serverThread = useStore(useMemo(() => createThreadSelectorByRef(threadRef), [threadRef]));
  const threadExists = useStore((store) => selectThreadExistsByRef(store, threadRef));
  const environmentHasServerThreads = useStore(
    (store) => selectEnvironmentState(store, threadRef?.environmentId ?? null).threadIds.length > 0,
  );
  const sidebarThreadSortOrder = useSettings((settings) => settings.sidebarThreadSortOrder);
  const fallbackThreadRef = useStore(
    useMemo(
      () =>
        createEnvironmentFallbackThreadRefSelector(
          threadRef?.environmentId ?? null,
          sidebarThreadSortOrder,
        ),
      [sidebarThreadSortOrder, threadRef?.environmentId],
    ),
  );
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
  const rightPanelOpen = isRightPanelOpen(search);
  const shouldUseDiffSheet = useMediaQuery(RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY);
  const currentThreadKey = threadRef ? `${threadRef.environmentId}:${threadRef.threadId}` : null;
  const [diffPanelMountState, setDiffPanelMountState] = useState(() => ({
    threadKey: currentThreadKey,
    hasOpenedDiff: diffOpen,
    hasOpenedPreview: previewOpen,
    hasOpenedTerminal: rightPanelMode === "terminal",
  }));
  const hasOpenedDiff =
    diffPanelMountState.threadKey === currentThreadKey
      ? diffPanelMountState.hasOpenedDiff
      : diffOpen;
  const hasOpenedPreview =
    diffPanelMountState.threadKey === currentThreadKey
      ? diffPanelMountState.hasOpenedPreview
      : previewOpen;
  const hasOpenedTerminal =
    diffPanelMountState.threadKey === currentThreadKey
      ? diffPanelMountState.hasOpenedTerminal
      : rightPanelMode === "terminal";
  const [lastOpenedRightPanelMode, setLastOpenedRightPanelMode] = useState<RightPanelMode>(
    () => rightPanelMode ?? "review",
  );
  const openedPanelModes = useMemo(() => {
    const modes: RightPanelMode[] = [];
    if (hasOpenedPreview || rightPanelMode === "files") {
      modes.push("files");
    }
    if (hasOpenedDiff || rightPanelMode === "review") {
      modes.push("review");
    }
    if (hasOpenedTerminal || rightPanelMode === "terminal") {
      modes.push("terminal");
    }
    return modes;
  }, [hasOpenedDiff, hasOpenedPreview, hasOpenedTerminal, rightPanelMode]);
  const markRightPanelOpened = useCallback(
    (panelMode: RightPanelMode) => {
      setLastOpenedRightPanelMode(panelMode);
      setDiffPanelMountState((previous) => {
        const nextState = {
          threadKey: currentThreadKey,
          hasOpenedDiff:
            (previous.threadKey === currentThreadKey ? previous.hasOpenedDiff : diffOpen) ||
            panelMode === "review",
          hasOpenedPreview:
            (previous.threadKey === currentThreadKey ? previous.hasOpenedPreview : previewOpen) ||
            panelMode === "files",
          hasOpenedTerminal:
            (previous.threadKey === currentThreadKey
              ? previous.hasOpenedTerminal
              : rightPanelMode === "terminal") || panelMode === "terminal",
        };
        if (
          previous.threadKey === nextState.threadKey &&
          previous.hasOpenedDiff === nextState.hasOpenedDiff &&
          previous.hasOpenedPreview === nextState.hasOpenedPreview &&
          previous.hasOpenedTerminal === nextState.hasOpenedTerminal
        ) {
          return previous;
        }
        return nextState;
      });
    },
    [currentThreadKey, diffOpen, previewOpen, rightPanelMode],
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
  const openRightPanel = useCallback(() => {
    if (!threadRef) {
      return;
    }
    const nextSearch = (previous: Record<string, unknown>) => {
      if (lastOpenedRightPanelMode === "files" && hasOpenedPreview) {
        return buildOpenFilesSearch(previous);
      }
      if (lastOpenedRightPanelMode === "review" && hasOpenedDiff) {
        return buildOpenReviewSearch(previous);
      }
      if (lastOpenedRightPanelMode === "terminal" && hasOpenedTerminal) {
        return buildOpenTerminalSearch(previous);
      }
      if (hasOpenedPreview) {
        return buildOpenFilesSearch(previous);
      }
      if (hasOpenedDiff) {
        return buildOpenReviewSearch(previous);
      }
      if (hasOpenedTerminal) {
        return buildOpenTerminalSearch(previous);
      }
      return buildOpenWorkspaceSearch(previous);
    };
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(threadRef),
      search: nextSearch,
    });
  }, [
    hasOpenedDiff,
    hasOpenedPreview,
    hasOpenedTerminal,
    lastOpenedRightPanelMode,
    navigate,
    threadRef,
  ]);
  const toggleRightPanel = useCallback(() => {
    if (rightPanelOpen) {
      closeRightPanel();
      return;
    }
    openRightPanel();
  }, [closeRightPanel, openRightPanel, rightPanelOpen]);
  const closePanelTab = useCallback(
    (input: { mode: RightPanelMode; agentKey?: string }) => {
      if (!threadRef) {
        return;
      }
      if (input.mode === "agent") {
        if (rightPanelMode === "agent") {
          void navigate({
            to: "/$environmentId/$threadId",
            params: buildThreadRouteParams(threadRef),
            search: (previous) => buildOpenWorkspaceSearch(previous),
          });
        }
        return;
      }

      const nextHasOpenedDiff =
        input.mode === "review" ? false : hasOpenedDiff || rightPanelMode === "review";
      const nextHasOpenedPreview =
        input.mode === "files" ? false : hasOpenedPreview || rightPanelMode === "files";
      const nextHasOpenedTerminal =
        input.mode === "terminal" ? false : hasOpenedTerminal || rightPanelMode === "terminal";
      setDiffPanelMountState((previous) => {
        const nextState = {
          threadKey: currentThreadKey,
          hasOpenedDiff: nextHasOpenedDiff,
          hasOpenedPreview: nextHasOpenedPreview,
          hasOpenedTerminal: nextHasOpenedTerminal,
        };
        if (
          previous.threadKey === nextState.threadKey &&
          previous.hasOpenedDiff === nextState.hasOpenedDiff &&
          previous.hasOpenedPreview === nextState.hasOpenedPreview &&
          previous.hasOpenedTerminal === nextState.hasOpenedTerminal
        ) {
          return previous;
        }
        return nextState;
      });

      if (rightPanelMode !== input.mode) {
        return;
      }

      const nextSearch = (previous: Record<string, unknown>) => {
        if (input.mode !== "files" && nextHasOpenedPreview) {
          return buildOpenFilesSearch(previous);
        }
        if (input.mode !== "review" && nextHasOpenedDiff) {
          return buildOpenReviewSearch(previous);
        }
        if (input.mode !== "terminal" && nextHasOpenedTerminal) {
          return buildOpenTerminalSearch(previous);
        }
        return buildOpenWorkspaceSearch(previous);
      };
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(threadRef),
        search: nextSearch,
      });
    },
    [
      currentThreadKey,
      hasOpenedDiff,
      hasOpenedPreview,
      hasOpenedTerminal,
      navigate,
      rightPanelMode,
      threadRef,
    ],
  );

  useEffect(() => {
    if (rightPanelMode !== null) {
      setLastOpenedRightPanelMode(rightPanelMode);
      markRightPanelOpened(rightPanelMode);
    }
  }, [markRightPanelOpened, rightPanelMode]);

  useEffect(() => {
    if (!threadRef || !bootstrapComplete) {
      return;
    }

    if (!routeThreadExists && environmentHasAnyThreads) {
      if (fallbackThreadRef) {
        void navigate({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(fallbackThreadRef),
          replace: true,
        });
      } else {
        void navigate({ to: "/", replace: true });
      }
    }
  }, [
    bootstrapComplete,
    environmentHasAnyThreads,
    fallbackThreadRef,
    navigate,
    routeThreadExists,
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
    rightPanelOpen ||
    rightPanelMode === "review" ||
    hasOpenedDiff ||
    rightPanelMode === "files" ||
    hasOpenedPreview ||
    rightPanelMode === "terminal" ||
    hasOpenedTerminal ||
    rightPanelMode === "agent";
  const mountedRightPanelMode: RightPanelMode | null = rightPanelOpen
    ? rightPanelMode
    : lastOpenedRightPanelMode;

  if (!shouldUseDiffSheet) {
    return (
      <>
        <SidebarInset className="h-svh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground md:h-dvh">
          <ChatView
            environmentId={threadRef.environmentId}
            threadId={threadRef.threadId}
            onDiffPanelOpen={() => markRightPanelOpened("review")}
            onPreviewPanelOpen={() => markRightPanelOpened("files")}
            onTerminalPanelOpen={() => markRightPanelOpened("terminal")}
            onAgentPanelOpen={() => markRightPanelOpened("agent")}
            workspacePanelOpen={rightPanelOpen}
            onToggleWorkspacePanel={toggleRightPanel}
            routeKind="server"
          />
        </SidebarInset>
        <RightPanelInlineSidebar
          open={rightPanelOpen}
          panelMode={mountedRightPanelMode}
          openedPanelModes={openedPanelModes}
          onClosePanelTab={closePanelTab}
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
          onDiffPanelOpen={() => markRightPanelOpened("review")}
          onPreviewPanelOpen={() => markRightPanelOpened("files")}
          onTerminalPanelOpen={() => markRightPanelOpened("terminal")}
          onAgentPanelOpen={() => markRightPanelOpened("agent")}
          workspacePanelOpen={rightPanelOpen}
          onToggleWorkspacePanel={toggleRightPanel}
          routeKind="server"
        />
      </SidebarInset>
      <RightPanelSheet open={rightPanelOpen} onClose={closeRightPanel}>
        {shouldRenderRightPanelContent ? (
          <LazyRightPanel
            mode="sheet"
            panelMode={mountedRightPanelMode}
            openedPanelModes={openedPanelModes}
            onClosePanelTab={closePanelTab}
          />
        ) : null}
      </RightPanelSheet>
    </>
  );
}
