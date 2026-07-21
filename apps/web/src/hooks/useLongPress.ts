import { useCallback, useEffect, useMemo, useRef } from "react";
import type * as React from "react";

export const LONG_PRESS_DELAY_MS = 450;
export const LONG_PRESS_MOVE_TOLERANCE_PX = 10;
const FIRED_RESET_AFTER_RELEASE_MS = 300;

export interface LongPressPoint {
  readonly x: number;
  readonly y: number;
}

export interface LongPressHandlers {
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerLeave: (event: React.PointerEvent<HTMLElement>) => void;
  onContextMenu: (event: React.MouseEvent<HTMLElement>) => void;
  onClickCapture: (event: React.MouseEvent<HTMLElement>) => void;
}

interface PressState {
  pointerId: number;
  startX: number;
  startY: number;
  target: HTMLElement;
  selectionGuarded: boolean;
  previousUserSelect: string;
  previousWebkitUserSelect: string;
  previousTouchCallout: string;
  timer: number;
}

/**
 * Innermost-wins coordination between nested recognizers: pointer events
 * bubble target-first, so the innermost recognizer claims the pointer id and
 * every ancestor recognizer seeing an already-claimed id skips the press.
 * Exactly one long-press can fire per pointer interaction.
 */
const claimedPointerIds = new Set<number>();

/**
 * Hand-rolled long-press recognizer for touch parity surfaces.
 *
 * Pointer-events based: a press fires after ~450ms unless the pointer moves
 * more than ~10px (scroll/drag wins), lifts, or is cancelled. While a
 * touch/pen press is pending, the target's text selection and the iOS link
 * callout are suppressed via inline style guards (restored afterwards) so
 * long-press never hijacks selection; mouse pointers keep native selection.
 * The synthetic `contextmenu` some platforms fire after a long-press is
 * swallowed so the action does not double-fire, and the trailing click after
 * a fired press is suppressed so the element underneath does not also
 * activate. The suppression flag self-heals — it resets shortly after the
 * pointer lifts and on the next pointerdown — so a later plain right-click
 * is never swallowed by stale state.
 */
