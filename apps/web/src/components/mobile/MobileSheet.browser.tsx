// Production CSS is part of the behavior under test: the detent offset, the
// safe-area padding, and the reduced-motion collapse are all CSS.
import "../../index.css";

import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";

import {
  cdpSession,
  resetPointerEmulation,
  setCoarsePointerEmulation,
} from "../../../test/browserPointer";
import { installVisualViewportStub } from "../../../test/browserVisualViewport";
import { syncDocumentVisualViewportInsets } from "../../lib/visualViewportInsets";
import {
  APPEARANCE_PREFERENCES_STORAGE_KEY,
  applyAppearancePreferencesToDocument,
  setAppearancePreference,
} from "../../themes/appearancePreferences";
import {
  MobileSheet,
  MobileSheetHeader,
  MobileSheetPanel,
  MobileSheetTitle,
  type MobileSheetDetent,
} from "./MobileSheet";

const PHONE_VIEWPORT = { width: 390, height: 844 } as const;
/** Taller than any detent so the popup is clamped by the viewport, not by content. */
const TALL_CONTENT_HEIGHT = 2_000;

function popupElement(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-mobile-sheet]");
}

function viewportElement(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-slot="mobile-sheet-viewport"]');
}

function grabberElement(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-slot="mobile-sheet-grabber"]');
}

/** The alpha channel of a computed colour, in whichever syntax it serialises. */
function computedAlpha(color: string): number {
  const numbers = color.match(/[\d.]+/gu)?.map(Number) ?? [];
  return numbers.length === 4 ? numbers[3]! : 1;
}

function Harness({
  detent,
  onOpenChange,
  tall = true,
}: {
  readonly detent?: MobileSheetDetent;
  readonly onOpenChange?: (open: boolean) => void;
  readonly tall?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" data-testid="sheet-trigger" onClick={() => setOpen(true)}>
        Open sheet
      </button>
      <MobileSheet
        open={open}
        onOpenChange={(nextOpen) => {
          onOpenChange?.(nextOpen);
          setOpen(nextOpen);
        }}
        label="Harness sheet"
        detent={detent}
      >
        <MobileSheetHeader>
          <MobileSheetTitle>Harness sheet</MobileSheetTitle>
        </MobileSheetHeader>
        <MobileSheetPanel>
          <div style={tall ? { height: `${TALL_CONTENT_HEIGHT}px` } : undefined}>
            <button type="button">First row</button>
            <button type="button">Second row</button>
          </div>
        </MobileSheetPanel>
      </MobileSheet>
    </div>
  );
}

/**
 * Waits for the popup to exist and for its position to stop moving. Detent and
 * gesture assertions are geometric, so they must not read a mid-transition
 * frame — the enter transition is running when the element first appears.
 */
async function waitForSettledPopup(): Promise<HTMLElement> {
  const element = await vi.waitFor(() => {
    const found = popupElement();
    expect(found).not.toBeNull();
    expect(found!.getBoundingClientRect().height).toBeGreaterThan(0);
    return found!;
  });
  let previousTop = Number.NaN;
  await vi.waitFor(() => {
    const { top } = element.getBoundingClientRect();
    const settled = top === previousTop;
    previousTop = top;
    expect(settled, "the sheet is still animating").toBe(true);
  });
  return element;
}

/**
 * The browser runner scales the emulated viewport, so CDP input coordinates
 * and client coordinates do not coincide. Probing two points recovers the
 * affine mapping instead of assuming one.
 */
interface PointerTransform {
  readonly scaleX: number;
  readonly scaleY: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

async function probeClientPosition(x: number, y: number): Promise<{ x: number; y: number }> {
  const position = new Promise<{ x: number; y: number }>((resolve) => {
    const onMove = (event: PointerEvent) => {
      window.removeEventListener("pointermove", onMove, true);
      resolve({ x: event.clientX, y: event.clientY });
    };
    window.addEventListener("pointermove", onMove, true);
  });
  await cdpSession().send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, buttons: 0 });
  return position;
}

