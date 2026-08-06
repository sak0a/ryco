import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";

import { DraftId } from "../../composerDraftStore";
import { useDraftSession } from "../../composerDraftSelectors";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { usePresentationTier } from "../../hooks/usePresentationTier";
import { useRightPanelMaximized } from "../../hooks/useRightPanelMaximized";
import { RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY } from "../../rightPanelLayout";
import {
  getRightPanelMode,
  isRightPanelOpen,
  type RightPanelMode,
  type RightPanelRouteSearch,
} from "../../rightPanelRouteSearch";
import { useStore } from "../../store";
import { createThreadSelectorAcrossEnvironments } from "../../storeSelectors";
import { buildThreadRouteParams } from "../../threadRoutes";
import {
  buildOpenAgentSearch,
  buildOpenAgentsSearch,
  buildOpenFilesSearch,
  buildOpenReviewSearch,
  buildOpenTerminalSearch,
  buildOpenWorkspaceSearch,
} from "../../workspaceRouteSearch";
import ChatView from "../ChatView";
import { threadIsPromotedAndPersisted } from "../ChatView.logic";
import { LazyRightPanel, RightPanelInlineSidebar, closeRightPanelSearch } from "../ChatRightPanel";
import { RightPanelSheet } from "../RightPanelSheet";
import { PhoneWorkSurfaceSheet } from "../shell/phone/PhoneWorkSurface";
import { SidebarInset, useSidebar } from "../ui/sidebar";
import { cn } from "~/lib/utils";

