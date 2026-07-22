// Production CSS is part of the behavior under test: the 44px touch target,
// the truncation order, and the material tier are all classes, not constants
// in the component.
import "../../index.css";

import { WifiIcon } from "lucide-react";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";

import { resetPointerEmulation, setCoarsePointerEmulation } from "../../../test/browserPointer";
import { MobileStatusChip } from "./MobileStatusChip";

const PHONE_VIEWPORT = { width: 390, height: 844 } as const;

function chip(): HTMLButtonElement {
  const element = document.querySelector<HTMLButtonElement>('[data-slot="mobile-status-chip"]');
  if (!element) throw new Error("Expected the status chip to be rendered.");
  return element;
}

function statusPart(): HTMLElement {
  const element = document.querySelector<HTMLElement>('[data-slot="mobile-status-chip-status"]');
  if (!element) throw new Error("Expected the status word to be rendered.");
  return element;
}

/**
 * Walks outward from a point one pixel at a time until the hit test stops
 * resolving to the control, and returns how far the control's hit area
 * actually reaches — the technique `ui/toggle.browser.tsx` established.
 *
 * A bounding-box assertion is not a substitute: `getBoundingClientRect` never
 * sees an `::after` hit slop, so it passes against a control whose slop is
 * present but inert because an ancestor clips it. This chip deliberately sizes
 * its real border box instead of leaning on slop, and this walk is what proves
 * the target survives the clipping ancestors the app bar puts around it.
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

describe("MobileStatusChip", () => {
  let mounted: Awaited<ReturnType<typeof render>> | null = null;

  afterEach(async () => {
    await mounted?.unmount();
    mounted = null;
    document.body.innerHTML = "";
    await resetPointerEmulation();
    await page.viewport(1_280, 720);
  });

  it("reaches 44px on both axes by hit test even inside clipping ancestors", async () => {
    await page.viewport(PHONE_VIEWPORT.width, PHONE_VIEWPORT.height);
    await setCoarsePointerEmulation(true);

    mounted = await render(
      // The ancestors that made the previous step's model pill measure 28px:
      // `overflow-hidden` and `overflow-x-auto` each clip a `::after` hit
      // slop. The chip's target has to survive both, which is why it sizes the
      // real box.
      <div className="flex h-screen items-center justify-center overflow-hidden">
        <div className="flex min-w-0 items-center overflow-x-auto">
          <MobileStatusChip label="Connection: Studio node, Online" status="Online" />
        </div>
      </div>,
    );
    expect(window.matchMedia("(pointer: coarse)").matches).toBe(true);

    const element = chip();
    const rect = element.getBoundingClientRect();
    const centreX = rect.left + rect.width / 2;
    const centreY = rect.top + rect.height / 2;
    expect(
      document.elementFromPoint(centreX, centreY)?.closest("[data-slot=mobile-status-chip]"),
    ).toBe(element);

    const up = hitReach(element, centreX, centreY, 0, -1);
    const down = hitReach(element, centreX, centreY, 0, 1);
    const left = hitReach(element, centreX, centreY, -1, 0);
    const right = hitReach(element, centreX, centreY, 1, 0);
    expect(up + down + 1, "hit-tested vertical target").toBeGreaterThanOrEqual(44);
    expect(left + right + 1, "hit-tested horizontal target").toBeGreaterThanOrEqual(44);
  });

  it("renders the status word and an icon, so no state is carried by colour alone", async () => {
    await page.viewport(PHONE_VIEWPORT.width, PHONE_VIEWPORT.height);
    mounted = await render(
      <MobileStatusChip
        label="Connection: Studio node, Reconnecting"
        status="Reconnecting"
        icon={<WifiIcon aria-hidden className="size-3.5 shrink-0" />}
      />,
    );

    const element = chip();
    expect(element.textContent).toContain("Reconnecting");
    expect(element.querySelector("svg")).not.toBeNull();
    // No text-transform: the caller's label is already cased, and capitalizing
    // would render a two-word label such as "No access" as "No Access".
    expect(getComputedStyle(statusPart()).textTransform).toBe("none");
    expect(element.getAttribute("aria-label")).toBe("Connection: Studio node, Reconnecting");
    // The icon is decorative, so the accessible name is the label alone, and
    // it carries the identity the chip does not spend pixels on.
    await expect
      .element(page.getByRole("button", { name: "Connection: Studio node, Reconnecting" }))
      .toBeVisible();
  });

  it("keeps the widest short label whole in a 320px bar and leaves the title the larger share", async () => {
    await page.viewport(320, 568);
    mounted = await render(
      <div className="flex items-center gap-1.5 px-3">
        <h1 className="min-w-0 flex-1 truncate text-base font-semibold">Threads</h1>
        <MobileStatusChip
          // The widest label the bounded hosted vocabulary can produce; the
          // twelve-character bound on that vocabulary is pinned in
          // `connectionStatus.test.ts` against this cap.
          label="Connection: A very long node label indeed, Reconnecting"
          status="Reconnecting"
          icon={<WifiIcon aria-hidden className="size-3.5 shrink-0" />}
        />
      </div>,
    );

    const status = statusPart();
    // At the default type scale the widest label is whole — the cap is
    // headroom, not a permanent ellipsis.
    expect(status.scrollWidth, "the widest short label stays whole").toBeLessThanOrEqual(
      status.clientWidth,
    );
    expect(status.textContent).toBe("Reconnecting");

    const rect = chip().getBoundingClientRect();
    const titleWidth = document.querySelector("h1")!.getBoundingClientRect().width;
    expect(rect.left).toBeGreaterThanOrEqual(0);
    expect(rect.right).toBeLessThanOrEqual(320.5);
    expect(rect.width, "the chip stays smaller than the title it sits beside").toBeLessThan(
      titleWidth,
    );
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320);
  });

  it("caps its own width at a 200% type scale instead of consuming the title", async () => {
    // The chip cannot leave this to the neighbour. Every app bar here pairs it
    // with a `flex-1 min-w-0` title whose hypothetical main size is zero, so
    // the flex line always has positive free space and the chip is never ASKED
    // to shrink — measured, an uncapped chip took 250.3px here and left the
    // title 9.7px, which is the audited defect reproduced at 200%.
    await page.viewport(320, 568);
    const previousFontSize = document.documentElement.style.fontSize;
    document.documentElement.style.fontSize = "32px";
    try {
      mounted = await render(
        <div className="flex items-center gap-1.5 px-3">
          <h1 className="min-w-0 flex-1 truncate text-base font-semibold">Threads</h1>
          <MobileStatusChip
            label="Connection: Studio node, Reconnecting"
            status="Reconnecting"
            icon={<WifiIcon aria-hidden className="size-3.5 shrink-0" />}
          />
        </div>,
      );

      const rect = chip().getBoundingClientRect();
      const status = statusPart();
      const titleWidth = document.querySelector("h1")!.getBoundingClientRect().width;

      // The cap holds and is in px, so it does not scale with the type.
      expect(rect.width, "chip width at a 200% type scale").toBeLessThanOrEqual(136.5);
      // The title keeps a usable share of the bar rather than collapsing.
      expect(titleWidth, "title width at a 200% type scale").toBeGreaterThan(120);
      // The label yields inside the cap: clipped with an ellipsis, on one
      // line, and never spilling outside the chip's own box.
      expect(status.scrollWidth, "the label yields inside the cap").toBeGreaterThan(
        status.clientWidth,
      );
      expect(status.getBoundingClientRect().right, "the label stays inside the chip").toBeLessThan(
        rect.right + 0.5,
      );
      expect(status.getBoundingClientRect().height, "the label stays on one line").toBeLessThan(
        rect.height,
      );
      // …and the touch floor still holds at the bottom end.
      expect(Math.min(rect.width, rect.height), "touch floor under scaling").toBeGreaterThanOrEqual(
        44,
      );
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320);
    } finally {
      document.documentElement.style.fontSize = previousFontSize;
    }
  });

  it("yields its own width in an over-constrained row rather than overflowing it", async () => {
    // The other half of the width contract, and the case the app bars cannot
    // exercise: a row whose remaining items have intrinsic width, so the flex
    // line has NEGATIVE free space and something has to give. The chip is what
    // gives — it must not push a sibling past the row's edge.
    await page.viewport(320, 568);
    mounted = await render(
      <div data-testid="row" className="flex w-[220px] items-center gap-1.5 overflow-hidden">
        <span className="w-[160px] shrink-0 truncate text-sm">A fixed-width neighbour</span>
        <MobileStatusChip
          label="Connection: Studio node, Reconnecting"
          status="Reconnecting"
          icon={<WifiIcon aria-hidden className="size-3.5 shrink-0" />}
        />
      </div>,
    );

    const row = document.querySelector<HTMLElement>('[data-testid="row"]')!;
    const rowRect = row.getBoundingClientRect();
    const rect = chip().getBoundingClientRect();
    // Nothing escapes the row…
    expect(rect.right, "the chip stays inside the row").toBeLessThanOrEqual(rowRect.right + 0.5);
    expect(row.scrollWidth, "the row does not overflow").toBeLessThanOrEqual(row.clientWidth);
    // …because the chip absorbed the deficit itself, down to but not through
    // the touch floor.
    expect(rect.width, "the chip absorbed the deficit").toBeLessThan(119);
    expect(rect.width, "the touch floor still holds").toBeGreaterThanOrEqual(44);
  });
});
