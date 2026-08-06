import { Schema } from "effect";
import { PanelLeftOpenIcon } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from "react";

import ThreadSidebar from "./Sidebar";
import { isElectron } from "../env";
import { getLocalStorageItem, setLocalStorageItem } from "../hooks/useLocalStorage";
import { usePresentationTier } from "../hooks/usePresentationTier";
import { cn } from "~/lib/utils";
import { Button } from "./ui/button";
import { Sidebar, SidebarProvider, SidebarRail, useSidebar } from "./ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import {
  clearShortcutModifierState,
  syncShortcutModifierStateFromKeyboardEvent,
} from "../shortcutModifierState";
import { useSettingsDialogStore } from "../settingsDialogStore";

const THREAD_SIDEBAR_WIDTH_STORAGE_KEY = "chat_thread_sidebar_width";
const THREAD_SIDEBAR_OPEN_STORAGE_KEY = "chat_thread_sidebar_open";
const THREAD_SIDEBAR_MIN_WIDTH = 13 * 16;
const THREAD_MAIN_CONTENT_MIN_WIDTH = 40 * 16;

function readPersistedThreadSidebarOpen(): boolean {
  try {
    return getLocalStorageItem(THREAD_SIDEBAR_OPEN_STORAGE_KEY, Schema.Boolean) ?? true;
  } catch {
    return true;
  }
}

const LazySettingsDialog = lazy(() =>
  import("./settings/SettingsDialog").then((module) => ({ default: module.SettingsDialog })),
);
const LazyPhoneSettingsSurface = lazy(() =>
  import("./shell/phone/PhoneSettingsSurface").then((module) => ({
    default: module.PhoneSettingsSurface,
  })),
);

export function LazySettingsDialogMount() {
  const open = useSettingsDialogStore((s) => s.open);
  const presentationTier = usePresentationTier();
  const [hasOpened, setHasOpened] = useState(open);

  useEffect(() => {
    if (open) {
      setHasOpened(true);
    }
  }, [open]);

  if (!hasOpened) {
    return null;
  }

  // The settings presentation forks at the tier seam: the desktop dialog
  // stays exactly as it is, while the phone tier renders the full-screen
  // paged settings surface. The settings dialog store (open state and
  // section) is shared, so a mid-open tier flip re-presents the same section
  // in the other presentation.
  return (
    <Suspense fallback={null}>
      {presentationTier === "phone" ? <LazyPhoneSettingsSurface /> : <LazySettingsDialog />}
    </Suspense>
  );
}

/**
 * Shell-wide global effects shared by every application shell tier: the
 * shortcut-modifier keydown/keyup/blur sync and the desktop-bridge
 * open-settings menu action. Mounted once by the active shell (desktop
 * sidebar layout or the phone shell) — never by both.
 */
export function useAppShellGlobalEffects(): void {
  const openSettings = useSettingsDialogStore((s) => s.openSettings);

  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      syncShortcutModifierStateFromKeyboardEvent(event);
    };
    const onWindowKeyUp = (event: KeyboardEvent) => {
      syncShortcutModifierStateFromKeyboardEvent(event);
    };
    const onWindowBlur = () => {
      clearShortcutModifierState();
    };

    window.addEventListener("keydown", onWindowKeyDown, true);
    window.addEventListener("keyup", onWindowKeyUp, true);
    window.addEventListener("blur", onWindowBlur);

    return () => {
      window.removeEventListener("keydown", onWindowKeyDown, true);
      window.removeEventListener("keyup", onWindowKeyUp, true);
      window.removeEventListener("blur", onWindowBlur);
    };
  }, []);

  useEffect(() => {
    const onMenuAction = window.desktopBridge?.onMenuAction;
    if (typeof onMenuAction !== "function") {
      return;
    }

    const unsubscribe = onMenuAction((action) => {
      if (action === "open-settings") {
        openSettings();
      }
    });

    return () => {
      unsubscribe?.();
    };
  }, [openSettings]);
}

