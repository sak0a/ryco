import { useCallback, useEffect, useMemo, useRef } from "react";
import type * as React from "react";

export const LONG_PRESS_DELAY_MS = 450;
export const LONG_PRESS_MOVE_TOLERANCE_PX = 10;

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
  previousUserSelect: string;
  previousWebkitUserSelect: string;
  timer: number;
}

/**
 * Hand-rolled long-press recognizer for touch parity surfaces.
 *
 * Pointer-events based: a press fires after ~450ms unless the pointer moves
 * more than ~10px (scroll/drag wins), lifts, or is cancelled. While a press
 * is pending the target's text selection is suppressed via an inline
 * `user-select` guard (restored afterwards) so long-press never hijacks
 * selection; the synthetic `contextmenu` some platforms fire after a
 * long-press is swallowed so the action does not double-fire, and the
 * trailing click after a fired press is suppressed so the row underneath
 * does not also activate.
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

  const restoreSelectionGuard = useCallback((press: PressState) => {
    press.target.style.userSelect = press.previousUserSelect;
    press.target.style.webkitUserSelect = press.previousWebkitUserSelect;
  }, []);

  const cancelPress = useCallback(() => {
    const press = pressRef.current;
    if (!press) {
      return;
    }
    pressRef.current = null;
    window.clearTimeout(press.timer);
    restoreSelectionGuard(press);
  }, [restoreSelectionGuard]);

  useEffect(() => cancelPress, [cancelPress]);
  useEffect(() => {
    if (disabled) {
      cancelPress();
      firedRef.current = false;
    }
  }, [cancelPress, disabled]);

  return useMemo<LongPressHandlers>(
    () => ({
      onPointerDown: (event) => {
        if (disabled || !event.isPrimary || event.button !== 0) {
          return;
        }
        cancelPress();
        firedRef.current = false;
        const target = event.currentTarget;
        const startX = event.clientX;
        const startY = event.clientY;
        const press: PressState = {
          pointerId: event.pointerId,
          startX,
          startY,
          target,
          previousUserSelect: target.style.userSelect,
          previousWebkitUserSelect: target.style.webkitUserSelect,
          timer: window.setTimeout(() => {
            const activePress = pressRef.current;
            if (!activePress || activePress.pointerId !== press.pointerId) {
              return;
            }
            pressRef.current = null;
            restoreSelectionGuard(activePress);
            firedRef.current = true;
            onLongPressRef.current({ x: startX, y: startY });
          }, delayMs),
        };
        // Selection guard for the press window only; never a global override.
        target.style.userSelect = "none";
        target.style.webkitUserSelect = "none";
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
      },
      onPointerCancel: (event) => {
        const press = pressRef.current;
        if (press && press.pointerId === event.pointerId) {
          cancelPress();
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
        // A real desktop right-click (fine pointer, no press pending) is
        // untouched.
        if (firedRef.current || pressRef.current !== null) {
          event.preventDefault();
          event.stopPropagation();
          firedRef.current = false;
        }
      },
      onClickCapture: (event) => {
        if (firedRef.current) {
          event.preventDefault();
          event.stopPropagation();
          firedRef.current = false;
        }
      },
    }),
    [cancelPress, delayMs, disabled, moveTolerancePx, restoreSelectionGuard],
  );
}
