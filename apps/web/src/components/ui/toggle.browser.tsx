// Production CSS is part of the behavior under test: the hit slop is a
// `::after` pseudo-element, so only real hit testing can prove it.
import "../../index.css";

import { afterEach, describe, expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";

import { resetPointerEmulation, setCoarsePointerEmulation } from "../../../test/browserPointer";
import { Toggle } from "./toggle";

const TOGGLE_LABEL = "Toggle wrap";

function toggleElement(): HTMLElement {
  const element = document.querySelector<HTMLElement>('[data-slot="toggle"]');
  if (!element) throw new Error("Expected the toggle to be rendered.");
  return element;
}

/**
 * Walks outward from a point one pixel at a time until the hit test stops
 * resolving to the control, and returns how far the control's hit area
 * actually reaches. This is the only way to measure a `::after` hit slop:
 * `getBoundingClientRect` never sees it and a class-name assertion proves
 * nothing about where the pseudo-element actually lands.
 *
 * Measured caveat: Chromium places the static position of an absolutely
 * positioned `::after` on a `justify-center items-center` flex container at
 * that container's centre, so this assertion also holds on the pre-fix class
 * string in this engine. The explicit centring anchor is kept anyway — it
 * matches `ui/button.tsx` and removes the dependency on an engine-specific
 * static position — but the discriminating case is a physical-device check,
 * not this test.
 */
function hitReach(
  element: HTMLElement,
  fromX: number,
  fromY: number,
  stepX: number,
  stepY: number,
  limit = 200,
): number {
  for (let distance = 1; distance <= limit; distance += 1) {
    const target = document.elementFromPoint(fromX + stepX * distance, fromY + stepY * distance);
    if (!target || (target !== element && !element.contains(target))) {
      return distance - 1;
    }
  }
  return limit;
}

describe("Toggle", () => {
  let mounted: Awaited<ReturnType<typeof render>> | null = null;

  afterEach(async () => {
    await mounted?.unmount();
    mounted = null;
    document.body.innerHTML = "";
    await resetPointerEmulation();
    await page.viewport(1_280, 720);
  });

  it("centres its coarse-pointer hit slop on the control so it reaches 44px on both axes", async () => {
    // Desktop viewport with a coarse pointer: the hit slop is a
    // coarse-pointer behavior, not a phone-tier one, so the fix is
    // desktop-visible and covered here on the desktop baseline.
    await page.viewport(1_280, 720);
    await setCoarsePointerEmulation(true);

    mounted = await render(
      <div className="flex h-screen items-center justify-center">
        <Toggle aria-label={TOGGLE_LABEL} size="xs" />
      </div>,
    );
    expect(window.matchMedia("(pointer: coarse)").matches).toBe(true);

    const toggle = toggleElement();
    const rect = toggle.getBoundingClientRect();
    // The border box is smaller than the touch floor, so the slop is what has
    // to make up the difference.
    expect(rect.height).toBeLessThan(44);
    expect(rect.width).toBeLessThan(44);

    const centreX = rect.left + rect.width / 2;
    const centreY = rect.top + rect.height / 2;
    expect(document.elementFromPoint(centreX, centreY)?.closest("[data-slot=toggle]")).toBe(toggle);

    const up = hitReach(toggle, centreX, centreY, 0, -1);
    const down = hitReach(toggle, centreX, centreY, 0, 1);
    const left = hitReach(toggle, centreX, centreY, -1, 0);
    const right = hitReach(toggle, centreX, centreY, 1, 0);

    // Centred: the slop reaches at least 22px in every direction from the
    // control's centre, so the effective target is 44px on both axes.
    expect(up, "hit slop above the centre").toBeGreaterThanOrEqual(21);
    expect(down, "hit slop below the centre").toBeGreaterThanOrEqual(21);
    expect(left, "hit slop left of the centre").toBeGreaterThanOrEqual(21);
    expect(right, "hit slop right of the centre").toBeGreaterThanOrEqual(21);
    expect(up + down + 1, "total vertical hit target").toBeGreaterThanOrEqual(44);
    expect(left + right + 1, "total horizontal hit target").toBeGreaterThanOrEqual(44);
  });
});
