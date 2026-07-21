// Production CSS is part of the behavior under test: the `pointer-coarse:`
// variant drives the keyboard-hint visibility assertions.
import "../../index.css";

import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { render } from "vitest-browser-react";

import {
  parkPointer,
  resetPointerEmulation,
  setCoarsePointerEmulation,
} from "../../../test/browserPointer";
import { CommandShortcut } from "../ui/command";
import { MenuShortcut } from "../ui/menu";
import { ChatSessionTabs } from "./ChatSessionTabs";

async function withCoarsePointer(run: () => Promise<void>): Promise<void> {
  await setCoarsePointerEmulation(true);
  try {
    await vi.waitFor(() => {
      expect(window.matchMedia("(pointer: coarse)").matches).toBe(true);
    });
    await run();
  } finally {
    try {
      await setCoarsePointerEmulation(false);
      await vi.waitFor(() => {
        expect(window.matchMedia("(pointer: coarse)").matches).toBe(false);
      });
    } catch (revertError) {
      console.error("Failed to revert coarse pointer emulation", revertError);
    }
  }
}

let mounted: Awaited<ReturnType<typeof render>> | null = null;

describe("keyboard-shortcut hints on coarse pointers", () => {
  afterEach(async () => {
    await resetPointerEmulation();
    await mounted?.unmount();
    mounted = null;
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("hides the session-tab kbd hints on coarse pointers while tabs stay tappable", async () => {
    await parkPointer(4, 4);
    const onSelect = vi.fn();
    mounted = await render(
      <ChatSessionTabs
        items={[
          { key: "session-a", title: "Session A", bucket: "idle" },
          { key: "session-b", title: "Session B", bucket: "done" },
        ]}
        activeKey="session-a"
        onSelect={onSelect}
      />,
    );

    const hint = document.querySelector<HTMLElement>("kbd");
    expect(hint).not.toBeNull();
    expect(hint!.textContent).toBe("⌘1");

    await withCoarsePointer(async () => {
      await vi.waitFor(() => {
        expect(getComputedStyle(hint!).display).toBe("none");
      });
      // The tab itself keeps its tap path.
      const tab = document.querySelector<HTMLButtonElement>('[data-session-tab-key="session-b"]');
      expect(tab).not.toBeNull();
      tab!.click();
      expect(onSelect).toHaveBeenCalledWith("session-b");
    });

    // Fine pointer keeps the hint chrome (no hover-capability assumption).
    await vi.waitFor(() => {
      expect(getComputedStyle(hint!).display).not.toBe("none");
    });
  });

  it("hides palette-row and menu shortcut columns on coarse pointers", async () => {
    await parkPointer(4, 4);
    mounted = await render(
      <div>
        <CommandShortcut data-testid="palette-shortcut">⌘K</CommandShortcut>
        <MenuShortcut data-testid="menu-shortcut">⌘F</MenuShortcut>
      </div>,
    );

    const paletteShortcut = document.querySelector<HTMLElement>(
      '[data-testid="palette-shortcut"]',
    )!;
    const menuShortcut = document.querySelector<HTMLElement>('[data-testid="menu-shortcut"]')!;
    expect(getComputedStyle(paletteShortcut).display).not.toBe("none");
    expect(getComputedStyle(menuShortcut).display).not.toBe("none");

    await withCoarsePointer(async () => {
      await vi.waitFor(() => {
        expect(getComputedStyle(paletteShortcut).display).toBe("none");
        expect(getComputedStyle(menuShortcut).display).toBe("none");
      });
    });

    await vi.waitFor(() => {
      expect(getComputedStyle(paletteShortcut).display).not.toBe("none");
      expect(getComputedStyle(menuShortcut).display).not.toBe("none");
    });
  });
});
