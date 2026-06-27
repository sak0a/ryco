import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";

import ThreadSidebar from "./Sidebar";
import { Sidebar, SidebarProvider, SidebarRail, useSidebar } from "./ui/sidebar";
import {
  clearShortcutModifierState,
  syncShortcutModifierStateFromKeyboardEvent,
} from "../shortcutModifierState";
import { resolveShortcutCommand, shouldIgnoreGlobalNavigationShortcut } from "../keybindings";
import { isTerminalFocused } from "../lib/terminalFocus";
import { useServerKeybindings } from "../rpc/serverState";
import { useSettingsDialogStore } from "../settingsDialogStore";

const THREAD_SIDEBAR_WIDTH_STORAGE_KEY = "chat_thread_sidebar_width";
const THREAD_SIDEBAR_MIN_WIDTH = 13 * 16;
const THREAD_MAIN_CONTENT_MIN_WIDTH = 40 * 16;

const LazySettingsDialog = lazy(() =>
  import("./settings/SettingsDialog").then((module) => ({ default: module.SettingsDialog })),
);

function LazySettingsDialogMount() {
  const open = useSettingsDialogStore((s) => s.open);
  const [hasOpened, setHasOpened] = useState(open);

  useEffect(() => {
    if (open) {
      setHasOpened(true);
    }
  }, [open]);

  if (!hasOpened) {
    return null;
  }

  return (
    <Suspense fallback={null}>
      <LazySettingsDialog />
    </Suspense>
  );
}

// The sidebar writes its open/closed state to the `sidebar_state` cookie; read
// it back here so the collapsed state persists across reloads (SidebarProvider
// only seeds its initial state from `defaultOpen`).
function readSidebarOpenPreference(): boolean {
  if (typeof document === "undefined") return true;
  const match = document.cookie.match(/(?:^|;\s*)sidebar_state=([^;]+)/);
  return match ? match[1] !== "false" : true;
}

// Global Mod+B (configurable as `sidebar.toggle`) handler. Lives inside the
// SidebarProvider so the toggle works on every route — chat, settings, and the
// no-active-thread state — not just inside the chat view's shortcut handler.
function SidebarToggleShortcut() {
  const { toggleSidebar } = useSidebar();
  const keybindings = useServerKeybindings();

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const command = resolveShortcutCommand(event, keybindings, {
        context: { terminalFocus: isTerminalFocused() },
      });
      if (command !== "sidebar.toggle") return;
      // Don't steal the shortcut while typing (e.g. Mod+B for bold in the composer).
      if (shouldIgnoreGlobalNavigationShortcut(event)) return;
      event.preventDefault();
      event.stopPropagation();
      toggleSidebar();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [keybindings, toggleSidebar]);

  return null;
}

export function AppSidebarLayout({ children }: { children: ReactNode }) {
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

  return (
    <SidebarProvider className="h-dvh! min-h-0!" defaultOpen={readSidebarOpenPreference()}>
      <SidebarToggleShortcut />
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
      {children}
      <LazySettingsDialogMount />
    </SidebarProvider>
  );
}
