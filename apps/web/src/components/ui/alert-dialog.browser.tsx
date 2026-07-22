// Production CSS is part of the behavior under test: the keyboard inset is a
// viewport padding utility, not component state.
import "../../index.css";

import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";

import { installVisualViewportStub } from "../../../test/browserVisualViewport";
import { syncDocumentPresentationTier } from "../../lib/presentationTier";
import { syncDocumentVisualViewportInsets } from "../../lib/visualViewportInsets";
import {
  AlertDialog,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "./alert-dialog";

function Harness() {
  return (
    <AlertDialog open onOpenChange={() => undefined}>
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>Discard changes?</AlertDialogTitle>
          <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <button type="button">Discard</button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}

function popup(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-slot="alert-dialog-popup"]');
}

function viewport(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-slot="alert-dialog-viewport"]');
}

describe("AlertDialog", () => {
  let mounted: Awaited<ReturnType<typeof render>> | null = null;

  afterEach(async () => {
    await mounted?.unmount();
    mounted = null;
    document.body.innerHTML = "";
    await page.viewport(1_280, 720);
  });

  it("keeps the desktop alert above a stubbed software keyboard", async () => {
    const viewportStub = installVisualViewportStub();
    const stopAdapter = syncDocumentVisualViewportInsets();
    try {
      await page.viewport(1_280, 720);
      mounted = await render(<Harness />);

      const dialog = await vi.waitFor(() => {
        const element = popup();
        expect(element).not.toBeNull();
        return element!;
      });
      // 1rem base padding with no keyboard.
      await vi.waitFor(() => {
        expect(getComputedStyle(viewport()!).paddingBottom).toBe("16px");
      });
      const restingBottom = dialog.getBoundingClientRect().bottom;

      viewportStub.setKeyboardInset(300);
      await vi.waitFor(() => {
        expect(getComputedStyle(viewport()!).paddingBottom).toBe("316px");
        expect(dialog.getBoundingClientRect().bottom).toBeLessThan(restingBottom);
        expect(dialog.getBoundingClientRect().bottom).toBeLessThanOrEqual(720 - 300 + 0.5);
      });

      viewportStub.setKeyboardInset(0);
      await vi.waitFor(() => {
        expect(getComputedStyle(viewport()!).paddingBottom).toBe("16px");
      });
    } finally {
      stopAdapter();
      viewportStub.restore();
    }
  });

  it("keeps the bottom-stuck phone alert above a stubbed software keyboard", async () => {
    const viewportStub = installVisualViewportStub();
    const stopAdapter = syncDocumentVisualViewportInsets();
    syncDocumentPresentationTier();
    try {
      await page.viewport(390, 844);
      await vi.waitFor(() => {
        expect(document.documentElement.getAttribute("data-tier")).toBe("phone");
      });
      mounted = await render(<Harness />);

      const dialog = await vi.waitFor(() => {
        const element = popup();
        expect(element).not.toBeNull();
        return element!;
      });
      await vi.waitFor(() => {
        expect(dialog.getBoundingClientRect().bottom).toBeGreaterThan(843);
      });

      viewportStub.setKeyboardInset(300);
      await vi.waitFor(() => {
        expect(getComputedStyle(viewport()!).paddingBottom).toBe("300px");
        expect(dialog.getBoundingClientRect().bottom).toBeLessThanOrEqual(544.5);
      });

      viewportStub.setKeyboardInset(0);
      await vi.waitFor(() => {
        expect(dialog.getBoundingClientRect().bottom).toBeGreaterThan(843);
      });
    } finally {
      stopAdapter();
      viewportStub.restore();
    }
  });
});