export function useLongPress(
  onLongPress: (point: LongPressPoint) => void,
  options?: {
    readonly disabled?: boolean;
    readonly delayMs?: number;
    readonly moveTolerancePx?: number;
  },
): LongPressHandlers {
  const disabled = options?.disabled ?? false;
  const delayMs = options?.delayMs ?? LONG_PRESS_DELAY_MS;
  const moveTolerancePx = options?.moveTolerancePx ?? LONG_PRESS_MOVE_TOLERANCE_PX;
  const onLongPressRef = useRef(onLongPress);
  onLongPressRef.current = onLongPress;
  const pressRef = useRef<PressState | null>(null);
  const firedRef = useRef(false);
  const firedResetTimerRef = useRef<number | null>(null);

  const clearFiredResetTimer = useCallback(() => {
    if (firedResetTimerRef.current !== null) {
      window.clearTimeout(firedResetTimerRef.current);
      firedResetTimerRef.current = null;
    }
  }, []);

  const scheduleFiredReset = useCallback(() => {
    clearFiredResetTimer();
    firedResetTimerRef.current = window.setTimeout(() => {
      firedResetTimerRef.current = null;
      firedRef.current = false;
    }, FIRED_RESET_AFTER_RELEASE_MS);
  }, [clearFiredResetTimer]);

  const restoreInlineGuards = useCallback((press: PressState) => {
    if (!press.selectionGuarded) {
      return;
    }
    press.target.style.userSelect = press.previousUserSelect;
    press.target.style.webkitUserSelect = press.previousWebkitUserSelect;
    if (press.previousTouchCallout) {
      press.target.style.setProperty("-webkit-touch-callout", press.previousTouchCallout);
    } else {
      press.target.style.removeProperty("-webkit-touch-callout");
    }
  }, []);

  const cancelPress = useCallback(() => {
    const press = pressRef.current;
    if (!press) {
      return;
    }
    pressRef.current = null;
    claimedPointerIds.delete(press.pointerId);
    window.clearTimeout(press.timer);
    restoreInlineGuards(press);
  }, [restoreInlineGuards]);

  useEffect(
    () => () => {
      cancelPress();
      clearFiredResetTimer();
    },
    [cancelPress, clearFiredResetTimer],
  );
  useEffect(() => {
    if (disabled) {
      cancelPress();
      clearFiredResetTimer();
      firedRef.current = false;
    }
  }, [cancelPress, clearFiredResetTimer, disabled]);

  return useMemo<LongPressHandlers>(
    () => ({
      onPointerDown: (event) => {
        // Any new pointer interaction (including a right-button press)
        // clears stale post-fire suppression before the guards run.
        clearFiredResetTimer();
        firedRef.current = false;
        if (disabled || !event.isPrimary || event.button !== 0) {
          return;
        }
        // Innermost-wins: a nested recognizer closer to the target already
        // claimed this pointer during bubbling.
        if (claimedPointerIds.has(event.pointerId)) {
          return;
        }
        cancelPress();
        const target = event.currentTarget;
        const startX = event.clientX;
        const startY = event.clientY;
        // Selection/callout guards apply to touch and pen presses only; a
        // mouse press-and-drag must keep native text selection.
        const selectionGuarded = event.pointerType === "touch" || event.pointerType === "pen";
        const press: PressState = {
          pointerId: event.pointerId,
          startX,
          startY,
          target,
          selectionGuarded,
          previousUserSelect: target.style.userSelect,
          previousWebkitUserSelect: target.style.webkitUserSelect,
          previousTouchCallout: target.style.getPropertyValue("-webkit-touch-callout"),
          timer: window.setTimeout(() => {
            const activePress = pressRef.current;
            if (!activePress || activePress.pointerId !== press.pointerId) {
              return;
            }
            pressRef.current = null;
            claimedPointerIds.delete(activePress.pointerId);
            restoreInlineGuards(activePress);
            firedRef.current = true;
            onLongPressRef.current({ x: startX, y: startY });
          }, delayMs),
        };
        if (selectionGuarded) {
          target.style.userSelect = "none";
          target.style.webkitUserSelect = "none";
          // iOS long-press link callout suppression; a no-op elsewhere.
          target.style.setProperty("-webkit-touch-callout", "none");
        }
        claimedPointerIds.add(press.pointerId);
        pressRef.current = press;
      },
      onPointerMove: (event) => {
        const press = pressRef.current;
        if (!press || press.pointerId !== event.pointerId) {
          return;
        }
        const deltaX = event.clientX - press.startX;
        const deltaY = event.clientY - press.startY;
        if (Math.hypot(deltaX, deltaY) > moveTolerancePx) {
          cancelPress();
        }
      },
      onPointerUp: (event) => {
        const press = pressRef.current;
        if (press && press.pointerId === event.pointerId) {
          cancelPress();
        }
        if (firedRef.current) {
          // The trailing click (if any) arrives right after release; heal
          // the suppression flag shortly after so stale state cannot
          // swallow a later interaction on this element.
          scheduleFiredReset();
        }
      },
      onPointerCancel: (event) => {
        const press = pressRef.current;
        if (press && press.pointerId === event.pointerId) {
          cancelPress();
        }
        if (firedRef.current) {
          scheduleFiredReset();
        }
      },
      onPointerLeave: (event) => {
        const press = pressRef.current;
        if (press && press.pointerId === event.pointerId) {
          cancelPress();
        }
      },
      onContextMenu: (event) => {
        // Swallow the synthetic contextmenu double-fire from a long-press.
        // A real desktop right-click (no press pending, no recent fire) is
        // untouched.
        if (firedRef.current || pressRef.current !== null) {
          event.preventDefault();
          event.stopPropagation();
          clearFiredResetTimer();
          firedRef.current = false;
        }
      },
      onClickCapture: (event) => {
        if (firedRef.current) {
          event.preventDefault();
          event.stopPropagation();
          clearFiredResetTimer();
          firedRef.current = false;
        }
      },
    }),
    [
      cancelPress,
      clearFiredResetTimer,
      delayMs,
      disabled,
      moveTolerancePx,
      restoreInlineGuards,
      scheduleFiredReset,
    ],
  );
}
