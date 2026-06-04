import { Suspense, lazy, useCallback } from "react";

import { resolveInactivePanelContentVisibilityStyle } from "../lib/perf/motion";
import type { RightPanelMode, RightPanelRouteSearch } from "../rightPanelRouteSearch";
import { stripWorkspacePanelSearchParams } from "../workspaceRouteSearch";
import { Sidebar, SidebarProvider, SidebarRail } from "~/components/ui/sidebar";
import { DiffWorkerPoolProvider } from "./DiffWorkerPoolProvider";
import {
  DiffPanelHeaderSkeleton,
  DiffPanelLoadingState,
  DiffPanelShell,
  type DiffPanelMode,
} from "./DiffPanelShell";

const ThreadWorkspacePanel = lazy(() => import("./ThreadWorkspacePanel"));

const RIGHT_PANEL_INLINE_SIDEBAR_WIDTH_STORAGE_KEY = "chat_diff_sidebar_width";
const RIGHT_PANEL_INLINE_DEFAULT_WIDTH = "clamp(24rem,34vw,36rem)";
const RIGHT_PANEL_INLINE_SIDEBAR_MIN_WIDTH = 22 * 16;
const RIGHT_PANEL_INLINE_SIDEBAR_MAX_WIDTH = 256 * 16;
const RIGHT_PANEL_RESIZE_RAIL_CLASS_NAME =
  "w-5 cursor-ew-resize after:w-px after:bg-border/50 hover:after:bg-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-0";
const COMPOSER_COMPACT_MIN_LEFT_CONTROLS_WIDTH_PX = 208;

export function closeRightPanelSearch<T extends Record<string, unknown>>(
  params: T,
): Omit<
  T,
  | "diff"
  | "diffTurnId"
  | "diffFilePath"
  | "preview"
  | "workspaceOpen"
  | "workspaceTab"
  | "workspaceAgentKey"
> &
  RightPanelRouteSearch {
  return {
    ...stripWorkspacePanelSearchParams(params),
    diff: undefined,
    diffTurnId: undefined,
    diffFilePath: undefined,
    preview: undefined,
    workspaceOpen: undefined,
    workspaceTab: undefined,
    workspaceAgentKey: undefined,
  } as Omit<
    T,
    | "diff"
    | "diffTurnId"
    | "diffFilePath"
    | "preview"
    | "workspaceOpen"
    | "workspaceTab"
    | "workspaceAgentKey"
  > &
    RightPanelRouteSearch;
}

const RightPanelLoadingFallback = (props: { mode: DiffPanelMode; label: string }) => {
  return (
    <DiffPanelShell mode={props.mode} header={<DiffPanelHeaderSkeleton />}>
      <DiffPanelLoadingState label={props.label} />
    </DiffPanelShell>
  );
};

export const LazyRightPanel = (props: {
  mode: DiffPanelMode;
  panelMode: RightPanelMode | null;
  openedPanelModes: ReadonlyArray<RightPanelMode>;
  onClosePanelTab: (input: { mode: RightPanelMode; agentKey?: string }) => void;
}) => {
  return (
    <DiffWorkerPoolProvider>
      <Suspense
        fallback={
          <RightPanelLoadingFallback
            mode={props.mode}
            label={
              props.panelMode === "review"
                ? "Loading diff viewer..."
                : props.panelMode === "files"
                  ? "Loading file preview..."
                  : props.panelMode === "terminal"
                    ? "Loading terminal..."
                    : props.panelMode === "agent"
                      ? "Loading subagent thread..."
                      : "Loading workspace..."
            }
          />
        }
      >
        <ThreadWorkspacePanel
          mode={props.mode}
          panelMode={props.panelMode}
          openedPanelModes={props.openedPanelModes}
          onClosePanelTab={props.onClosePanelTab}
        />
      </Suspense>
    </DiffWorkerPoolProvider>
  );
};

