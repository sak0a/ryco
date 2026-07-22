"use client";

import { Drawer } from "@base-ui/react/drawer";
import { XIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import { glassSurfaceClassName } from "~/components/mobile/GlassSurface";

/**
 * The phone bottom-sheet primitive, built on `@base-ui/react`'s `Drawer`.
 *
 * `ui/sheet.tsx` stays the desktop side-panel primitive and is not merged into
 * this one. What this adds over a `SheetPopup side="bottom"`:
 *
 * - **Detents.** `snapPoints` gives a medium and a large stop; the opening
 *   detent is selectable per call site and swiping between them is Base UI's.
 * - **Swipe-to-dismiss** through `swipeDirection="down"`, plus a grabber.
 * - **Safe areas and the keyboard inset are applied by the primitive**, not by
 *   every call site. Migrated call sites must not hand-roll `pb-safe`.
 * - Leading-corner radius, and the house motion curve instead of `ease-in-out`.
 *
 * Presentation only: props in, callbacks out. No store, RPC, lifecycle, or
 * connectivity access lives in `components/mobile/`.
 *
 * Correctness never depends on animation completion — Base UI commits the open
 * state and the active snap point on gesture resolution, and `prefers-reduced-
 * motion` collapses the transitions to an instantaneous state change.
 */

/** Detent identifiers. `medium` is roughly half the viewport, `large` is the sheet's full height. */
export type MobileSheetDetent = "medium" | "large";

/**
 * Fractions of the viewport height. Base UI clamps each point to the popup's
 * own height, so a short sheet collapses both points onto its content height
 * and simply has no medium detent.
 */
const MEDIUM_SNAP_POINT = 0.5;
const LARGE_SNAP_POINT = 1;
// A single stable array: Base UI keys its snap-point memoisation on identity.
const SNAP_POINTS: Drawer.Root.SnapPoint[] = [MEDIUM_SNAP_POINT, LARGE_SNAP_POINT];

function snapPointForDetent(detent: MobileSheetDetent): number {
  return detent === "medium" ? MEDIUM_SNAP_POINT : LARGE_SNAP_POINT;
}

function detentForSnapPoint(snapPoint: Drawer.Root.SnapPoint | null): MobileSheetDetent | null {
  if (snapPoint === null || snapPoint === undefined) return null;
  return snapPoint === MEDIUM_SNAP_POINT ? "medium" : "large";
}

export interface MobileSheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Accessible name for the sheet, mirroring the `aria-label` the call sites already pass. */
  readonly label: string;
  /**
   * Opening detent. `large` (the default) reproduces the bottom-anchored,
   * content-height sheet; `medium` opens at the half-viewport stop.
   */
  readonly detent?: MobileSheetDetent | undefined;
  /**
   * Fires when the active detent changes.
   *
   * Not gesture-only: Base UI's `DrawerRoot` resets the active snap point to
   * the default on every close, and reports that reset through the same
   * callback. Consumers therefore also see one call with the opening detent
   * each time the sheet is dismissed.
   */
  readonly onDetentChange?: ((detent: MobileSheetDetent | null) => void) | undefined;
  /**
   * Controls the active detent. Omit it — the common case — and the sheet is
   * uncontrolled: it opens at `detent` and the gesture owns it from there.
   * Passing it lets a call site move the sheet itself, which the select sheet
   * does when its search field takes focus and the keyboard needs somewhere to
   * go. A controlled call site must mirror `onDetentChange` back into this
   * prop, or a swipe will be reverted on the next render.
   */
  readonly activeDetent?: MobileSheetDetent | null | undefined;
  readonly className?: string | undefined;
  readonly children?: ReactNode | undefined;
}