async function calibratePointer(): Promise<PointerTransform> {
  const first = { x: 60, y: 60 };
  const second = { x: 240, y: 240 };
  const firstClient = await probeClientPosition(first.x, first.y);
  const secondClient = await probeClientPosition(second.x, second.y);
  const scaleX = (secondClient.x - firstClient.x) / (second.x - first.x);
  const scaleY = (secondClient.y - firstClient.y) / (second.y - first.y);
  expect(scaleX, "horizontal pointer calibration").toBeGreaterThan(0);
  expect(scaleY, "vertical pointer calibration").toBeGreaterThan(0);
  return {
    scaleX,
    scaleY,
    offsetX: firstClient.x - first.x * scaleX,
    offsetY: firstClient.y - first.y * scaleY,
  };
}

function toInputCoordinates(
  transform: PointerTransform,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  return {
    x: (clientX - transform.offsetX) / transform.scaleX,
    y: (clientY - transform.offsetY) / transform.scaleY,
  };
}

/**
 * Drives a real mouse drag through CDP so the gesture goes through Base UI's
 * own pointer pipeline rather than a synthetic React event. Coordinates are
 * given in client space; `distance` is positive downwards.
 */
async function dragVertically(clientX: number, clientY: number, distance: number): Promise<void> {
  const transform = await calibratePointer();
  const session = cdpSession();
  const start = toInputCoordinates(transform, clientX, clientY);
  await session.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...start, buttons: 0 });
  await session.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    ...start,
    button: "left",
    buttons: 1,
    clickCount: 1,
  });
  const steps = 10;
  for (let step = 1; step <= steps; step += 1) {
    await session.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      ...toInputCoordinates(transform, clientX, clientY + (distance * step) / steps),
      button: "left",
      buttons: 1,
    });
  }
  await session.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    ...toInputCoordinates(transform, clientX, clientY + distance),
    button: "left",
    buttons: 0,
    clickCount: 1,
  });
}

