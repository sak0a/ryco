import type { ScopedThreadRef } from "@ryco/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";

import { finalizePromotedDraftThreadByRef } from "../../composerDraftStore";
import {
  useDraftThreadByRef,
  useDraftThreadExistsByRef,
  useEnvironmentHasDraftThreads,
} from "../../composerDraftSelectors";
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
  buildOpenAgentSearch,
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
  const draftThreadExists = useDraftThreadExistsByRef(threadRef);
  const draftThread = useDraftThreadByRef(threadRef);
  const environmentHasDraftThreads = useEnvironmentHasDraftThreads(threadRef?.environmentId);
  const routeThreadExists = threadExists || draftThreadExists;
  const serverThreadStarted = threadHasStarted(serverThread);
  const environmentHasAnyThreads = environmentHasServerThreads || environmentHasDraftThreads;
  const diffOpen = search.diff === "1";
  const previewOpen = search.preview === "1";
  const rightPanelMode: RightPanelMode | null = getRightPanelMode(search);
  const rightPanelOpen = isRightPanelOpen(search);
  const activeAgentKey =
    search.workspaceTab === "agent" && search.workspaceAgentKey ? search.workspaceAgentKey : null;
  const shouldUseDiffSheet = useMediaQuery(RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY);
  const currentThreadKey = threadRef ? `${threadRef.environmentId}:${threadRef.threadId}` : null;
  const [diffPanelMountState, setDiffPanelMountState] = useState(() => ({
    threadKey: currentThreadKey,
    hasOpenedDiff: diffOpen,
    hasOpenedPreview: previewOpen,
    hasOpenedTerminal: rightPanelMode === "terminal",
    openedAgentKeys: activeAgentKey ? [activeAgentKey] : [],
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
  const openedAgentKeys = useMemo(() => {
    const keys =
      diffPanelMountState.threadKey === currentThreadKey
        ? diffPanelMountState.openedAgentKeys
        : activeAgentKey
          ? [activeAgentKey]
          : [];
    return activeAgentKey && !keys.includes(activeAgentKey) ? [...keys, activeAgentKey] : keys;
  }, [activeAgentKey, currentThreadKey, diffPanelMountState]);
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
          openedAgentKeys:
            previous.threadKey === currentThreadKey ? previous.openedAgentKeys : openedAgentKeys,
        };
        if (
          previous.threadKey === nextState.threadKey &&
          previous.hasOpenedDiff === nextState.hasOpenedDiff &&
          previous.hasOpenedPreview === nextState.hasOpenedPreview &&
          previous.hasOpenedTerminal === nextState.hasOpenedTerminal &&
          previous.openedAgentKeys === nextState.openedAgentKeys
        ) {
          return previous;
        }
        return nextState;
      });
    },
    [currentThreadKey, diffOpen, openedAgentKeys, previewOpen, rightPanelMode],
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
      const lastAgentKey = openedAgentKeys[openedAgentKeys.length - 1];
      if (lastOpenedRightPanelMode === "agent" && lastAgentKey) {
        return buildOpenAgentSearch(previous, lastAgentKey);
      }
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
      if (lastAgentKey) {
        return buildOpenAgentSearch(previous, lastAgentKey);
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
    openedAgentKeys,
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
        const nextOpenedAgentKeys = openedAgentKeys.filter((key) => key !== input.agentKey);
        setDiffPanelMountState((previous) => ({
          threadKey: currentThreadKey,
          hasOpenedDiff:
            previous.threadKey === currentThreadKey ? previous.hasOpenedDiff : hasOpenedDiff,
          hasOpenedPreview:
            previous.threadKey === currentThreadKey ? previous.hasOpenedPreview : hasOpenedPreview,
          hasOpenedTerminal:
            previous.threadKey === currentThreadKey
              ? previous.hasOpenedTerminal
              : hasOpenedTerminal,
          openedAgentKeys: nextOpenedAgentKeys,
        }));

        if (rightPanelMode === "agent" && activeAgentKey === input.agentKey) {
          void navigate({
            to: "/$environmentId/$threadId",
            params: buildThreadRouteParams(threadRef),
            search: (previous) => {
              const nextAgentKey = nextOpenedAgentKeys[nextOpenedAgentKeys.length - 1];
              if (nextAgentKey) {
                return buildOpenAgentSearch(previous, nextAgentKey);
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
            },
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
          openedAgentKeys:
            previous.threadKey === currentThreadKey ? previous.openedAgentKeys : openedAgentKeys,
        };
        if (
          previous.threadKey === nextState.threadKey &&
          previous.hasOpenedDiff === nextState.hasOpenedDiff &&
          previous.hasOpenedPreview === nextState.hasOpenedPreview &&
          previous.hasOpenedTerminal === nextState.hasOpenedTerminal &&
          previous.openedAgentKeys === nextState.openedAgentKeys
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
      activeAgentKey,
      hasOpenedDiff,
      hasOpenedPreview,
      hasOpenedTerminal,
      navigate,
      openedAgentKeys,
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
    if (!currentThreadKey || !activeAgentKey) {
      return;
    }
    setDiffPanelMountState((previous) => {
      const baseAgentKeys = previous.threadKey === currentThreadKey ? previous.openedAgentKeys : [];
      if (baseAgentKeys.includes(activeAgentKey)) {
        return previous.threadKey === currentThreadKey
          ? previous
          : {
              threadKey: currentThreadKey,
              hasOpenedDiff,
              hasOpenedPreview,
              hasOpenedTerminal,
              openedAgentKeys: baseAgentKeys,
            };
      }
      return {
        threadKey: currentThreadKey,
        hasOpenedDiff: previous.threadKey === currentThreadKey ? previous.hasOpenedDiff : diffOpen,
        hasOpenedPreview:
          previous.threadKey === currentThreadKey ? previous.hasOpenedPreview : previewOpen,
        hasOpenedTerminal:
          previous.threadKey === currentThreadKey
            ? previous.hasOpenedTerminal
            : rightPanelMode === "terminal",
        openedAgentKeys: [...baseAgentKeys, activeAgentKey],
      };
    });
  }, [
    activeAgentKey,
    currentThreadKey,
    diffOpen,
    hasOpenedDiff,
    hasOpenedPreview,
    hasOpenedTerminal,
    previewOpen,
    rightPanelMode,
  ]);

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
    rightPanelMode === "agent" ||
    openedAgentKeys.length > 0;
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
          openedAgentKeys={openedAgentKeys}
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
            openedAgentKeys={openedAgentKeys}
            onClosePanelTab={closePanelTab}
          />
        ) : null}
      </RightPanelSheet>
    </>
  );
}
