/**
 * The load-bearing layout constants every Hub surface shares.
 *
 * These are extracted rather than inlined because three of them are not styling
 * — they are fixes for specific, reproduced layout failures, and a surface that
 * quietly drops one reintroduces the bug. Each is documented where it is
 * defined so a future Hub page inherits the reasoning with the class string.
 */

/**
 * The scroll track. `#root` is `overflow-y: hidden`, so a Hub surface taller
 * than the viewport is clipped with no way to reach its primary action — at
 * 320x568 "Sign in with passkey" fell below the fold. Every Hub surface
 * therefore owns its own vertical scroll.
 *
 * `overscroll-contain` stops a scroll gesture that reaches the end of a Hub
 * page from chaining to the document behind it.
 */
export const HUB_SCROLL_TRACK_CLASS_NAME =
  "h-dvh overflow-x-hidden overflow-y-auto overscroll-contain text-foreground";

/**
 * Safe-area-aware edge padding, so Hub surfaces stay fully reachable on
 * notched, edge-to-edge phone viewports.
 */
export const HUB_EDGE_PADDING_CLASS_NAME =
  "px-4 sm:px-6 phone:px-[max(1rem,env(safe-area-inset-left),env(safe-area-inset-right))] phone:pt-[max(2.5rem,calc(env(safe-area-inset-top)+1rem))] phone:pb-[max(2.5rem,calc(env(safe-area-inset-bottom)+1rem))]";

/**
 * Vertical centring for a gateway column.
 *
 * `my-auto` on a `min-h-full` flex track, deliberately NOT `items-center`:
 * centring by alignment clips the overflowing top edge once the content is
 * taller than the viewport, which is exactly the case this has to survive.
 */
export const HUB_CENTERED_TRACK_CLASS_NAME = "flex min-h-full flex-col";

/**
 * The measures a Hub surface may use.
 *
 * - `form` — a single-column ceremony (sign in, signup step, reset step). Held
 *   near 28rem because a credential form reads badly wider.
 * - `content` — a page of prose or a short list (node detail, account section).
 * - `page` — the full Hub page measure for lists and multi-column sections.
 *   A real page measure, not a settings card.
 */
export const HUB_MEASURE_CLASS_NAME = {
  form: "max-w-[28rem]",
  content: "max-w-3xl",
  page: "max-w-5xl",
} as const;

export type HubMeasure = keyof typeof HUB_MEASURE_CLASS_NAME;
