import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
import { glassSurfaceClassName } from "~/components/mobile/GlassSurface";

/**
 * The phone status chip: the minimal always-visible form of a state that also
 * has an expanded presentation. It is an icon plus a short status word, and
 * nothing else.
 *
 * **Text and icon, never colour alone.** The status word is always rendered;
 * the icon is decorative and `label` carries the accessible name, so the chip
 * stays readable with colour perception removed and with an assistive
 * technology that never sees the glyph.
 *
 * **Identity yields to state.** A phone app bar cannot hold both an identity
 * and a state without truncating both — the audited connection pill was 176 px
 * wide and rendered `MacBook Pro M5… On…`, neither half readable, leaving the
 * title 132 px at 320 px. So the chip renders the state only and the caller
 * puts identity in `label`, where a reader still gets it and no pixel budget is
 * spent on it.
 *
 * **The chip caps its own width, and the cap is in px.** `max-w-[136px]` plus
 * `min-w-0 truncate` on the label is what makes the chip give space back; it
 * cannot be left to the neighbour, because every app bar here pairs the chip
 * with a `flex-1 min-w-0` title whose hypothetical main size is zero. Such a
 * line has positive free space at any type scale, so the chip is never *asked*
 * to shrink and the title absorbs the whole cost instead — measured at 320 px,
 * an uncapped chip took 250 px at a 200 % type scale and left the title 9.7 px,
 * reproducing the audited defect. The cap is pinned in px for the same reason
 * `MobileDock` pins its touch floor in px: the Text size preference and browser
 * zoom both scale rem, and a width cap that grows with the type scale caps
 * nothing. `shrink` still matters for a row whose other items have intrinsic
 * width, where the chip must yield rather than overflow the row.
 *
 * **The real box is the touch target.** `min-h-11 min-w-11` sizes the border
 * box to the 44 px floor instead of leaning on a `::after` hit slop: slop is
 * invisible to `getBoundingClientRect` and any ancestor with `overflow-hidden`
 * or `overflow-x-auto` clips it. `MobileStatusChip.browser.tsx` still measures
 * the target with an outward `elementFromPoint` walk rather than trusting the
 * box.
 *
 * Presentation only: props in, callbacks out. No store, RPC, lifecycle, or
 * connectivity access lives in `components/mobile/`.
 */

export interface MobileStatusChipProps {
  /**
   * The accessible name. The caller owns it because only the caller knows the
   * full state — the hosted chip passes node identity plus the complete
   * bounded status text.
   */
  readonly label: string;
  /** The short status label. Always rendered; truncates only at the cap. */
  readonly status: string;
  /** Decorative — `label` carries the accessible name. */
  readonly icon?: ReactNode | undefined;
  readonly onClick?: (() => void) | undefined;
  readonly testId?: string | undefined;
  readonly className?: string | undefined;
}

export function MobileStatusChip({
  label,
  status,
  icon,
  onClick,
  testId,
  className,
}: MobileStatusChipProps) {
  return (
    <button
      type="button"
      aria-label={label}
      data-slot="mobile-status-chip"
      data-testid={testId}
      className={cn(
        // The `chip` material tier: the smallest blur and the tightest
        // coverage floor, because a chip is small and sits directly over
        // scrolling content.
        glassSurfaceClassName("chip"),
        // The px width cap and the px touch floor bracket the chip at both
        // ends of the type scale; `shrink` covers the over-constrained row.
        "flex min-h-11 min-w-11 max-w-[136px] shrink items-center justify-center gap-1.5 rounded-full border border-border px-2.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      onClick={onClick}
    >
      {icon}
      {/* No `capitalize`: the caller's label is already cased, and a
          text-transform would render a two-word label as Title Case. */}
      <span data-slot="mobile-status-chip-status" className="min-w-0 truncate">
        {status}
      </span>
    </button>
  );
}
