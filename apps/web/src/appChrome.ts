import { isElectron } from "./env";

/**
 * Left inset for whichever bar owns the workspace's top-left corner while the
 * app sidebar is collapsed.
 *
 * A collapsed sidebar leaves no chrome at that corner, so the shell floats the
 * brand mark, settings, and the show-sidebar control there (see
 * `CollapsedAppSidebarChrome`) — roughly 80px of controls. In the desktop
 * shell the same corner also carries the native window controls: macOS traffic
 * lights, or the Window Controls Overlay geometry. The inset has to clear
 * both. Which bar owns the corner depends on the layout: normally the chat
 * header, or the workspace panel tab bar while that panel is maximized.
 */
export const COLLAPSED_APP_SIDEBAR_CHROME_INSET_CLASS = isElectron
  ? "pl-[176px] wco:pl-[calc(env(titlebar-area-x)+6.25rem)]"
  : "pl-[calc(env(safe-area-inset-left)+6.25rem)]";