describe("MobileSheet", () => {
  let mounted: Awaited<ReturnType<typeof render>> | null = null;

  afterEach(async () => {
    await mounted?.unmount();
    mounted = null;
    document.body.innerHTML = "";
    await resetPointerEmulation();
    await cdpSession().send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "" }],
    });
    // Reapplied only after the emulated media is reverted: the injected style
    // element resolves the effective (OS-merged) motion setting at write time.
    localStorage.removeItem(APPEARANCE_PREFERENCES_STORAGE_KEY);
    applyAppearancePreferencesToDocument();
    await page.viewport(1_280, 720);
  });

  it("opens at the requested detent and snaps between them", async () => {
    await page.viewport(PHONE_VIEWPORT.width, PHONE_VIEWPORT.height);

    mounted = await render(<Harness detent="large" />);
    await page.getByTestId("sheet-trigger").click();

    // `large` fills the sheet to the viewport gutter: no snap-point offset.
    const large = await waitForSettledPopup();
    expect(large.getAttribute("data-expanded")).toBe("");
    const largeRect = large.getBoundingClientRect();
    // 48px viewport gutter (pt-12).
    expect(largeRect.top).toBeGreaterThanOrEqual(46);
    expect(largeRect.top).toBeLessThanOrEqual(50);
    expect(largeRect.bottom).toBeGreaterThanOrEqual(PHONE_VIEWPORT.height - 1);
    const largeHeight = largeRect.height;

    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => {
      expect(popupElement()).toBeNull();
    });
    await mounted.unmount();

    // `medium` opens at the half-viewport stop: the same popup, translated
    // down by the difference between its height and the medium detent.
    mounted = await render(<Harness detent="medium" />);
    await page.getByTestId("sheet-trigger").click();
    const medium = await waitForSettledPopup();
    const expectedMediumTop = 48 + (largeHeight - PHONE_VIEWPORT.height / 2);
    const mediumRect = medium.getBoundingClientRect();
    expect(mediumRect.top).toBeGreaterThan(expectedMediumTop - 4);
    expect(mediumRect.top).toBeLessThan(expectedMediumTop + 4);
    expect(medium.hasAttribute("data-expanded")).toBe(false);

    // The scrim stays opaque at rest at every detent. Regression: Base UI
    // reports snap-point progress 1 for a sheet resting at `medium`, so
    // deriving the backdrop opacity from `--drawer-swipe-progress` made the
    // scrim invisible while the page behind it was still modal.
    const backdrop = document.querySelector<HTMLElement>('[data-slot="mobile-sheet-backdrop"]');
    expect(backdrop).not.toBeNull();
    expect(Number.parseFloat(getComputedStyle(backdrop!).opacity)).toBe(1);
    // …and it is still the blocking, modal scrim, not a pass-through element.
    expect(getComputedStyle(backdrop!).pointerEvents).not.toBe("none");
    expect(
      document.elementFromPoint(PHONE_VIEWPORT.width / 2, 8)?.closest("[data-slot]"),
    ).not.toBeNull();

    // Dragging up from the medium detent resolves onto the large detent, and
    // the detent state is committed by the gesture, not by the transition.
    await dragVertically(PHONE_VIEWPORT.width / 2, mediumRect.top + 20, -320);
    await vi.waitFor(() => {
      expect(popupElement()?.getAttribute("data-expanded")).toBe("");
    });
  });

  it("offers a named, non-destructive close control that dismisses the sheet", async () => {
    await page.viewport(PHONE_VIEWPORT.width, PHONE_VIEWPORT.height);
    await setCoarsePointerEmulation(true);
    const onOpenChange = vi.fn();
    mounted = await render(<Harness onOpenChange={onOpenChange} />);

    const trigger = page.getByTestId("sheet-trigger");
    await trigger.click();
    const popup = await waitForSettledPopup();

    // The grabber is a drag affordance only, so it cannot be the exit an
    // assistive-technology user is offered.
    const grabber = grabberElement();
    expect(grabber?.getAttribute("aria-hidden")).toBe("true");

    // A named close control exists inside the sheet, and is not one of the
    // sheet's own actions.
    const close = page.getByRole("button", { name: "Close" });
    await expect.element(close).toBeVisible();
    const closeElement = close.element() as HTMLElement;
    expect(popup.contains(closeElement)).toBe(true);
    // Coarse-pointer hit slop brings the icon button to the 44px floor.
    const closeRect = closeElement.getBoundingClientRect();
    const hitTarget = document.elementFromPoint(
      closeRect.left + closeRect.width / 2,
      closeRect.top - 4,
    );
    expect(hitTarget?.closest('[data-slot="mobile-sheet-close"]')).toBe(closeElement);

    onOpenChange.mockClear();
    await close.click();
    await vi.waitFor(() => {
      expect(onOpenChange.mock.calls.map(([open]) => open)).toContain(false);
    });
    await vi.waitFor(() => {
      expect(popupElement()).toBeNull();
    });
    // A non-destructive exit also restores focus to where the sheet came from.
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(trigger.element());
    });
  });

  it("applies the safe-area padding and the keyboard inset itself", async () => {
    const viewportStub = installVisualViewportStub();
    const stopAdapter = syncDocumentVisualViewportInsets();
    try {
      await page.viewport(PHONE_VIEWPORT.width, PHONE_VIEWPORT.height);
      mounted = await render(<Harness />);
      await page.getByTestId("sheet-trigger").click();

      const popup = await waitForSettledPopup();
      // The primitive owns the safe areas; call sites do not repeat them.
      expect(popup.className).toContain("pb-safe");
      expect(popup.className).toContain("pl-safe");
      expect(popup.className).toContain("pr-safe");
      // Leading-corner radius, which the desktop bottom sheet never had.
      const radius = Number.parseFloat(getComputedStyle(popup).borderTopLeftRadius);
      expect(radius).toBeGreaterThan(0);

      // Keyboard-closed baseline.
      await vi.waitFor(() => {
        expect(popup.getBoundingClientRect().bottom).toBeGreaterThanOrEqual(
          PHONE_VIEWPORT.height - 1,
        );
      });

      viewportStub.setKeyboardInset(300);
      await vi.waitFor(() => {
        const viewport = viewportElement();
        expect(viewport).not.toBeNull();
        expect(getComputedStyle(viewport!).paddingBottom).toBe("300px");
        expect(popup.getBoundingClientRect().bottom).toBeLessThanOrEqual(
          PHONE_VIEWPORT.height - 300 + 0.5,
        );
      });

      viewportStub.setKeyboardInset(0);
      await vi.waitFor(() => {
        expect(popup.getBoundingClientRect().bottom).toBeGreaterThanOrEqual(
          PHONE_VIEWPORT.height - 1,
        );
      });
    } finally {
      stopAdapter();
      viewportStub.restore();
    }
  });

  it("dismisses on a downward swipe and commits the dismissal on gesture resolution", async () => {
    await page.viewport(PHONE_VIEWPORT.width, PHONE_VIEWPORT.height);
    const onOpenChange = vi.fn();
    mounted = await render(<Harness detent="large" onOpenChange={onOpenChange} />);
    await page.getByTestId("sheet-trigger").click();

    const popup = await waitForSettledPopup();
    onOpenChange.mockClear();

    const grabber = grabberElement();
    expect(grabber).not.toBeNull();
    const grabberRect = grabber!.getBoundingClientRect();
    await dragVertically(
      grabberRect.left + grabberRect.width / 2,
      grabberRect.top + grabberRect.height / 2,
      700,
    );

    // The close is committed by the release itself, not by the exit transition
    // finishing: the callback has already fired while the popup is still
    // present and playing its ending style.
    await vi.waitFor(() => {
      expect(onOpenChange.mock.calls.map(([open]) => open)).toContain(false);
    });
    await vi.waitFor(() => {
      expect(popupElement()).toBeNull();
    });
    expect(popup.isConnected).toBe(false);
  });

  it("collapses its transitions under prefers-reduced-motion", async () => {
    await page.viewport(PHONE_VIEWPORT.width, PHONE_VIEWPORT.height);
    await cdpSession().send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });
    await vi.waitFor(() => {
      expect(window.matchMedia("(prefers-reduced-motion: reduce)").matches).toBe(true);
    });

    mounted = await render(<Harness />);
    await page.getByTestId("sheet-trigger").click();
    const popup = await vi.waitFor(() => {
      const element = popupElement();
      expect(element).not.toBeNull();
      return element!;
    });
    expect(popup.className).toContain("motion-reduce:transition-none");
    expect(getComputedStyle(popup).transitionProperty).toBe("none");

    // Dismissal still resolves without an animation to wait on.
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => {
      expect(popupElement()).toBeNull();
    });
  });

  it("renders on the sheet material tier and takes its motion from the tokens", async () => {
    await page.viewport(PHONE_VIEWPORT.width, PHONE_VIEWPORT.height);
    applyAppearancePreferencesToDocument();
    mounted = await render(<Harness />);
    await page.getByTestId("sheet-trigger").click();
    const popup = await waitForSettledPopup();

    // The house curve and duration come from the motion tokens, not from an
    // inline curve on the component.
    expect(getComputedStyle(popup).transitionTimingFunction).toBe("cubic-bezier(0.16, 1, 0.3, 1)");
    expect(getComputedStyle(popup).transitionDuration).toBe("0.2s");

    // The `sheet` tier: opaque and unblurred at Solid, translucent and blurred
    // at Glass, with the tier's own (largest) blur radius. The contrast that
    // makes this safe is asserted in `GlassSurface.browser.tsx`.
    setAppearancePreference("surfaceTransparency", "default");
    applyAppearancePreferencesToDocument();
    expect(computedAlpha(getComputedStyle(popup).backgroundColor)).toBe(1);

    setAppearancePreference("surfaceTransparency", "glass");
    applyAppearancePreferencesToDocument();
    const glassStyle = getComputedStyle(popup);
    expect(glassStyle.backdropFilter).toContain("blur(28px)");
    expect(computedAlpha(glassStyle.backgroundColor)).toBeLessThan(1);

    // The Motion preference collapses the transition beyond the OS setting.
    setAppearancePreference("motion", "reduce");
    applyAppearancePreferencesToDocument();
    expect(getComputedStyle(popup).transitionDuration).toBe("0s");
  });

  it("traps focus, locks page scroll, and restores focus to the trigger", async () => {
    await page.viewport(PHONE_VIEWPORT.width, PHONE_VIEWPORT.height);
    mounted = await render(<Harness tall={false} />);

    const trigger = page.getByTestId("sheet-trigger");
    await trigger.click();
    const triggerElement = trigger.element() as HTMLElement;

    const popup = await vi.waitFor(() => {
      const element = popupElement();
      expect(element).not.toBeNull();
      return element!;
    });
    await vi.waitFor(() => {
      expect(popup.contains(document.activeElement)).toBe(true);
    });
    // Modal scroll lock: Base UI pins the scroll container inline while open.
    expect(document.body.style.overflow).toBe("hidden");

    for (let index = 0; index < 6; index += 1) {
      await userEvent.keyboard("{Tab}");
      expect(popup.contains(document.activeElement)).toBe(true);
    }

    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => {
      expect(popupElement()).toBeNull();
    });
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(triggerElement);
    });
    await vi.waitFor(() => {
      expect(document.body.style.overflow).toBe("");
    });
  });
});