/**
 * The way back from a collapsed thread sidebar.
 *
 * Offcanvas collapse takes the sidebar — and with it the collapse button in
 * its header — off screen, and the resize rail is deliberately inert in that
 * state. Rather than make every workspace surface host its own re-open
 * affordance, the shell floats one over the corner the sidebar vacated.
 * Surfaces that own that corner reserve room for it with
 * `COLLAPSED_APP_SIDEBAR_CHROME_INSET_CLASS`.
 */
function AppSidebarExpandControl() {
  const { toggleSidebar } = useSidebar();

  return (
    <div
      className={cn(
        "pointer-events-none fixed top-0 z-50 flex items-center phone:hidden",
        isElectron
          ? // Clears the macOS traffic lights, or the Window Controls Overlay
            // origin on the platforms that publish one.
            "left-[86px] h-[52px] wco:left-[calc(env(titlebar-area-x)+0.5rem)] wco:h-[env(titlebar-area-height)]"
          : "top-[env(safe-area-inset-top)] left-[calc(env(safe-area-inset-left)+0.5rem)] h-[52px]",
      )}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-label="Show sidebar"
              className="pointer-events-auto text-muted-foreground/72 hover:text-foreground"
              onClick={toggleSidebar}
              size="icon-sm"
              variant="ghost"
            >
              <PanelLeftOpenIcon />
            </Button>
          }
        />
        <TooltipPopup side="bottom">Show sidebar</TooltipPopup>
      </Tooltip>
    </div>
  );
}

/**
 * The tier-aware application shell (delivery step 6 of the focused mobile
 * workspace design). The `SidebarProvider` context and the route subtree stay
 * mounted identically on both tiers — a tier flip (mid-size rotation, QA
 * override) must never remount the workspace and lose scroll, draft, or
 * panel state, and many components call `useSidebar()` unconditionally. Only
 * the sidebar chrome is tier-conditional: the desktop tier renders the
 * persistent thread sidebar; the phone tier renders no drawer — navigation is
 * URL-driven through the phone Home surface and the compact thread app bar.
 */
export function AppSidebarLayout({ children }: { children: ReactNode }) {
  useAppShellGlobalEffects();
  const presentationTier = usePresentationTier();
  // Collapsing the sidebar is a deliberate layout choice, so it outlives the
  // session the same way the sidebar width does. The shell owns the state
  // (rather than `SidebarProvider`'s internal default) because the collapsed
  // layout also decides whether the floating re-open control renders.
  const [sidebarOpen, setSidebarOpen] = useState(readPersistedThreadSidebarOpen);
  const isDesktopTier = presentationTier === "desktop";
  const handleSidebarOpenChange = useCallback((open: boolean) => {
    setSidebarOpen(open);
    try {
      setLocalStorageItem(THREAD_SIDEBAR_OPEN_STORAGE_KEY, open, Schema.Boolean);
    } catch {
      // Ignore quota/storage failures — the collapse still applies this session.
    }
  }, []);

  return (
    <SidebarProvider
      className="h-dvh! min-h-0!"
      open={sidebarOpen}
      onOpenChange={handleSidebarOpenChange}
    >
      {/* Ambient base layer: a faint primary-derived tint behind the shell.
          Opaque content covers it entirely; it exists so translucent chrome
          (Material steps above Solid) frosts something other than a flat
          fill. Static gradient — no animation, no compositing cost. */}
      <div aria-hidden className="app-ambient fixed inset-0 pointer-events-none" />
      {isDesktopTier ? (
        <Sidebar
          side="left"
          collapsible="offcanvas"
          className="border-r border-sidebar-border text-sidebar-foreground"
          resizable={{
            minWidth: THREAD_SIDEBAR_MIN_WIDTH,
            shouldAcceptWidth: ({ nextWidth, wrapper }) =>
              wrapper.clientWidth - nextWidth >= THREAD_MAIN_CONTENT_MIN_WIDTH,
            storageKey: THREAD_SIDEBAR_WIDTH_STORAGE_KEY,
          }}
        >
          <ThreadSidebar />
          <SidebarRail />
        </Sidebar>
      ) : null}
      {children}
      {isDesktopTier && !sidebarOpen ? <AppSidebarExpandControl /> : null}
      <LazySettingsDialogMount />
    </SidebarProvider>
  );
}
