import "../../index.css";

import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";

import { installVisualViewportStub } from "../../../test/browserVisualViewport";
import { syncDocumentVisualViewportInsets } from "../../lib/visualViewportInsets";
import { Sheet, SheetFooter, SheetHeader, SheetPanel, SheetPopup, SheetTitle } from "./sheet";

function BottomSheetHarness() {
  return (
    <Sheet open onOpenChange={() => undefined}>
      <SheetPopup side="bottom">
        <SheetHeader>
          <SheetTitle>Session actions</SheetTitle>
        </SheetHeader>
        <SheetPanel>
          <p>Choose an action for this session.</p>
        </SheetPanel>
        <SheetFooter>
          <button type="button">Apply</button>
        </SheetFooter>
      </SheetPopup>
    </Sheet>
  );
}

describe("Sheet", () => {
  let mounted: Awaited<ReturnType<typeof render>> | null = null;

  afterEach(async () => {
    await mounted?.unmount();
    mounted = null;
    document.body.innerHTML = "";
  });

  it("keeps the bottom sheet footer above a stubbed software keyboard", async () => {
    const initialWidth = window.innerWidth;
    const initialHeight = window.innerHeight;
    const viewportStub = installVisualViewportStub();
    const stopAdapter = syncDocumentVisualViewportInsets();
    try {
      await page.viewport(390, 844);
      mounted = await render(<BottomSheetHarness />);

      const applyButton = page.getByRole("button", { name: "Apply" });
      await expect.element(applyButton).toBeInTheDocument();
      const popup = document.querySelector<HTMLElement>('[data-slot="sheet-popup"]');
      expect(popup).not.toBeNull();

      // Keyboard-closed baseline: the sheet sticks to the viewport bottom.
      await vi.waitFor(() => {
        expect(popup!.getBoundingClientRect().bottom).toBeGreaterThan(843);
      });

      viewportStub.setKeyboardInset(300);
      await vi.waitFor(() => {
        const popupRect = popup!.getBoundingClientRect();
        const buttonRect = applyButton.element().getBoundingClientRect();
        expect(popupRect.bottom).toBeLessThanOrEqual(544.5);
        expect(buttonRect.height).toBeGreaterThan(0);
        expect(buttonRect.bottom).toBeLessThanOrEqual(544.5);
      });

      // Hiding the keyboard restores the bottom-stuck geometry.
      viewportStub.setKeyboardInset(0);
      await vi.waitFor(() => {
        expect(popup!.getBoundingClientRect().bottom).toBeGreaterThan(843);
      });
    } finally {
      stopAdapter();
      viewportStub.restore();
      await page.viewport(initialWidth, initialHeight);
    }
  });
});
