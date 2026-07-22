import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
import { glassSurfaceClassName } from "~/components/mobile/GlassSurface";

/**
 * The phone context strip: a horizontally scrollable rail of contextual pills.
 *
 * The rail scrolls, the page does not. That is the whole point of the
 * primitive — a narrow viewport never has to fit every pill, and no width
 * introduces page-level horizontal overflow. Momentum scrolling is the
 * platform's; the desktop scrollbar is suppressed, and a trailing edge fade
 * makes off-screen pills discoverable. The fade sits over the rail's trailing
 * edge, so when the pills do fit it covers empty space and is invisible.
 *
 * Pills render on the `chip` material tier — the same tier as the connection
 * indicator, per the design's tier table — so their contrast guarantee is the
 * chip floor asserted in `GlassSurface.browser.tsx`.
 *
 * **Sizing contract.** The root sets `min-width: 0` and hides its own overflow,
 * which is enough wherever the ancestor chain is sized by the viewport. Inside
 * an ancestor sized to **max-content**, `min-width: 0` does not stop a flex
 * item from contributing its own content width, so a call site in that
 * position must give the strip a zero base width (`w-0 grow` rather than
 * `flex-1`). `PhoneThreadDock` is exactly that case and says so.
 *
 * Presentation only: props in, callbacks out. No store, RPC, lifecycle, or
 * connectivity access lives in `components/mobile/`.
 */

export interface MobileContextStripItem {
  readonly id: string;
  /**
   * The pill's name. It is the visible leading text and, together with
   * `value`, the accessible name.
   */
  readonly label: string;
  /** The current value this pill reports, rendered after the label. */
  readonly value?: string | undefined;
  /** Decorative — the label carries the accessible name. */
  readonly icon?: ReactNode | undefined;
  readonly disabled?: boolean | undefined;
  /**
   * Selected state for a pill that is one of a set. Passing it — even as
   * `false` — makes the pill announce its state through `aria-pressed`.
   */
  readonly selected?: boolean | undefined;
  readonly onSelect: () => void;
}

export interface MobileContextStripProps {
  /** Accessible name for the rail. */
  readonly label: string;
  readonly items: ReadonlyArray<MobileContextStripItem>;
  readonly className?: string | undefined;
}

export function MobileContextStrip({ label, items, className }: MobileContextStripProps) {
  if (items.length === 0) return null;
  return (
    <div className={cn("relative min-w-0", className)} data-slot="mobile-context-strip">
      <div
        role="group"
        aria-label={label}
        // No gutter for the focus indicator: `overflow-x: auto` forces the
        // block axis to `auto` too, so the rail clips on all four sides and a
        // negative-margin gutter would only push the clip outside the strip.
        // The indicator is inset instead — see the pill's classes below.
        className="flex min-w-0 items-center gap-1.5 overflow-x-auto overscroll-x-contain pe-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        data-slot="mobile-context-strip-rail"
      >
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={item.selected}
            disabled={item.disabled ?? false}
            // The 44 px floor is pinned in px so neither the Text size
            // preference nor browser zoom can shrink the target.
            className={cn(
              glassSurfaceClassName("chip"),
              "flex min-h-[var(--app-dock-control-size)] min-w-[var(--app-dock-control-size)] shrink-0 items-center gap-1.5 rounded-full border border-border/60 px-3 text-xs",
              "transition-colors duration-[var(--app-motion-duration-chip)] ease-[var(--app-motion-ease)] motion-reduce:transition-none",
              // Inset, not outset: an outset ring compiles to a box-shadow
              // outside the border box, which the scrolling rail clips —
              // keyboard and switch users would silently lose the indicator
              // these actions had as sheet rows.
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
              "disabled:pointer-events-none disabled:text-muted-foreground/60",
              item.selected === true && "ring-1 ring-ring/50",
            )}
            data-slot="mobile-context-strip-pill"
            onClick={item.onSelect}
          >
            {item.icon}
            <span className="max-w-40 truncate font-medium">{item.label}</span>
            {item.value === undefined ? null : (
              <span className="max-w-40 truncate text-muted-foreground">{item.value}</span>
            )}
          </button>
        ))}
      </div>
      {/* Edge affordance. Decorative and inert: it must never take a tap that
          belongs to the pill underneath it. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 end-0 w-4 bg-gradient-to-l from-background/80 to-transparent"
        data-slot="mobile-context-strip-edge"
      />
    </div>
  );
}
