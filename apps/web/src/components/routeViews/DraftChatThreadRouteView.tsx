import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import ChatView from "../ChatView";
import { threadIsPromotedAndPersisted } from "../ChatView.logic";
import { LazyRightPanel, RightPanelInlineSidebar, closeRightPanelSearch } from "../ChatRightPanel";
import { useComposerDraftStore, DraftId } from "../../composerDraftStore";
import { buildOpenDiffSearch } from "../../diffRouteSearch";
import { buildOpenPreviewSearch } from "../../previewRouteSearch";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY } from "../../rightPanelLayout";
import { RightPanelSheet } from "../RightPanelSheet";
import { SidebarInset } from "../ui/sidebar";
import {
  getRightPanelMode,
  type RightPanelMode,
  type RightPanelRouteSearch,
} from "../../rightPanelRouteSearch";
import { createThreadSelectorAcrossEnvironments } from "../../storeSelectors";
import { useStore } from "../../store";
import { buildThreadRouteParams } from "../../threadRoutes";

export function DraftChatThreadRouteView({
  rawDraftId,
  search,
}: {
  rawDraftId: string;
  search: RightPanelRouteSearch;
}) {
  const navigate = useNavigate();
  const draftId = DraftId.make(rawDraftId);
  const draftSession = useComposerDraftStore((store) => store.getDraftSession(draftId));
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
  const rightPanelOpen = rightPanelMode !== null;
  const shouldUseDiffSheet = useMediaQuery(RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY);
  const [rightPanelMountState, setRightPanelMountState] = useState(() => ({
    draftId,
    hasOpenedDiff: diffOpen,
    hasOpenedPreview: previewOpen,
  }));
  const hasOpenedDiff =
    rightPanelMountState.draftId === draftId ? rightPanelMountState.hasOpenedDiff : diffOpen;
  const hasOpenedPreview =
    rightPanelMountState.draftId === draftId ? rightPanelMountState.hasOpenedPreview : previewOpen;
  const [lastOpenedRightPanelMode, setLastOpenedRightPanelMode] = useState<RightPanelMode>(
    () => rightPanelMode ?? "preview",
  );
  const markRightPanelOpened = useCallback(
    (panelMode: RightPanelMode) => {
      setLastOpenedRightPanelMode(panelMode);
      setRightPanelMountState((previous) => {
        const nextState = {
          draftId,
          hasOpenedDiff:
            (previous.draftId === draftId ? previous.hasOpenedDiff : diffOpen) ||
            panelMode === "diff",
          hasOpenedPreview:
            (previous.draftId === draftId ? previous.hasOpenedPreview : previewOpen) ||
            panelMode === "preview",
        };
        if (
          previous.draftId === nextState.draftId &&
          previous.hasOpenedDiff === nextState.hasOpenedDiff &&
          previous.hasOpenedPreview === nextState.hasOpenedPreview
        ) {
          return previous;
        }
        return nextState;
      });
    },
    [diffOpen, draftId, previewOpen],
  );
  const closeRightPanel = useCallback(() => {
    void navigate({
      to: "/draft/$draftId",
      params: { draftId },
      search: (previous) => closeRightPanelSearch(previous),
    });
  }, [draftId, navigate]);
  const openDiff = useCallback(() => {
    markRightPanelOpened("diff");
    void navigate({
      to: "/draft/$draftId",
      params: { draftId },
      search: (previous) => buildOpenDiffSearch(previous),
    });
  }, [draftId, markRightPanelOpened, navigate]);
  const openPreview = useCallback(() => {
    markRightPanelOpened("preview");
    void navigate({
      to: "/draft/$draftId",
      params: { draftId },
      search: (previous) => buildOpenPreviewSearch(previous),
    });
  }, [draftId, markRightPanelOpened, navigate]);
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
    rightPanelMode === "diff" || hasOpenedDiff || rightPanelMode === "preview" || hasOpenedPreview;
  const mountedRightPanelMode: RightPanelMode = rightPanelMode ?? lastOpenedRightPanelMode;

  if (!shouldUseDiffSheet) {
    return (
      <>
        <SidebarInset className="h-svh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground md:h-dvh">
          <ChatView
            draftId={draftId}
            environmentId={draftSession.environmentId}
            threadId={draftSession.threadId}
            onDiffPanelOpen={() => markRightPanelOpened("diff")}
            onPreviewPanelOpen={() => markRightPanelOpened("preview")}
            reserveTitleBarControlInset={!rightPanelOpen}
            routeKind="draft"
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
          draftId={draftId}
          environmentId={draftSession.environmentId}
          threadId={draftSession.threadId}
          onDiffPanelOpen={() => markRightPanelOpened("diff")}
          onPreviewPanelOpen={() => markRightPanelOpened("preview")}
          routeKind="draft"
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
