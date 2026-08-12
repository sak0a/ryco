import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
import { HubWordmark } from "./HubWordmark";
import { HUB_MEASURE_CLASS_NAME } from "./hubLayout";

/**
 * The Hub's primary navigation.
 *
 * Deliberately a top bar, not a rail. The node app's identity is a collapsible,
 * resizable left sidebar built for an unbounded project tree; reusing it is the
 * single most recognisable way the Hub would keep feeling like the desktop app.
 * A Hub has a handful of destinations, so a bar is both the different navigation
 * that was asked for and the honest shape for the content.
 *
 * `app-chrome-glass` is the same chrome material the app's own bars use, so the
 * Hub diverges in structure while sharing the design language. It is already
 * handled in the reduced-transparency and forced-colors enforcement blocks.
 */
export function HubTopBar({
  nav,
  trailing,
}: {
  readonly nav?: ReactNode;
  readonly trailing?: ReactNode;
}) {
  return (
    <header
      className={cn(
        // Layout, not an overlay: `HubShell` puts the bar outside the scroll
        // track, so it holds its place without `sticky` and the page below it
        // keeps a clean `overscroll-contain` scroller.
        "app-chrome-glass shrink-0 border-border/60 border-b",
        // The bar sits under the notch on an edge-to-edge viewport, so its own
        // top padding absorbs the inset rather than letting content slide beneath.
        "pt-[env(safe-area-inset-top)]",
      )}
    >
      <div
        className={cn(
          "mx-auto flex h-14 w-full items-center gap-3 px-4 sm:px-6",
          HUB_MEASURE_CLASS_NAME.page,
        )}
      >
        <HubWordmark />
        {nav === undefined ? null : (
          <nav aria-label="Hub" className="min-w-0 flex-1">
            {nav}
          </nav>
        )}
        {nav === undefined ? <div className="flex-1" /> : null}
        {trailing === undefined ? null : (
          <div className="flex shrink-0 items-center gap-1">{trailing}</div>
        )}
      </div>
    </header>
  );
}
