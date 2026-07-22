import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
import { glassSurfaceClassName } from "~/components/mobile/GlassSurface";

/**
 * The phone dock: a floating glass capsule carrying a surface's primary and
 * frequent actions within thumb reach.
 *
 * It is **not** a tab bar. Its contents are contextual per surface and it
 * offers no sibling navigation; the prior design's reasoning against a tab bar
 * is upheld, not amended.
 *
 * It is an **overlay, not layout**: the capsule is fixed above the bottom of
 * the visual viewport and content runs full-bleed underneath it. Surfaces add
 * `app-dock-scroll-clearance` to their scroll container so the last row can
 * clear the capsule; the utility is derived from the same variables this
 * component uses, so a Dock density change moves both.
 *
 * Anchoring comes entirely from `--app-dock-inset`: the software-keyboard
 * inset published by the app's single `VisualViewport` adapter, plus the bottom
 * safe area, plus the design's 16 px float. The dock therefore rides the
 * keyboard exactly as the composer does, and adds no resize listener of its
 * own.
 *
 * Presentation only: props in, callbacks out. No store, RPC, lifecycle, or
 * connectivity access lives in `components/mobile/`.
 *
 * Nothing here depends on a transition completing — the capsule is always
 * mounted, and the only transition is the action's own press feedback, which
 * `prefers-reduced-motion` collapses through the motion tokens.
 */

export interface MobileDockAction {
  readonly id: string;
  /**
   * The accessible name. It is also the visible text unless `shortLabel` is
   * given, in which case the short form must be contained in this one so the
   * visible label stays part of the accessible name (WCAG 2.5.3).
   */
  readonly label: string;
  readonly shortLabel?: string | undefined;
  /** Decorative — the label carries the accessible name. */
  readonly icon?: ReactNode | undefined;
  readonly disabled?: boolean | undefined;
  /**
   * Pressed state for an action that toggles a surface. Passing it — even as
   * `false` — makes the control announce its state through `aria-pressed`;
   * omitting it leaves a plain button.
   */
  readonly pressed?: boolean | undefined;
  readonly onSelect: () => void;
}

export interface MobileDockProps {
  /** Accessible name for the capsule's action group. */
  readonly label: string;
  readonly actions: ReadonlyArray<MobileDockAction>;
  /**
   * Rendered inside the capsule above the action row — the thread surface's
   * context strip, for example. Optional: most docks are an action row alone.
   */
  readonly children?: ReactNode | undefined;
  readonly className?: string | undefined;
}

export function MobileDock({ label, actions, children, className }: MobileDockProps) {
  return (
    // The positioning layer is inert so full-bleed content underneath the dock
    // stays scrollable and tappable everywhere the capsule does not cover.
    <div
      className={cn(
        "pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-3 pb-[var(--app-dock-inset)] pl-safe pr-safe",
        className,
      )}
      data-slot="mobile-dock-layer"
    >
      <div
        className={cn(
          glassSurfaceClassName("dock"),
          "pointer-events-auto flex min-w-0 max-w-full flex-col gap-2 rounded-[22px] border border-border/60 p-[var(--app-dock-padding)] text-foreground shadow-lg/10",
        )}
        data-slot="mobile-dock"
      >
        {children}
        <div
          role="group"
          aria-label={label}
          // The row scrolls rather than the page: at 320 px with the type scale
          // at 200 % a labelled action row can exceed the viewport, and a
          // page-level horizontal overflow is a defect the design rules out.
          className="flex min-w-0 items-center gap-1 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          data-slot="mobile-dock-actions"
        >
          {actions.map((action) => (
            <button
              key={action.id}
              type="button"
              aria-label={action.label}
              aria-pressed={action.pressed}
              disabled={action.disabled ?? false}
              // The 44 px floor is pinned in px, not in rem: the Text size
              // preference and browser zoom both scale rem, and a touch target
              // must not shrink with the type scale. Compact density reduces
              // the capsule's padding only, never this.
              className={cn(
                "flex min-h-[var(--app-dock-control-size)] min-w-[var(--app-dock-control-size)] shrink-0 items-center justify-center gap-1 rounded-full px-2 text-[11px] font-medium",
                "transition-colors duration-[var(--app-motion-duration-chip)] ease-[var(--app-motion-ease)] motion-reduce:transition-none",
                "hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                // Disabled text is WCAG-exempt, which is why the tier's
                // contrast floor is derived from the enabled label alone.
                "disabled:pointer-events-none disabled:text-muted-foreground/60",
                action.pressed === true && "bg-accent",
              )}
              data-slot="mobile-dock-action"
              onClick={action.onSelect}
            >
              {action.icon}
              <span className="truncate">{action.shortLabel ?? action.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