export const RightPanelInlineSidebar = (props: {
  open: boolean;
  panelMode: RightPanelMode | null;
  openedPanelModes: ReadonlyArray<RightPanelMode>;
  onClosePanelTab: (input: { mode: RightPanelMode; agentKey?: string }) => void;
  onClose: () => void;
  onOpen: () => void;
  renderContent: boolean;
}) => {
  const { open, onClose, onOpen, panelMode, renderContent } = props;
  const panelContentVisibilityStyle = resolveInactivePanelContentVisibilityStyle({
    active: open,
    containIntrinsicSize: "28rem 100vh",
  });
  const onOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        onOpen();
        return;
      }
      onClose();
    },
    [onClose, onOpen],
  );
  const shouldAcceptInlineSidebarWidth = useCallback(
    ({ nextWidth, wrapper }: { nextWidth: number; wrapper: HTMLElement }) => {
      const composerForm = document.querySelector<HTMLElement>("[data-chat-composer-form='true']");
      if (!composerForm) return true;
      const composerViewport = composerForm.parentElement;
      if (!composerViewport) return true;
      const previousSidebarWidth = wrapper.style.getPropertyValue("--sidebar-width");
      wrapper.style.setProperty("--sidebar-width", `${nextWidth}px`);

      const viewportStyle = window.getComputedStyle(composerViewport);
      const viewportPaddingLeft = Number.parseFloat(viewportStyle.paddingLeft) || 0;
      const viewportPaddingRight = Number.parseFloat(viewportStyle.paddingRight) || 0;
      const viewportContentWidth = Math.max(
        0,
        composerViewport.clientWidth - viewportPaddingLeft - viewportPaddingRight,
      );
      const formRect = composerForm.getBoundingClientRect();
      const composerFooter = composerForm.querySelector<HTMLElement>(
        "[data-chat-composer-footer='true']",
      );
      const composerRightActions = composerForm.querySelector<HTMLElement>(
        "[data-chat-composer-actions='right']",
      );
      const composerRightActionsWidth = composerRightActions?.getBoundingClientRect().width ?? 0;
      const composerFooterGap = composerFooter
        ? Number.parseFloat(window.getComputedStyle(composerFooter).columnGap) ||
          Number.parseFloat(window.getComputedStyle(composerFooter).gap) ||
          0
        : 0;
      const minimumComposerWidth =
        COMPOSER_COMPACT_MIN_LEFT_CONTROLS_WIDTH_PX + composerRightActionsWidth + composerFooterGap;
      const hasComposerOverflow = composerForm.scrollWidth > composerForm.clientWidth + 0.5;
      const overflowsViewport = formRect.width > viewportContentWidth + 0.5;
      const violatesMinimumComposerWidth = composerForm.clientWidth + 0.5 < minimumComposerWidth;

      if (previousSidebarWidth.length > 0) {
        wrapper.style.setProperty("--sidebar-width", previousSidebarWidth);
      } else {
        wrapper.style.removeProperty("--sidebar-width");
      }

      return !hasComposerOverflow && !overflowsViewport && !violatesMinimumComposerWidth;
    },
    [],
  );

  return (
    <SidebarProvider
      defaultOpen={false}
      open={open}
      onOpenChange={onOpenChange}
      className="w-auto min-h-0 flex-none bg-transparent"
      style={{ "--sidebar-width": RIGHT_PANEL_INLINE_DEFAULT_WIDTH } as React.CSSProperties}
    >
      <Sidebar
        side="right"
        collapsible="offcanvas"
        className="border-l border-border bg-card text-foreground"
        resizable={{
          maxWidth: RIGHT_PANEL_INLINE_SIDEBAR_MAX_WIDTH,
          minWidth: RIGHT_PANEL_INLINE_SIDEBAR_MIN_WIDTH,
          shouldAcceptWidth: shouldAcceptInlineSidebarWidth,
          storageKey: RIGHT_PANEL_INLINE_SIDEBAR_WIDTH_STORAGE_KEY,
        }}
      >
        <div className="flex min-h-0 w-full flex-1" style={panelContentVisibilityStyle}>
          {renderContent ? (
            <LazyRightPanel
              mode="sidebar"
              panelMode={panelMode}
              openedPanelModes={props.openedPanelModes}
              onClosePanelTab={props.onClosePanelTab}
            />
          ) : null}
        </div>
        <SidebarRail
          aria-label="Resize workspace panel"
          className={RIGHT_PANEL_RESIZE_RAIL_CLASS_NAME}
          title="Drag to resize workspace panel"
        />
      </Sidebar>
    </SidebarProvider>
  );
};
