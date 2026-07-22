/**
 * Effective touch-target measurement for browser tests.
 *
 * A bounding box is the wrong instrument. `getBoundingClientRect()` cannot see
 * an `::after` hit slop, so a box assertion passes against a control whose slop
 * is present but inert — and it equally cannot see an ancestor that CLIPS that
 * slop, which is the failure mode the phone diff surface actually had: the file
 * collapse control declared `after:size-11` and measured 32x32 of real reach,
 * because `.diff-render-file` is `overflow: clip`.
 *
 * So the measurement walks outward from the control's centre one pixel at a
 * time with `document.elementFromPoint` until the hit stops resolving to the
 * control, exactly as `components/ui/toggle.browser.tsx` does.
 */

export interface EffectiveHitTarget {
  readonly width: number;
  readonly height: number;
  readonly left: number;
  readonly right: number;
  readonly up: number;
  readonly down: number;
}

function reach(
  element: Element,
  fromX: number,
  fromY: number,
  stepX: number,
  stepY: number,
  limit: number,
): number {
  for (let distance = 1; distance <= limit; distance += 1) {
    const target = document.elementFromPoint(fromX + stepX * distance, fromY + stepY * distance);
    if (!target || (target !== element && !element.contains(target))) {
      return distance - 1;
    }
  }
  return limit;
}

/**
 * Measures how far the control's hit area actually reaches on each axis.
 *
 * Throws when the control's own centre does not hit-test to it: an occluded or
 * off-screen control has no effective target at all, and silently reporting
 * `0x0` would let a caller's `>= 44` assertion look like an ordinary sizing
 * failure instead of the harness fault it usually is.
 */
export function measureEffectiveHitTarget(element: Element, limit = 120): EffectiveHitTarget {
  const rect = element.getBoundingClientRect();
  const centreX = rect.left + rect.width / 2;
  const centreY = rect.top + rect.height / 2;
  const atCentre = document.elementFromPoint(centreX, centreY);
  if (!atCentre || (atCentre !== element && !element.contains(atCentre))) {
    throw new Error(
      `The control does not hit-test at its own centre (${Math.round(centreX)}, ${Math.round(
        centreY,
      )}); it is occluded or outside the viewport, so it has no effective touch target.`,
    );
  }

  const left = reach(element, centreX, centreY, -1, 0, limit);
  const right = reach(element, centreX, centreY, 1, 0, limit);
  const up = reach(element, centreX, centreY, 0, -1, limit);
  const down = reach(element, centreX, centreY, 0, 1, limit);
  return { width: left + right + 1, height: up + down + 1, left, right, up, down };
}
