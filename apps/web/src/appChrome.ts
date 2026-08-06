import { isElectron } from "./env";

/**
 * Left inset for whichever bar owns the workspace's top-left corner while the
 * app sidebar is collapsed.
 *
 * A collapsed sidebar leaves no chrome at that corner, so the shell floats the
 * brand mark, settings, and the show-sidebar control there (see
 * `CollapsedAppSidebarChrome`) — roughly 86px of controls, starting at the x
 * the mark occupies in the expanded header. In the desktop shell the same
 * corner also carries the native window controls: macOS traffic lights, or the
 * Window Controls Overlay geometry. The inset has to clear both. Which bar
 * owns the corner depends on the layout: normally the chat header, or the
 * workspace panel tab bar while that panel is maximized.
 */
export const COLLAPSED_APP_SIDEBAR_CHROME_INSET_CLASS = isElectron
  ? "pl-[192px] wco:pl-[calc(env(titlebar-area-x)+7.5rem)]"
  : "pl-[calc(env(safe-area-inset-left)+7.5rem)]";

/**
 * Pairs with the inset above on the same element.
 *
 * The inset swaps between two very different paddings the moment the sidebar
 * is toggled, while the surface it sits on resizes across the sidebar's 200ms
 * slide. Left unanimated the breadcrumb and thread title jump to their final
 * position on the first frame and then wait for the panel to catch up. Match
 * the sidebar's own timing so the two move as one.
 */
export const APP_SIDEBAR_CHROME_INSET_TRANSITION_CLASS =
  "transition-[padding-left] duration-200 ease-linear motion-reduce:transition-none";
