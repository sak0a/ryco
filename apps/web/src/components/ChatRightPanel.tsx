import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import {
  PREFERS_REDUCED_MOTION_QUERY,
  resolveInactivePanelContentVisibilityStyle,
} from "../lib/perf/motion";
import type { RightPanelMode, RightPanelRouteSearch } from "../rightPanelRouteSearch";
import { stripWorkspacePanelSearchParams } from "../workspaceRouteSearch";
import { Sidebar, SidebarProvider, SidebarRail } from "~/components/ui/sidebar";
import { cn } from "~/lib/utils";
import { useDelayedUnmount } from "~/hooks/useDelayedUnmount";
import { useMediaQuery } from "~/hooks/useMediaQuery";
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
const RIGHT_PANEL_INLINE_SIDEBAR_MAX_WIDTH = 56 * 16;
const RIGHT_PANEL_INLINE_EXIT_DURATION_MS = 360;
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

function RightPanelContentMotionFrame(props: {
  animate: boolean;
  children: ReactNode;
  open: boolean;
}) {
  const [entered, setEntered] = useState(!props.animate && props.open);

  useEffect(() => {
    if (!props.animate) {
      setEntered(props.open);
      return;
    }

    if (!props.open) {
      setEntered(false);
      return;
    }

    const frameId = window.requestAnimationFrame(() => setEntered(true));
    return () => window.cancelAnimationFrame(frameId);
  }, [props.animate, props.open]);

  const active = props.animate ? props.open && entered : props.open;

  return (
    <div
      aria-hidden={props.open ? undefined : true}
      inert={props.open ? undefined : true}
      className={cn(
        "flex min-h-0 w-full flex-1 transition-[translate,opacity] duration-[300ms] ease-[cubic-bezier(0.16,1,0.3,1)] will-change-transform motion-reduce:transition-none",
        active ? "translate-x-0 opacity-100" : "translate-x-4 opacity-0",
      )}
    >
      {props.children}
    </div>
  );
}

export const LazyRightPanel = (props: {
  mode: DiffPanelMode;
  panelMode: RightPanelMode | null;
  openedPanelModes: ReadonlyArray<RightPanelMode>;
  openedAgentKeys: ReadonlyArray<string>;
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
          openedAgentKeys={props.openedAgentKeys}
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
  openedAgentKeys: ReadonlyArray<string>;
  onClosePanelTab: (input: { mode: RightPanelMode; agentKey?: string }) => void;
  onClose: () => void;
  onOpen: () => void;
  renderContent: boolean;
}) => {
  const { open, onClose, onOpen, panelMode, renderContent } = props;
  const prefersReducedMotion = useMediaQuery(PREFERS_REDUCED_MOTION_QUERY);
  const renderPanelSurface = useDelayedUnmount(
    open,
    prefersReducedMotion ? 0 : RIGHT_PANEL_INLINE_EXIT_DURATION_MS,
  );
  const panelContentVisibilityStyle = resolveInactivePanelContentVisibilityStyle({
    active: renderPanelSurface,
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
      open
      onOpenChange={onOpenChange}
      className={cn(
        "min-h-0 flex-none bg-transparent transition-[width] duration-[360ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none",
        open ? "w-(--sidebar-width)" : "w-0",
      )}
      style={{ "--sidebar-width": RIGHT_PANEL_INLINE_DEFAULT_WIDTH } as CSSProperties}
    >
      <Sidebar
        side="right"
        collapsible="offcanvas"
        className={cn(
          "border-l border-border bg-card text-foreground transition-[translate,width] duration-[360ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none",
          open ? "translate-x-0" : "pointer-events-none translate-x-full",
        )}
        resizable={{
          maxWidth: RIGHT_PANEL_INLINE_SIDEBAR_MAX_WIDTH,
          minWidth: RIGHT_PANEL_INLINE_SIDEBAR_MIN_WIDTH,
          shouldAcceptWidth: shouldAcceptInlineSidebarWidth,
          storageKey: RIGHT_PANEL_INLINE_SIDEBAR_WIDTH_STORAGE_KEY,
        }}
      >
        <RightPanelContentMotionFrame animate={!prefersReducedMotion} open={open}>
          <div className="flex min-h-0 w-full flex-1" style={panelContentVisibilityStyle}>
            {renderContent && renderPanelSurface ? (
              <LazyRightPanel
                mode="sidebar"
                panelMode={panelMode}
                openedPanelModes={props.openedPanelModes}
                openedAgentKeys={props.openedAgentKeys}
                onClosePanelTab={props.onClosePanelTab}
              />
            ) : null}
          </div>
        </RightPanelContentMotionFrame>
        <SidebarRail
          aria-label="Resize workspace panel"
          className={RIGHT_PANEL_RESIZE_RAIL_CLASS_NAME}
          title="Drag to resize workspace panel"
        />
      </Sidebar>
    </SidebarProvider>
  );
};