export function DraftChatThreadRouteView({
  rawDraftId,
  search,
}: {
  rawDraftId: string;
  search: RightPanelRouteSearch;
}) {
  const navigate = useNavigate();
  const draftId = DraftId.make(rawDraftId);
  const draftSession = useDraftSession(draftId);
  const serverThread = useStore(
    useMemo(
      () => createThreadSelectorAcrossEnvironments(draftSession?.threadId ?? null),
      [draftSession?.threadId],
    ),
  );
  const serverThreadStarted = threadIsPromotedAndPersisted(serverThread);
  const canonicalThreadRef = useMemo(
    () =>
      draftSession?.promotedTo
        ? serverThreadStarted
          ? draftSession.promotedTo
          : null
        : serverThread
          ? {
              environmentId: serverThread.environmentId,
              threadId: serverThread.id,
            }
          : null,
    [draftSession?.promotedTo, serverThread, serverThreadStarted],
  );

  const diffOpen = search.diff === "1";
  const previewOpen = search.preview === "1";
  const rightPanelMode: RightPanelMode | null = getRightPanelMode(search);
  const rightPanelOpen = isRightPanelOpen(search);
  const activeAgentKey =
    search.workspaceTab === "agent" && search.workspaceAgentKey ? search.workspaceAgentKey : null;
  const shouldUseDiffSheet = useMediaQuery(RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY);
  const presentationTier = usePresentationTier();
  const appSidebarCollapsed = useSidebar().state === "collapsed" && presentationTier === "desktop";
  // Maximizing only means anything for the inline split — the sheet and the
  // phone work surface already cover the viewport.
  const { maximized: rightPanelMaximized, toggleMaximized: toggleRightPanelMaximized } =
    useRightPanelMaximized({
      threadKey: draftId,
      available: rightPanelOpen && !shouldUseDiffSheet && presentationTier !== "phone",
    });
  const [rightPanelMountState, setRightPanelMountState] = useState(() => ({
    draftId,
    hasOpenedDiff: diffOpen,
    hasOpenedPreview: previewOpen,
    hasOpenedTerminal: rightPanelMode === "terminal",
    hasOpenedAgents: rightPanelMode === "agents",
    openedAgentKeys: activeAgentKey ? [activeAgentKey] : [],
  }));
  const hasOpenedDiff =
    rightPanelMountState.draftId === draftId ? rightPanelMountState.hasOpenedDiff : diffOpen;
  const hasOpenedPreview =
    rightPanelMountState.draftId === draftId ? rightPanelMountState.hasOpenedPreview : previewOpen;
  const hasOpenedTerminal =
    rightPanelMountState.draftId === draftId
      ? rightPanelMountState.hasOpenedTerminal
      : rightPanelMode === "terminal";
  const hasOpenedAgents =
    rightPanelMountState.draftId === draftId
      ? rightPanelMountState.hasOpenedAgents
      : rightPanelMode === "agents";
  const openedAgentKeys = useMemo(() => {
    const keys =
      rightPanelMountState.draftId === draftId
        ? rightPanelMountState.openedAgentKeys
        : activeAgentKey
          ? [activeAgentKey]
          : [];
    return activeAgentKey && !keys.includes(activeAgentKey) ? [...keys, activeAgentKey] : keys;
  }, [activeAgentKey, draftId, rightPanelMountState]);
  const [lastOpenedRightPanelMode, setLastOpenedRightPanelMode] = useState<RightPanelMode>(
    () => rightPanelMode ?? "files",
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
    if (hasOpenedAgents || rightPanelMode === "agents") {
      modes.push("agents");
    }
    return modes;
  }, [hasOpenedAgents, hasOpenedDiff, hasOpenedPreview, hasOpenedTerminal, rightPanelMode]);
  const markRightPanelOpened = useCallback(
    (panelMode: RightPanelMode) => {
      setLastOpenedRightPanelMode(panelMode);
      setRightPanelMountState((previous) => {
        const nextState = {
          draftId,
          hasOpenedDiff:
            (previous.draftId === draftId ? previous.hasOpenedDiff : diffOpen) ||
            panelMode === "review",
          hasOpenedPreview:
            (previous.draftId === draftId ? previous.hasOpenedPreview : previewOpen) ||
            panelMode === "files",
          hasOpenedTerminal:
            (previous.draftId === draftId
              ? previous.hasOpenedTerminal
              : rightPanelMode === "terminal") || panelMode === "terminal",
          hasOpenedAgents:
            (previous.draftId === draftId
              ? previous.hasOpenedAgents
              : rightPanelMode === "agents") || panelMode === "agents",
          openedAgentKeys:
            previous.draftId === draftId ? previous.openedAgentKeys : openedAgentKeys,
        };
        if (
          previous.draftId === nextState.draftId &&
          previous.hasOpenedDiff === nextState.hasOpenedDiff &&
          previous.hasOpenedPreview === nextState.hasOpenedPreview &&
          previous.hasOpenedTerminal === nextState.hasOpenedTerminal &&
          previous.hasOpenedAgents === nextState.hasOpenedAgents &&
          previous.openedAgentKeys === nextState.openedAgentKeys
        ) {
          return previous;
        }
        return nextState;
      });
    },
    [diffOpen, draftId, openedAgentKeys, previewOpen, rightPanelMode],
  );
  const closeRightPanel = useCallback(() => {
    void navigate({
      to: "/draft/$draftId",
      params: { draftId },
      search: (previous) => closeRightPanelSearch(previous),
    });
  }, [draftId, navigate]);
  const openRightPanel = useCallback(() => {
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
      if (lastOpenedRightPanelMode === "agents" && hasOpenedAgents) {
        return buildOpenAgentsSearch(previous);
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
      if (hasOpenedAgents) {
        return buildOpenAgentsSearch(previous);
      }
      if (lastAgentKey) {
        return buildOpenAgentSearch(previous, lastAgentKey);
      }
      return buildOpenWorkspaceSearch(previous);
    };
    void navigate({
      to: "/draft/$draftId",
      params: { draftId },
      search: nextSearch,
    });
  }, [
    draftId,
    hasOpenedAgents,
    hasOpenedDiff,
    hasOpenedPreview,
    hasOpenedTerminal,
    lastOpenedRightPanelMode,
    navigate,
    openedAgentKeys,
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
      if (input.mode === "agent") {
        const nextOpenedAgentKeys = openedAgentKeys.filter((key) => key !== input.agentKey);
        setRightPanelMountState((previous) => ({
          draftId,
          hasOpenedDiff: previous.draftId === draftId ? previous.hasOpenedDiff : hasOpenedDiff,
          hasOpenedPreview:
            previous.draftId === draftId ? previous.hasOpenedPreview : hasOpenedPreview,
          hasOpenedTerminal:
            previous.draftId === draftId ? previous.hasOpenedTerminal : hasOpenedTerminal,
          hasOpenedAgents:
            previous.draftId === draftId ? previous.hasOpenedAgents : hasOpenedAgents,
          openedAgentKeys: nextOpenedAgentKeys,
        }));

        if (rightPanelMode === "agent" && activeAgentKey === input.agentKey) {
          void navigate({
            to: "/draft/$draftId",
            params: { draftId },
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
              if (hasOpenedAgents) {
                return buildOpenAgentsSearch(previous);
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
      const nextHasOpenedAgents =
        input.mode === "agents" ? false : hasOpenedAgents || rightPanelMode === "agents";
      setRightPanelMountState((previous) => {
        const nextState = {
          draftId,
          hasOpenedDiff: nextHasOpenedDiff,
          hasOpenedPreview: nextHasOpenedPreview,
          hasOpenedTerminal: nextHasOpenedTerminal,
          hasOpenedAgents: nextHasOpenedAgents,
          openedAgentKeys:
            previous.draftId === draftId ? previous.openedAgentKeys : openedAgentKeys,
        };
        if (
          previous.draftId === nextState.draftId &&
          previous.hasOpenedDiff === nextState.hasOpenedDiff &&
          previous.hasOpenedPreview === nextState.hasOpenedPreview &&
          previous.hasOpenedTerminal === nextState.hasOpenedTerminal &&
          previous.hasOpenedAgents === nextState.hasOpenedAgents &&
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
        if (input.mode !== "agents" && nextHasOpenedAgents) {
          return buildOpenAgentsSearch(previous);
        }
        return buildOpenWorkspaceSearch(previous);
      };
      void navigate({
        to: "/draft/$draftId",
        params: { draftId },
        search: nextSearch,
      });
    },
    [
      activeAgentKey,
      draftId,
      hasOpenedAgents,
      hasOpenedDiff,
      hasOpenedPreview,
      hasOpenedTerminal,
      navigate,
      openedAgentKeys,
      rightPanelMode,
    ],
  );

  useEffect(() => {
    if (rightPanelMode !== null) {
      setLastOpenedRightPanelMode(rightPanelMode);
      markRightPanelOpened(rightPanelMode);
    }
  }, [markRightPanelOpened, rightPanelMode]);

  useEffect(() => {
    if (!activeAgentKey) {
      return;
    }
    setRightPanelMountState((previous) => {
      const baseAgentKeys = previous.draftId === draftId ? previous.openedAgentKeys : [];
      if (baseAgentKeys.includes(activeAgentKey)) {
        return previous.draftId === draftId
          ? previous
          : {
              draftId,
              hasOpenedDiff,
              hasOpenedPreview,
              hasOpenedTerminal,
              hasOpenedAgents,
              openedAgentKeys: baseAgentKeys,
            };
      }
      return {
        draftId,
        hasOpenedDiff: previous.draftId === draftId ? previous.hasOpenedDiff : diffOpen,
        hasOpenedPreview: previous.draftId === draftId ? previous.hasOpenedPreview : previewOpen,
        hasOpenedTerminal:
          previous.draftId === draftId ? previous.hasOpenedTerminal : rightPanelMode === "terminal",
        hasOpenedAgents:
          previous.draftId === draftId ? previous.hasOpenedAgents : rightPanelMode === "agents",
        openedAgentKeys: [...baseAgentKeys, activeAgentKey],
      };
    });
  }, [
    activeAgentKey,
    diffOpen,
    draftId,
    hasOpenedAgents,
    hasOpenedDiff,
    hasOpenedPreview,
    hasOpenedTerminal,
    previewOpen,
    rightPanelMode,
  ]);

  useEffect(() => {
    if (!canonicalThreadRef) {
      return;
    }
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(canonicalThreadRef),
      replace: true,
    });
  }, [canonicalThreadRef, navigate]);

  useEffect(() => {
    if (draftSession || canonicalThreadRef) {
      return;
    }
    void navigate({ to: "/", replace: true });
  }, [canonicalThreadRef, draftSession, navigate]);

  if (canonicalThreadRef) {
    return (
      <SidebarInset className="h-svh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground md:h-dvh">
        <ChatView
          environmentId={canonicalThreadRef.environmentId}
          threadId={canonicalThreadRef.threadId}
          routeKind="server"
        />
      </SidebarInset>
    );
  }

  if (!draftSession) {
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
    rightPanelMode === "agents" ||
    hasOpenedAgents ||
    rightPanelMode === "agent" ||
    openedAgentKeys.length > 0;
  // The frozen phone tier has no Agents workspace: agents state neither
  // mounts nor retains the phone work surface.
  const shouldRenderPhoneRightPanelContent =
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

  // Phone tier: full-screen work-surface promotion over the draft thread,
  // driven by the same URL search params as the desktop presentations.
  if (presentationTier === "phone") {
    return (
      <>
        <SidebarInset className="h-svh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground md:h-dvh">
          <ChatView
            draftId={draftId}
            environmentId={draftSession.environmentId}
            threadId={draftSession.threadId}
            onDiffPanelOpen={() => markRightPanelOpened("review")}
            onPreviewPanelOpen={() => markRightPanelOpened("files")}
            onTerminalPanelOpen={() => markRightPanelOpened("terminal")}
            onAgentPanelOpen={() => markRightPanelOpened("agent")}
            workspacePanelOpen={rightPanelOpen}
            onToggleWorkspacePanel={toggleRightPanel}
            routeKind="draft"
          />
        </SidebarInset>
        <PhoneWorkSurfaceSheet label="Workspace" open={rightPanelOpen} onClose={closeRightPanel}>
          {shouldRenderPhoneRightPanelContent ? (
            <LazyRightPanel
              mode="phone"
              panelMode={mountedRightPanelMode}
              openedPanelModes={openedPanelModes}
              openedAgentKeys={openedAgentKeys}
              onClosePanelTab={closePanelTab}
            />
          ) : null}
        </PhoneWorkSurfaceSheet>
      </>
    );
  }

  if (!shouldUseDiffSheet) {
    return (
      <>
        {/* Maximized: the chat column keeps its subtree mounted (draft
            composer state above all) but gives up all of its width and goes
            inert so nothing behind the panel stays focusable. */}
        <SidebarInset
          className={cn(
            "h-svh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground md:h-dvh",
            rightPanelMaximized && "w-0 flex-none",
          )}
          inert={rightPanelMaximized ? true : undefined}
        >
          <ChatView
            draftId={draftId}
            environmentId={draftSession.environmentId}
            threadId={draftSession.threadId}
            onDiffPanelOpen={() => markRightPanelOpened("review")}
            onPreviewPanelOpen={() => markRightPanelOpened("files")}
            onTerminalPanelOpen={() => markRightPanelOpened("terminal")}
            onAgentPanelOpen={() => markRightPanelOpened("agent")}
            workspacePanelOpen={rightPanelOpen}
            onToggleWorkspacePanel={toggleRightPanel}
            routeKind="draft"
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
          maximized={rightPanelMaximized}
          onToggleMaximized={toggleRightPanelMaximized}
          reserveChromeInset={rightPanelMaximized && appSidebarCollapsed}
        />
      </>
    );
  }

  return (
    <>
      <SidebarInset className="h-svh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground md:h-dvh">
        <ChatView
          draftId={draftId}
          environmentId={draftSession.environmentId}
          threadId={draftSession.threadId}
          onDiffPanelOpen={() => markRightPanelOpened("review")}
          onPreviewPanelOpen={() => markRightPanelOpened("files")}
          onTerminalPanelOpen={() => markRightPanelOpened("terminal")}
          onAgentPanelOpen={() => markRightPanelOpened("agent")}
          workspacePanelOpen={rightPanelOpen}
          onToggleWorkspacePanel={toggleRightPanel}
          routeKind="draft"
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
