import "../../index.css";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";
import { TriangleAlertIcon } from "lucide-react";

import {
  resetPointerEmulation,
  parkPointer,
  setCoarsePointerEmulation,
} from "../../../test/browserPointer";
import { ComposerBannerStack, type ComposerBannerStackItem } from "./ComposerBannerStack";

// The vitest browser default viewport; every test sets its own viewport and
// afterEach restores this so the tests stay order-independent.
const DEFAULT_TEST_VIEWPORT = { width: 414, height: 896 } as const;

function createItem(id: string, title: string, onDismiss: () => void): ComposerBannerStackItem {
  return {
    id,
    variant: "warning",
    icon: <TriangleAlertIcon className="size-4" />,
    title,
    dismissLabel: `Dismiss ${title}`,
    onDismiss,
  };
}

function stackedContainer(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-composer-banner-stack-rest="true"]');
}

function capElement(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-composer-banner-stack-cap="true"]');
}

describe("ComposerBannerStack", () => {
  beforeEach(async () => {
    // Defensive: no earlier test or file may leak touch emulation or a parked
    // hovering pointer into these hover- and pointer-sensitive assertions.
    await resetPointerEmulation();
    await parkPointer(4, 4);
  });

  afterEach(async () => {
    await page.viewport(DEFAULT_TEST_VIEWPORT.width, DEFAULT_TEST_VIEWPORT.height);
  });

  it("expands and collapses the hidden banners by tapping the stack cap on coarse pointers", async () => {
    await page.viewport(390, 844);
    const dismissFront = vi.fn();
    const dismissSecond = vi.fn();
    const dismissThird = vi.fn();
    const screen = await render(
      <div style={{ width: 390, paddingTop: 320 }}>
        <ComposerBannerStack
          items={[
            createItem("front", "Front notice", dismissFront),
            createItem("second", "Second notice", dismissSecond),
            createItem("third", "Third notice", dismissThird),
          ]}
        />
        <div data-testid="outside-hover-target" style={{ height: 60 }}>
          outside
        </div>
      </div>,
    );

    await setCoarsePointerEmulation(true);
    try {
      await vi.waitFor(() => {
        expect(window.matchMedia("(pointer: coarse)").matches).toBe(true);
      });

      const container = stackedContainer();
      expect(container).not.toBeNull();
      expect(getComputedStyle(container!).pointerEvents).toBe("none");
      expect(getComputedStyle(container!).opacity).toBe("0");

      const cap = page.getByRole("button", { name: "Show 2 more notifications" });
      await expect.element(cap).toBeInTheDocument();
      // The 12px cap carries a >=44px effective touch target on coarse pointers.
      const capHitArea = getComputedStyle(capElement()!, "::after");
      expect(capHitArea.position).toBe("absolute");
      expect(Number.parseFloat(capHitArea.height)).toBeGreaterThanOrEqual(44);

      await cap.click();
      // iOS Safari does not focus buttons on tap and touch has no hover, so
      // the expansion must not depend on the focus-within or hover reveals;
      // drop focus and move the pointer away before asserting.
      (document.activeElement as HTMLElement | null)?.blur();
      await page.getByTestId("outside-hover-target").hover();

      await vi.waitFor(() => {
        expect(getComputedStyle(container!).pointerEvents).toBe("auto");
        expect(getComputedStyle(container!).opacity).toBe("1");
      });

      // The expanded cap must not intercept taps on the lowest stacked
      // banner: hit-testing its bottom edge resolves inside the banner.
      const thirdAlert = Array.from(
        container!.querySelectorAll<HTMLElement>('[data-slot="alert"]'),
      ).find((alert) => alert.textContent?.includes("Third notice"));
      expect(thirdAlert).not.toBeUndefined();
      const thirdRect = thirdAlert!.getBoundingClientRect();
      const hit = document.elementFromPoint(
        thirdRect.left + thirdRect.width / 2,
        thirdRect.bottom - 2,
      );
      expect(hit).not.toBeNull();
      expect(thirdAlert!.contains(hit)).toBe(true);

      // Revealed banners are interactive: dismissing the lowest one works.
      await page.getByRole("button", { name: "Dismiss Third notice" }).click();
      await vi.waitFor(() => {
        expect(dismissThird).toHaveBeenCalledTimes(1);
      });

      // Tapping the cap again collapses the stack.
      await page.getByRole("button", { name: "Hide stacked notifications" }).click();
      (document.activeElement as HTMLElement | null)?.blur();
      await page.getByTestId("outside-hover-target").hover();
      await vi.waitFor(() => {
        expect(getComputedStyle(container!).opacity).toBe("0");
        expect(getComputedStyle(container!).pointerEvents).toBe("none");
      });
    } finally {
      try {
        await setCoarsePointerEmulation(false);
        await vi.waitFor(() => {
          expect(window.matchMedia("(pointer: coarse)").matches).toBe(false);
        });
      } catch (revertError) {
        // Surface revert failures without masking an assertion error above.
        console.error("Failed to revert coarse pointer emulation", revertError);
      }
      await screen.unmount();
    }
  });

  it("keeps the cap decorative and the hover reveal unchanged on fine pointers", async () => {
    await page.viewport(1024, 768);
    const screen = await render(
      <div style={{ width: 640, paddingTop: 320 }}>
        <ComposerBannerStack
          items={[
            createItem("front", "Front notice", vi.fn()),
            createItem("second", "Second notice", vi.fn()),
          ]}
        />
        <div data-testid="outside-hover-target" style={{ height: 60 }}>
          outside
        </div>
      </div>,
    );

    try {
      // Desktop baseline: the cap is a non-interactive decoration, exactly as
      // before the touch path existed — no tab stop, no click target.
      const cap = capElement();
      expect(cap).not.toBeNull();
      expect(cap!.tagName).toBe("DIV");
      expect(cap!.getAttribute("aria-hidden")).toBe("true");
      const capStyle = getComputedStyle(cap!);
      expect(capStyle.pointerEvents).toBe("none");
      expect(capStyle.height).toBe("12px");
      expect(getComputedStyle(cap!, "::after").content).toBe("none");
      expect(document.querySelector('button[data-composer-banner-stack-cap="true"]')).toBeNull();

      const container = stackedContainer();
      expect(container).not.toBeNull();
      expect(getComputedStyle(container!).opacity).toBe("0");

      // The focus-within reveal is not hover-media-gated, so it verifies the
      // desktop reveal pipeline deterministically in every environment.
      const frontDismiss = document.querySelector<HTMLElement>(
        '[aria-label="Dismiss Front notice"]',
      );
      expect(frontDismiss).not.toBeNull();
      frontDismiss!.focus();
      await vi.waitFor(() => {
        expect(getComputedStyle(container!).pointerEvents).toBe("auto");
        expect(getComputedStyle(container!).opacity).toBe("1");
      });
      frontDismiss!.blur();
      await vi.waitFor(() => {
        expect(getComputedStyle(container!).pointerEvents).toBe("none");
        expect(getComputedStyle(container!).opacity).toBe("0");
      });

      // The hover reveal is `(hover: hover)`-gated CSS (Tailwind v4). Linux
      // headless reports `hover: none` after any touch-emulation cycle (the
      // platform has no input devices to restore), so the hover path can only
      // be exercised where the environment is hover-capable — locally and on
      // every real desktop.
      if (window.matchMedia("(hover: hover)").matches) {
        await page.getByText("Front notice").hover();
        await vi.waitFor(() => {
          expect(getComputedStyle(container!).pointerEvents).toBe("auto");
          expect(getComputedStyle(container!).opacity).toBe("1");
        });

        // Moving the pointer away collapses the stack again (pure hover
        // reveal).
        await page.getByTestId("outside-hover-target").hover();
        await vi.waitFor(() => {
          expect(getComputedStyle(container!).pointerEvents).toBe("none");
          expect(getComputedStyle(container!).opacity).toBe("0");
        });
      }
    } finally {
      await screen.unmount();
    }
  });
});