export function MobileSheet({
  open,
  onOpenChange,
  label,
  detent = "large",
  onDetentChange,
  activeDetent,
  className,
  children,
}: MobileSheetProps) {
  return (
    <Drawer.Root
      open={open}
      onOpenChange={onOpenChange}
      swipeDirection="down"
      snapPoints={SNAP_POINTS}
      defaultSnapPoint={snapPointForDetent(detent)}
      {...(activeDetent === undefined
        ? {}
        : { snapPoint: activeDetent === null ? null : snapPointForDetent(activeDetent) })}
      onSnapPointChange={(snapPoint) => onDetentChange?.(detentForSnapPoint(snapPoint))}
    >
      <Drawer.Portal>
        <Drawer.Backdrop
          className={cn(
            "app-sheet-backdrop fixed inset-0 z-50 backdrop-blur-sm",
            // The scrim is opaque for the whole time the sheet is modal, and
            // fades only on enter and exit.
            //
            // It must NOT be driven from `--drawer-swipe-progress`: that
            // variable is snap-point-normalised, not dismissal-normalised.
            // Base UI pushes it from `DrawerViewport`'s at-rest branch too, so
            // with two snap points a sheet simply *resting* at the medium
            // detent reports progress 1. Deriving opacity from it rendered a
            // fully transparent scrim over a page that is still focus-trapped,
            // scroll-locked and pointer-blocked. Base UI exposes no true
            // dismissal-progress signal, so none is faked here.
            "transition-opacity duration-[var(--app-motion-duration-sheet)] ease-[var(--app-motion-ease)] data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:transition-none",
          )}
          data-slot="mobile-sheet-backdrop"
        />
        <Drawer.Viewport
          className={cn(
            "pointer-events-auto fixed inset-0 z-50 flex flex-col justify-end pt-12",
            // The keyboard inset comes from the single visual-viewport adapter;
            // the variable is unset (0) when no software keyboard is showing.
            "pb-[var(--app-keyboard-inset,0px)]",
          )}
          data-slot="mobile-sheet-viewport"
        >
          <Drawer.Popup
            aria-label={label}
            className={cn(
              // The sheet material tier: the largest blur, and the coverage
              // floor that keeps its text above AA over the worst-case
              // backdrop. It replaces `app-surface`, which carried the same
              // popover colour but no floor, blur or scrim.
              glassSurfaceClassName("sheet"),
              "pointer-events-auto flex max-h-full min-h-0 w-full min-w-0 flex-col rounded-t-2xl border-t not-dark:bg-clip-padding text-popover-foreground shadow-lg/5",
              // Full-width sheets render edge to edge, so they pad the
              // landscape side insets and the bottom safe area themselves —
              // call sites must not repeat `pb-safe`.
              "pb-safe pl-safe pr-safe",
              // Detent offset and live swipe movement share the `translate`
              // property with the enter/exit position.
              "translate-y-[calc(var(--drawer-snap-point-offset,0px)+var(--drawer-swipe-movement-y,0px))] data-ending-style:translate-y-full data-starting-style:translate-y-full",
              "transition-[translate,scale] duration-[var(--app-motion-duration-sheet)] ease-[var(--app-motion-ease)] will-change-transform motion-reduce:transition-none",
              // Stacking, not nesting: a sheet opened from this one pushes this
              // one back instead of rendering inside it.
              "data-nested-drawer-open:scale-96",
              className,
            )}
            // Kept as `sheet-popup` deliberately: it is the app-wide contract
            // for "an open sheet surface" that `keybindings.ts` uses to detect
            // dialog-like overlays. `data-mobile-sheet` distinguishes the tier.
            data-slot="sheet-popup"
            data-mobile-sheet=""
            onKeyDown={(event) => {
              event.stopPropagation();
            }}
          >
            {/* Drag affordance only: deliberately not the close control, and
                deliberately not a `button`. Base UI's swipe ignores gestures
                that start on `button,a,input,select,textarea,label,[role=button]`
                for non-touch pointers, so making the grabber interactive would
                remove pointer-driven swipe-to-dismiss from it. */}
            <span
              aria-hidden
              className="mx-auto mt-2 mb-1 h-1 w-9 shrink-0 rounded-full bg-muted-foreground/32"
              data-slot="mobile-sheet-grabber"
            />
            {children}
            {/* The named, non-destructive exit. Swipe and backdrop press are
                additional dismissals, not replacements: without this a screen
                reader user could only leave a sheet of destructive actions by
                activating one of them. `Button` supplies the coarse-pointer
                hit slop, so the 32px icon still resolves a 44px target. */}
            <Drawer.Close
              aria-label="Close"
              className="absolute end-2 top-2 z-20"
              data-slot="mobile-sheet-close"
              render={<Button size="icon" variant="ghost" />}
            >
              <XIcon />
            </Drawer.Close>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

export function MobileSheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      // `pe-11` reserves the close control's corner so a long title never
      // runs underneath it.
      className={cn("flex shrink-0 flex-col gap-1 px-4 pt-2 pe-11 pb-3", className)}
      data-slot="mobile-sheet-header"
      {...props}
    />
  );
}

export function MobileSheetTitle({ className, ...props }: Drawer.Title.Props) {
  return (
    <Drawer.Title
      className={cn("truncate font-heading font-semibold text-base leading-tight", className)}
      data-slot="mobile-sheet-title"
      {...props}
    />
  );
}

export function MobileSheetDescription({ className, ...props }: Drawer.Description.Props) {
  return (
    <Drawer.Description
      className={cn("text-muted-foreground text-sm", className)}
      data-slot="mobile-sheet-description"
      {...props}
    />
  );
}

/**
 * The scrollable body. `Drawer.Content` marks it as the drawer's content
 * region so a drag that starts inside it scrolls instead of dragging the sheet
 * until the scroll reaches its edge.
 *
 * This uses a native `overflow-y-auto` box rather than the repository's
 * `ScrollArea` on purpose: Base UI's touch arbitration walks the ancestor
 * chain looking for a *native* scrollable element to decide between scrolling
 * the content and dragging the sheet, and a custom scroll container is
 * invisible to that walk. The cost is the loss of `SheetPanel`'s scroll fade
 * on the phone tier, which is accepted.
 */
export function MobileSheetPanel({ className, ...props }: Drawer.Content.Props) {
  return (
    <Drawer.Content
      className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-2", className)}
      data-slot="mobile-sheet-panel"
      {...props}
    />
  );
}

export function MobileSheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex shrink-0 flex-col-reverse gap-2 px-4 pt-3 pb-2 sm:flex-row", className)}
      data-slot="mobile-sheet-footer"
      {...props}
    />
  );
}
