// Production CSS is part of the behavior under test: the bar must stay fully
// operable at the phone viewport with a coarse pointer.
import "../../index.css";

import { page } from "vite-plus/test/browser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { render } from "vitest-browser-react";

import { resetPointerEmulation, setCoarsePointerEmulation } from "../../../test/browserPointer";
import { syncDocumentPresentationTier } from "../../lib/presentationTier";
import { ThreadMessageSearchBar } from "./ThreadMessageSearchBar";

let mounted: Awaited<ReturnType<typeof render>> | null = null;

describe("ThreadMessageSearchBar (phone)", () => {
  beforeAll(() => {
    syncDocumentPresentationTier();
  });

  beforeEach(async () => {
    await page.viewport(390, 844);
  });

  afterEach(async () => {
    await resetPointerEmulation();
    await mounted?.unmount();
    mounted = null;
    vi.restoreAllMocks();
    document.body.innerHTML = "";
    await page.viewport(1_280, 720);
  });

  it("is fully operable by touch at the phone viewport", async () => {
    const onQueryChange = vi.fn();
    const onNext = vi.fn();
    const onPrevious = vi.fn();
    const onClose = vi.fn();
    await setCoarsePointerEmulation(true);
    await vi.waitFor(() => {
      expect(window.matchMedia("(pointer: coarse)").matches).toBe(true);
    });

    try {
      mounted = await render(
        <div className="relative h-40">
          <ThreadMessageSearchBar
            query="adapter"
            focusRequestId={1}
            matchCount={3}
            selectedIndex={0}
            onQueryChange={onQueryChange}
            onNext={onNext}
            onPrevious={onPrevious}
            onClose={onClose}
          />
        </div>,
      );

      const input = page.getByLabelText("Find in thread");
      await expect.element(input).toBeVisible();
      // The bar fits the phone viewport without horizontal overflow.
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);

      await page.getByRole("button", { name: "Next match" }).click();
      expect(onNext).toHaveBeenCalledTimes(1);
      await page.getByRole("button", { name: "Previous match" }).click();
      expect(onPrevious).toHaveBeenCalledTimes(1);
      await page.getByRole("button", { name: "Close find" }).click();
      expect(onClose).toHaveBeenCalledTimes(1);

      await input.fill("adapters");
      expect(onQueryChange).toHaveBeenCalled();
    } finally {
      await setCoarsePointerEmulation(false);
      await vi.waitFor(() => {
        expect(window.matchMedia("(pointer: coarse)").matches).toBe(false);
      });
    }
  });
});
