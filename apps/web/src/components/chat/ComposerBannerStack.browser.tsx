import "../../index.css";

import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";
import { TriangleAlertIcon } from "lucide-react";

import { ComposerBannerStack, type ComposerBannerStackItem } from "./ComposerBannerStack";

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

describe("ComposerBannerStack", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("expands and collapses the hidden banners by tapping the stack cap", async () => {
    await page.viewport(390, 844);
    const dismissFront = vi.fn();
    const dismissSecond = vi.fn();
    const dismissThird = vi.fn();
    const screen = await render(
      <div style={{ width: 390, paddingTop: 240 }}>
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

    try {
      const container = stackedContainer();
      expect(container).not.toBeNull();
      expect(getComputedStyle(container!).pointerEvents).toBe("none");
      expect(getComputedStyle(container!).opacity).toBe("0");

      const cap = page.getByRole("button", { name: "Show 2 more notifications" });
      await expect.element(cap).toBeInTheDocument();
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

      // Revealed banners are interactive: dismissing one works by tap.
      await page.getByRole("button", { name: "Dismiss Second notice" }).click();
      await vi.waitFor(() => {
        expect(dismissSecond).toHaveBeenCalledTimes(1);
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
      await screen.unmount();
    }
  });

  it("keeps the hover reveal for fine pointers", async () => {
    const screen = await render(
      <div style={{ width: 640, paddingTop: 240 }}>
        <ComposerBannerStack
          items={[
            createItem("front", "Front notice", vi.fn()),
            createItem("second", "Second notice", vi.fn()),
          ]}
        />
      </div>,
    );

    try {
      const container = stackedContainer();
      expect(container).not.toBeNull();
      expect(getComputedStyle(container!).opacity).toBe("0");

      await page.getByText("Front notice").hover();
      await vi.waitFor(() => {
        expect(getComputedStyle(container!).pointerEvents).toBe("auto");
        expect(getComputedStyle(container!).opacity).toBe("1");
      });
    } finally {
      await screen.unmount();
    }
  });
});
