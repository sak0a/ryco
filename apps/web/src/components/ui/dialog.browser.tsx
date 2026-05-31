import "../../index.css";

import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { useEffect, useState } from "react";

import {
  isDifferentDialogShortcutTarget,
  matchesExactModShortcut,
  shouldIgnoreGlobalNavigationShortcut,
} from "../../keybindings";
import { Dialog, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "./dialog";

function DialogHarness() {
  const [open, setOpen] = useState(true);
  const [globalNavigationCount, setGlobalNavigationCount] = useState(0);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (shouldIgnoreGlobalNavigationShortcut(event)) return;
      if (!matchesExactModShortcut(event, "1", { platform: "MacIntel" })) return;
      setGlobalNavigationCount((count) => count + 1);
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Reopen
      </button>
      <div data-testid="dialog-state">{open ? "open" : "closed"}</div>
      <div data-testid="global-navigation-count">{globalNavigationCount}</div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Issue details</DialogTitle>
          </DialogHeader>
          <DialogPanel>
            <textarea aria-label="Comment body" className="min-h-24 w-full" />
          </DialogPanel>
        </DialogPopup>
      </Dialog>
    </>
  );
}

function NestedDialogShortcutHarness() {
  const [parentShortcutCount, setParentShortcutCount] = useState(0);

  return (
    <>
      <div data-testid="parent-shortcut-count">{parentShortcutCount}</div>
      <Dialog open onOpenChange={() => undefined}>
        <DialogPopup
          onKeyDown={(event) => {
            if (
              isDifferentDialogShortcutTarget({
                currentTarget: event.currentTarget,
                target: event.target,
              })
            ) {
              return;
            }
            if (!matchesExactModShortcut(event, "1", { platform: "MacIntel" })) return;
            setParentShortcutCount((count) => count + 1);
          }}
        >
          <DialogHeader>
            <DialogTitle>Parent dialog</DialogTitle>
          </DialogHeader>
          <DialogPanel>
            <textarea aria-label="Parent body" className="min-h-24 w-full" />
            <Dialog open onOpenChange={() => undefined}>
              <DialogPopup>
                <DialogHeader>
                  <DialogTitle>Nested dialog</DialogTitle>
                </DialogHeader>
                <DialogPanel>
                  <textarea aria-label="Nested body" className="min-h-24 w-full" />
                </DialogPanel>
              </DialogPopup>
            </Dialog>
          </DialogPanel>
        </DialogPopup>
      </Dialog>
    </>
  );
}

describe("Dialog", () => {
  let mounted:
    | (Awaited<ReturnType<typeof render>> & {
        cleanup?: () => Promise<void>;
        unmount?: () => Promise<void>;
      })
    | null = null;

  afterEach(async () => {
    if (mounted) {
      const teardown = mounted.cleanup ?? mounted.unmount;
      await teardown?.call(mounted).catch(() => {});
    }
    mounted = null;
    document.body.innerHTML = "";
  });

  it("keeps the top-right close button clickable and keyboard activatable", async () => {
    mounted = await render(<DialogHarness />);

    const closeButton = page.getByRole("button", { name: "Close" });
    await expect.element(closeButton).toBeInTheDocument();

    closeButton.element().focus();
    expect(document.activeElement).toBe(closeButton.element());
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByTestId("dialog-state")).toHaveTextContent("closed");

    await page.getByRole("button", { name: "Reopen" }).click();
    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByTestId("dialog-state")).toHaveTextContent("closed");

    await page.getByRole("button", { name: "Reopen" }).click();
    await page.getByRole("button", { name: "Close" }).click();
    await expect.element(page.getByTestId("dialog-state")).toHaveTextContent("closed");
  });

  it("does not let dialog keyboard events reach global navigation handlers", async () => {
    mounted = await render(<DialogHarness />);

    const textarea = page.getByLabelText("Comment body");
    await userEvent.click(textarea);

    textarea.element().dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Meta",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    textarea.element().dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Alt",
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    textarea.element().dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "1",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );

    await expect.element(page.getByTestId("dialog-state")).toHaveTextContent("open");
    await expect.element(page.getByTestId("global-navigation-count")).toHaveTextContent("0");
  });

  it("does not let nested dialog keyboard events trigger parent dialog shortcuts", async () => {
    mounted = await render(<NestedDialogShortcutHarness />);

    const nestedTextarea = page.getByLabelText("Nested body");
    await userEvent.click(nestedTextarea);

    nestedTextarea.element().dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "1",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );

    await expect.element(page.getByTestId("parent-shortcut-count")).toHaveTextContent("0");
  });
});
