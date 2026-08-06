import { useSidebar } from "~/components/ui/sidebar";

import { usePresentationTier } from "./usePresentationTier";

/**
 * Whether the app (thread) sidebar is collapsed off-canvas.
 *
 * The single predicate behind every "the sidebar vacated the top-left corner"
 * decision: which bar reserves room for the floating show-sidebar control, and
 * which one owns the desktop title bar. Gated on the desktop tier because the
 * phone shell never renders that sidebar — its `useSidebar()` state describes
 * a drawer that does not exist on screen.
 *
 * Call this instead of re-deriving it from `useSidebar()` so the chrome across
 * the chat header, the no-thread surface, and the workspace panel can never
 * drift apart.
 */
export function useAppSidebarCollapsed(): boolean {
  const { state } = useSidebar();
  const presentationTier = usePresentationTier();
  return state === "collapsed" && presentationTier === "desktop";
}
