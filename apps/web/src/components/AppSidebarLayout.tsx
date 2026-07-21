import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";

import ThreadSidebar from "./Sidebar";
import { usePresentationTier } from "../hooks/usePresentationTier";
import { Sidebar, SidebarProvider, SidebarRail } from "./ui/sidebar";
import {
  clearShortcutModifierState,
  syncShortcutModifierStateFromKeyboardEvent,
} from "../shortcutModifierState";
import { useSettingsDialogStore } from "../settingsDialogStore";

const THREAD_SIDEBAR_WIDTH_STORAGE_KEY = "chat_thread_sidebar_width";
const THREAD_SIDEBAR_MIN_WIDTH = 13 * 16;
const THREAD_MAIN_CONTENT_MIN_WIDTH = 40 * 16;

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

  return (
    <SidebarProvider className="h-dvh! min-h-0!" defaultOpen>
      {presentationTier === "desktop" ? (
        <Sidebar
          side="left"
          collapsible="offcanvas"
          className="border-r border-border bg-card text-foreground"
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
      <LazySettingsDialogMount />
    </SidebarProvider>
  );
}
